'use strict'
// Programa principal de la app de escritorio (Electron).
// Aquí se crea la ventana, se piden permisos y se conecta la pantalla con la red y las cuentas.
//
// SEGURIDAD (resumen; el detalle está en SECURITY.md):
//  - la pantalla corre aislada y sin acceso a Node (contextIsolation + sandbox)
//  - la pantalla no puede abrir páginas, navegar ni hacer conexiones a internet
//  - todo lo que llega desde la pantalla se valida antes de usarse
//  - los intentos de contraseña fallidos se frenan
const path = require('path')
const crypto = require('crypto')
const { app, BrowserWindow, ipcMain, dialog, session, Notification, systemPreferences, Tray, Menu, nativeImage } = require('electron')

// Para probar dos usuarios en un mismo PC: PRIVCHAT_DATA=./datos-b npm start
if (process.env.PRIVCHAT_DATA) app.setPath('userData', path.resolve(process.env.PRIVCHAT_DATA))
app.enableSandbox() // todas las ventanas aisladas del sistema

const config = require('./config')
const accounts = require('./accounts')
const { Vault, ProfileStore } = require('./storage')
const { validateProfile } = require('./profile')
const { P2PNode } = require('./network')
const DHT = require('hyperdht')
const registry = require('./registry')

let win = null
let current = null        // sesión abierta: { account, dataKey, vault, node }
const ICON = path.join(__dirname, '..', 'assets', 'icon.png')
const startHidden = process.argv.includes('--hidden') // lo usa el inicio automático con el sistema
let tray = null
let quitting = false
let shownBackgroundHint = false
let skipAutoLogin = false // tras "Cerrar sesión" no se vuelve a entrar solo

// ---------- Validación de datos que llegan desde la pantalla ----------

const SID_RE = /^[0-9a-f]{16}$/
const CID_RE = /^[0-9a-f]{8}$/
const MSG_RE = /^[0-9a-f]{12}$/
const KEY_RE = /^[0-9a-f]{64}$/
const isKey = (k) => typeof k === 'string' && KEY_RE.test(k)
function str(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Dato no válido: ' + label)
  return value
}
const pick = (re, label) => (value) => {
  if (typeof value !== 'string' || !re.test(value)) throw new Error('Dato no válido: ' + label)
  return value
}
const sid = pick(SID_RE, 'servidor')
const cid = pick(CID_RE, 'canal')
const msgId = pick(MSG_RE, 'mensaje')
function key(value) {
  if (!isKey(value)) throw new Error('Contacto no válido')
  return value
}

// ---------- Freno a intentos de contraseña ----------

class Throttle {
  constructor(limit) { this.limit = limit; this.map = new Map() }
  check(id) {
    const f = this.map.get(id)
    if (f && f.until > Date.now()) {
      throw new Error('Demasiados intentos fallidos. Espera ' + Math.ceil((f.until - Date.now()) / 1000) + ' s.')
    }
  }
  fail(id) {
    const f = this.map.get(id) || { count: 0, until: 0 }
    f.count++
    if (f.count >= this.limit) f.until = Date.now() + Math.min(300000, 5000 * 2 ** (f.count - this.limit))
    this.map.set(id, f)
    if (this.map.size > 1000) this.map.clear()
  }
  ok(id) { this.map.delete(id) }
}
const perUser = new Throttle(5)   // 5 fallos por usuario
const allUsers = new Throttle(25)  // 25 fallos en total, sin importar el usuario

// ---------- Ventana y permisos ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: config.APP_NAME,
    icon: ICON,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,                         // el corrector puede descargar diccionarios de internet
      devTools: !app.isPackaged,                 // sin herramientas de desarrollo en la versión final
      autoplayPolicy: 'no-user-gesture-required' // para reproducir el audio de las llamadas
    }
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'))
  win.on('closed', () => { win = null })
  // Modo segundo plano: al cerrar la ventana la app sigue en línea (para tus servidores y para recibir mensajes).
  win.on('close', (e) => {
    if (quitting || !backgroundWanted()) return
    e.preventDefault()
    win.hide()
    createTray()
    if (!shownBackgroundHint && Notification.isSupported()) {
      shownBackgroundHint = true
      new Notification({ title: config.APP_NAME, body: 'Sigue activa en segundo plano. Ábrela o ciérrala del todo desde el icono junto al reloj.' }).show()
    }
  })
}

const backgroundWanted = () => !!(current && current.vault.data.settings.runInBackground)

function showWindow() {
  if (!win) createWindow()
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
}

function createTray() {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.setToolTip(config.APP_NAME + ' (en segundo plano)')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir ' + config.APP_NAME, click: showWindow },
    { type: 'separator' },
    { label: 'Salir del todo', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', showWindow)
}

// Reglas para TODA ventana o contenido que cree la app: nada de navegar, abrir ventanas ni webviews.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (e) => e.preventDefault())
  contents.on('will-redirect', (e) => e.preventDefault())
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

function isOurPage(webContents) {
  try { return webContents.getURL().startsWith('file://') } catch { return false }
}

function setupSession() {
  const ses = session.defaultSession
  ses.setSpellCheckerEnabled(false)

  // La pantalla no necesita internet: se bloquea cualquier petición web (la red P2P va por otro lado).
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_details, callback) => {
    callback({ cancel: true })
  })

  // Permisos: solo micrófono (llamadas) y copiar al portapapeles, y solo para nuestra propia pantalla.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isOurPage(wc)) return callback(false)
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || []
      return callback(types.length > 0 && types.every((t) => t === 'audio')) // sin cámara
    }
    callback(permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (!wc || !isOurPage(wc)) return false
    if (permission === 'media') return !!details && details.mediaType === 'audio'
    return permission === 'clipboard-sanitized-write'
  })
}

// Un aviso como máximo cada 5 segundos por tipo, para que nadie pueda llenarte de notificaciones.
const lastNotice = new Map()
function notify(kind, body) {
  const now = Date.now()
  if (now - (lastNotice.get(kind) || 0) < 5000) return
  if (win && !win.isFocused() && Notification.isSupported()) {
    lastNotice.set(kind, now)
    new Notification({ title: config.APP_NAME, body }).show()
  }
}

// ---------- Sesión ----------

function send(type, data = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('event', { type, ...data })
}

function startNode() {
  const { account, vault } = current
  const node = new P2PNode({
    seed: Buffer.from(vault.data.identitySeed, 'base64'),
    name: account.username,
    vault,
    nodeMode: vault.data.settings.nodeMode,
    cert: account.cert,
    profiles: current.profiles
  })
  node.on('presence', () => send('contacts'))
  node.on('chat', (info) => {
    send('chat', info)
    if (info.incoming) notify('chat', 'Nuevo mensaje')
  })
  node.on('call', (call) => {
    send('call', { call })
    if (call.state === 'ringing') notify('call', 'Llamada entrante')
  })
  node.on('audio', (buf) => send('audio', { buf }))
  node.on('node', (info) => send('node', { info }))
  node.on('profile', (info) => send('contacts', info))
  node.on('servers', (info) => send('servers', info))
  node.on('server-msg', (info) => {
    send('server-msg', info)
    if (info.m && !info.mine) notify('srv', 'Nuevo mensaje en un servidor')
  })
  node.on('server-invite', (info) => send('server-invite', info))
  current.node = node
  // Si falla la red (sin internet, firewall...) la app sigue abierta y lo avisa.
  node.start().catch((err) => send('node', { info: { error: err.message } }))
}

async function endSession() {
  if (!current) return
  const s = current
  current = null
  if (tray) { tray.destroy(); tray = null }
  await s.node.stop()
  s.vault.saveNow()
  s.dataKey.fill(0) // borra la clave de la memoria
}

async function startSession(account, dataKey, initial = {}) {
  await endSession()
  const vault = new Vault(accounts.dirOf(account.id), dataKey)
  vault.load(initial) // falla si la clave no corresponde; 'initial' solo se usa en cuentas nuevas
  current = { account, dataKey, vault, profiles: new ProfileStore(accounts.dirOf(account.id), dataKey), node: null }
  startNode()
  if (backgroundWanted()) createTray()
}

const need = () => {
  if (!current) throw new Error('No hay sesión iniciada')
  return current
}

// ---------- Canales con la pantalla ----------

// Solo se atienden mensajes que vienen de NUESTRA ventana principal.
function fromOurWindow(event) {
  const frame = event.senderFrame
  return !!win && event.sender === win.webContents && !!frame && frame.parent === null && String(frame.url).startsWith('file://')
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, arg) => {
    if (!fromOurWindow(event)) return { ok: false, error: 'No autorizado' }
    try {
      if (arg !== undefined && (typeof arg !== 'object' || arg === null || Array.isArray(arg))) {
        throw new Error('Petición no válida')
      }
      return { ok: true, ...(await fn(arg || {})) }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

// Si la app se abrió oculta (inicio con el sistema) y no tiene modo segundo plano, se muestra la ventana.
function afterAutoLogin() {
  if (startHidden && !backgroundWanted()) showWindow()
}

function setupIpc() {
  // Al abrir la app: intenta entrar solo (dispositivo recordado o pendrive).
  handle('boot', async () => {
    const hasAccounts = accounts.listAccounts().length > 0
    if (!skipAutoLogin) {
      const remembered = accounts.loadRemembered()
      if (remembered) {
        try { await startSession(remembered.account, remembered.dataKey); afterAutoLogin(); return { loggedIn: true } } catch {}
      }
      for (const file of await accounts.findKeyfiles()) {
        try {
          const r = accounts.unlockWithKeyfile(file)
          await startSession(r.account, r.dataKey)
          afterAutoLogin()
          return { loggedIn: true }
        } catch {}
      }
    }
    if (startHidden) showWindow() // no se pudo entrar sola: hay que mostrar la ventana para iniciar sesión
    return { loggedIn: false, hasAccounts }
  })

  // Crear cuenta. Con registro de nombres configurado: se reserva el nombre (único) y la cuenta se crea
  // solo si el registro lo acepta, así no queda nada a medias.
  handle('signup', async (a) => {
    const data = {
      email: str(a.email, 200, 'correo'),
      username: str(a.username, 60, 'usuario'),
      password: str(a.password, 300, 'contraseña')
    }
    const ok = accounts.prepareSignup(data) // valida y revisa duplicados en este equipo
    let cert = null
    let initial = {}
    if (registry.enabled()) {
      const seed = crypto.randomBytes(32) // la identidad se fija ahora: el certificado va ligado a ella
      const pub = DHT.keyPair(seed).publicKey.toString('hex')
      cert = await registry.claim(ok.username, pub) // tarda unos segundos (prueba de trabajo)
      initial = { identitySeed: seed.toString('base64') }
    }
    const { account, dataKey } = accounts.createAccount(data, { cert })
    await startSession(account, dataKey, initial)
    skipAutoLogin = false
  })

  handle('login', async (a) => {
    const username = str(a.username, 200, 'usuario')
    const password = str(a.password, 300, 'contraseña')
    const id = username.trim().toLowerCase()
    perUser.check(id)
    allUsers.check('*')
    let unlocked
    try {
      unlocked = accounts.unlockWithPassword(username, password)
    } catch (err) {
      perUser.fail(id)
      allUsers.fail('*')
      throw err
    }
    perUser.ok(id)
    await startSession(unlocked.account, unlocked.dataKey)
    skipAutoLogin = false
    if (a.remember === true) {
      try { accounts.rememberDevice(unlocked.account, unlocked.dataKey) } catch (err) { return { warning: err.message } }
    }
  })

  handle('login-keyfile', async () => {
    // 1) probar pendrives conectados  2) si no hay, dejar elegir el archivo a mano
    let files = await accounts.findKeyfiles()
    if (files.length === 0) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Elige tu clave de acceso',
        properties: ['openFile'],
        filters: [{ name: 'Clave de acceso', extensions: [config.KEYFILE_EXT.replace('.', '')] }]
      })
      if (r.canceled || !r.filePaths[0]) return { canceled: true }
      files = r.filePaths
    }
    let lastError = new Error('No se encontró una clave de acceso válida')
    for (const file of files) {
      try {
        const r = accounts.unlockWithKeyfile(file)
        await startSession(r.account, r.dataKey)
        skipAutoLogin = false
        return {}
      } catch (err) { lastError = err }
    }
    throw lastError
  })

  handle('logout', async () => {
    await endSession()
    accounts.forgetDevice()
    skipAutoLogin = true
  })

  handle('me', async () => {
    const { account, vault, node } = need()
    return {
      me: {
        username: account.username,
        email: account.email,
        code: node.code,
        hasKeyfile: !!account.keyfileWrap,
        remembered: accounts.rememberedId() === account.id,
        nodeMode: vault.data.settings.nodeMode,
        acceptRequests: vault.data.settings.acceptRequests !== false,
        runInBackground: !!vault.data.settings.runInBackground,
        autoStart: !!vault.data.settings.autoStart,
        packaged: app.isPackaged,
        verified: !!account.cert
      }
    }
  })

  handle('contacts', async () => {
    const { vault, node } = need()
    return {
      contacts: node.listContacts(),
      requests: vault.data.requests,
      node: node.nodeInfo(),
      verification: !!config.REGISTRY_PUBKEY // si es false, no se muestran marcas de nombre registrado
    }
  })

  // Perfiles: solo se pueden leer el tuyo y los de tus contactos.
  handle('profile-get', async (a) => {
    const { node, profiles, vault } = need()
    const k = key(a.key)
    const profile = k === node.code ? profiles.getMine() : node._contact(k) ? profiles.get(k) : null
    const consent = k === node.code ? true : (vault.data.fontConsent[k] ?? null) // null = aún no se le ha preguntado
    return { profile, consent }
  })
  handle('profile-avatar', async (a) => {
    const { node, profiles } = need()
    const k = key(a.key)
    const p = k === node.code ? profiles.getMine() : node._contact(k) ? profiles.get(k) : null
    return { avatar: p ? p.avatar : '', crop: p ? p.avatarCrop : { zoom: 1, x: 0, y: 0 } }
  })
  handle('profile-save', async (a) => {
    const { node } = need()
    if (!a.profile || JSON.stringify(a.profile).length > 3 * 1024 * 1024) throw new Error('El perfil es demasiado grande')
    node.setMyProfile(validateProfile(a.profile)) // se reconstruye y valida aquí, aunque venga de nuestra propia pantalla
  })

  // Servidores (alojados en el PC del creador)
  handle('srv-list', async () => ({ servers: need().node.servers.list() }))
  handle('srv-get', async (a) => ({ server: need().node.servers.get(sid(a.sid)) }))
  handle('srv-create', async (a) => ({ server: need().node.servers.create(str(a.name, 100, 'nombre')) }))
  handle('srv-join', async (a) => { need().node.servers.join(str(a.code, 300, 'código')) })
  handle('srv-leave', async (a) => { need().node.servers.leave(sid(a.sid)) })
  handle('srv-messages', async (a) => ({ messages: need().node.servers.messages(sid(a.sid), cid(a.cid)) }))
  handle('srv-send', async (a) => { need().node.servers.send(sid(a.sid), cid(a.cid), str(a.text, 8000, 'mensaje')) })
  handle('srv-edit', async (a) => { need().node.servers.edit(sid(a.sid), cid(a.cid), msgId(a.id), str(a.text, 8000, 'mensaje')) })
  handle('srv-del', async (a) => { need().node.servers.del(sid(a.sid), cid(a.cid), msgId(a.id)) })
  handle('srv-admin', async (a) => {
    const args = a.args && typeof a.args === 'object' && !Array.isArray(a.args) ? a.args : {}
    return need().node.servers.admin(sid(a.sid), str(a.op, 24, 'acción'), args) // el anfitrión valida cada dato
  })

  handle('chat', async (a) => ({ messages: need().node.getChat(key(a.key)) }))
  handle('send', async (a) => { need().node.sendMessage(key(a.key), str(a.text, 8000, 'mensaje')) })
  handle('contact-add', async (a) => {
    need().node.addContact(str(a.code, 200, 'código'), a.name === undefined ? '' : str(a.name, 200, 'nombre'))
  })
  handle('contact-remove', async (a) => { need().node.removeContact(key(a.key)) })
  handle('request-accept', async (a) => { need().node.acceptRequest(key(a.key)) })
  handle('request-reject', async (a) => { need().node.rejectRequest(key(a.key)) })

  handle('call-start', async (a) => { need().node.startCall(key(a.key)) })
  handle('call-accept', async () => { need().node.acceptCall() })
  handle('call-end', async () => { need().node.endCall() })

  handle('set-node-mode', async (a) => {
    const { vault, node } = need()
    vault.data.settings.nodeMode = a.value === true
    vault.save()
    await node.stop()
    startNode()
  })

  // Segundo plano: la ventana se oculta al cerrarla y queda un icono junto al reloj.
  // Iniciar con el sistema solo existe en la versión instalada.
  handle('set-background', async (a) => {
    const { vault } = need()
    const auto = a.autostart === true
    if (auto && !app.isPackaged) throw new Error('Iniciar con el sistema solo funciona en la versión instalada')
    vault.data.settings.autoStart = auto
    vault.data.settings.runInBackground = a.background === true || auto // iniciar con el sistema implica segundo plano
    vault.save()
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: auto, args: auto ? ['--hidden'] : [] })
    if (backgroundWanted()) createTray()
    else if (tray) { tray.destroy(); tray = null }
  })

  // Fuentes personalizadas de un contacto: se cargan en pantalla solo si el usuario lo acepta.
  handle('font-consent', async (a) => {
    const { vault, node } = need()
    const k = key(a.key)
    if (!node._contact(k)) throw new Error('Contacto no encontrado')
    vault.data.fontConsent[k] = a.allow === true
    vault.save()
  })

  handle('set-accept-requests', async (a) => { need().node.setAcceptRequests(a.value === true) })

  handle('keyfile-create', async () => {
    const { account, dataKey } = need()
    const r = await dialog.showOpenDialog(win, {
      title: 'Elige tu pendrive',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return { canceled: true }
    return { file: accounts.createKeyfile(account, dataKey, r.filePaths[0]) }
  })

  handle('keyfile-remove', async () => { accounts.removeKeyfile(need().account) })

  handle('remember-set', async (a) => {
    const { account, dataKey } = need()
    if (a.value === true) accounts.rememberDevice(account, dataKey)
    else accounts.forgetDevice()
  })

  // En macOS el sistema pide permiso de micrófono; en Windows/Linux se concede o se bloquea en Ajustes del sistema.
  handle('ask-mic', async () => {
    if (process.platform === 'darwin') return { granted: await systemPreferences.askForMediaAccess('microphone') }
    return { granted: true }
  })

  // El audio va por un canal aparte (sin esperar respuesta) para que sea fluido.
  ipcMain.on('audio-send', (event, data) => {
    if (!fromOurWindow(event) || !current || !current.node) return
    const buf = ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null
    if (buf && buf.length > 0 && buf.length <= 8 * 1024) current.node.sendAudio(buf)
  })
}

// ---------- Inicio ----------

if (!app.requestSingleInstanceLock()) {
  app.quit() // ya hay otra ventana abierta con estos datos
} else {
  app.on('second-instance', showWindow) // si se abre otra vez, se muestra la ventana (aunque estuviera oculta)
  app.whenReady().then(() => {
    accounts.init(app.getPath('userData'))
    setupSession()
    setupIpc()
    createWindow()
  })
  app.on('before-quit', () => { quitting = true; if (current) current.vault.saveNow() })
  app.on('window-all-closed', () => { if (!backgroundWanted()) app.quit() })
}
