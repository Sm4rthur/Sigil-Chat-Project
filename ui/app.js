'use strict'
// Lógica de la pantalla. No toca la red directamente: todo pasa por window.api (ver src/preload.js).

const $ = (id) => document.getElementById(id)
const SAMPLE_RATE = 16000 // calidad de voz de las llamadas

const state = {
  me: null,
  contacts: [],
  requests: [],
  node: null,
  active: null,          // clave del contacto con el chat abierto
  unread: new Set(),
  focusMsg: null,        // mensaje al que saltar después de abrir un chat desde el buscador
  verification: false,   // true si hay servicio de verificación: entonces se muestran las marcas
  call: { state: 'idle' }
}

// ---------- Utilidades ----------

async function rpc(channel, arg) {
  const r = await window.api.invoke(channel, arg)
  if (!r.ok) throw new Error(r.error)
  return r
}

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text // textContent evita inyectar HTML desde mensajes ajenos
  return e
}

// Si dos contactos se llaman igual, se agrega parte de su código para distinguirlos (anti-suplantación).
function nameOf(c) {
  const base = c.name || c.remoteName || ''
  const repeated = state.contacts.filter((x) => (x.name || x.remoteName || '') === base).length > 1
  if (!base) return c.key.slice(0, 8) + '…'
  return repeated ? base + ' · ' + c.key.slice(0, 6) : base
}

// "Mostrar contraseña": por defecto oculta, y se vuelve a ocultar al cambiar de pantalla.
function bindShowPassword(checkboxId, inputIds) {
  const box = $(checkboxId)
  const apply = () => inputIds.forEach((id) => { $(id).type = box.checked ? 'text' : 'password' })
  box.onchange = apply
  return () => { box.checked = false; apply() }
}
const hideLoginPassword = bindShowPassword('login-show', ['login-pass'])
const hideSignupPasswords = bindShowPassword('signup-show', ['signup-pass', 'signup-pass2'])

function show(screen) {
  hideLoginPassword()
  hideSignupPasswords()
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== 'screen-' + screen })
}

function setMsg(id, text, ok = false) {
  const e = $(id)
  e.textContent = text || ''
  e.className = (ok ? 'ok' : 'error') + (e.classList.contains('small') ? ' small' : '')
}

let toastTimer = null
function toast(text) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 4000)
}

// ---------- Arranque ----------

// Pantalla de carga: se muestra mientras la app prepara lo que necesita.
function loading(text) {
  show('loading')
  $('loading-text').textContent = text
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Espera (con tope de tiempo) a que la red esté lista; si tarda, la app abre igual y sigue intentando.
async function waitForNetwork(ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (state.node && (state.node.ready || state.node.error)) return
    await sleep(150)
  }
  $('loading-text').textContent = 'La red tarda en responder: la app seguirá intentando.'
  await sleep(700)
}

async function boot() {
  loading('Abriendo la aplicación…')
  const r = await rpc('boot')
  if (r.loggedIn) return enterApp()
  show(r.hasAccounts ? 'login' : 'signup')
}

async function enterApp() {
  loading('Abriendo tu cuenta…')
  await refreshMe()
  loading('Cargando contactos y servidores…')
  await refreshContacts()
  await ServersUI.refreshList()
  loading('Conectando con la red…')
  await waitForNetwork(7000)
  show('main')
}

// El área principal muestra un chat con un contacto o un servidor.
function showArea(area) {
  $('chat').hidden = area !== 'chat'
  $('server-view').hidden = area !== 'server'
}

// ---------- Iniciar sesión / crear cuenta ----------

$('to-signup').onclick = (e) => { e.preventDefault(); show('signup') }
$('to-theme').onclick = (e) => { e.preventDefault(); ThemeUI.open() }
$('btn-theme').onclick = () => ThemeUI.open()
ThemeUI.init()
$('to-login').onclick = (e) => { e.preventDefault(); show('login') }

$('login-form').onsubmit = async (e) => {
  e.preventDefault()
  setMsg('login-error', '')
  try {
    const r = await rpc('login', {
      username: $('login-user').value,
      password: $('login-pass').value,
      remember: $('login-remember').checked
    })
    $('login-pass').value = ''
    if (r.warning) toast(r.warning)
    await enterApp()
  } catch (err) {
    setMsg('login-error', err.message)
  }
}

$('btn-login-key').onclick = async () => {
  setMsg('login-error', '')
  try {
    const r = await rpc('login-keyfile')
    if (!r.canceled) await enterApp()
  } catch (err) {
    setMsg('login-error', err.message)
  }
}

$('signup-form').onsubmit = async (e) => {
  e.preventDefault()
  setMsg('signup-error', '')
  if ($('signup-pass').value !== $('signup-pass2').value) {
    return setMsg('signup-error', 'Las contraseñas no coinciden')
  }
  if ($('signup-pass').value.length < 10) {
    return setMsg('signup-error', 'La contraseña debe tener al menos 10 caracteres')
  }
  const button = $('btn-signup')
  button.disabled = true
  setMsg('signup-error', 'Creando tu cuenta y reservando tu nombre… puede tardar unos segundos.', true)
  try {
    await rpc('signup', {
      email: $('signup-email').value,
      username: $('signup-user').value,
      password: $('signup-pass').value
    })
    $('signup-pass').value = ''
    $('signup-pass2').value = ''
    await refreshMe()
    setMsg('signup-error', '')
    show('keyfile') // la clave de acceso se ofrece DESPUÉS de crear la cuenta
  } catch (err) {
    setMsg('signup-error', err.message)
  } finally {
    button.disabled = false
  }
}

// ---------- Clave de acceso (se ofrece tras crear la cuenta) ----------

$('btn-key-create').onclick = async () => {
  try {
    const r = await rpc('keyfile-create')
    if (r.canceled) return
    setMsg('key-result', 'Listo. Archivo guardado en: ' + r.file, true)
    $('btn-key-next').hidden = false
  } catch (err) {
    setMsg('key-result', err.message)
  }
}
$('btn-key-skip').onclick = () => show('permissions')
$('btn-key-next').onclick = () => show('permissions')

// ---------- Permisos ----------

$('btn-mic').onclick = async () => {
  try {
    await rpc('ask-mic')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop()) // era solo una prueba
    $('mic-status').textContent = '✓ Permitido'
  } catch {
    $('mic-status').textContent = 'No disponible. Revisa los permisos de micrófono de tu sistema.'
  }
}
$('btn-perm-next').onclick = () => enterApp()

// ---------- Datos propios y contactos ----------

// Fotos de perfil de los contactos (se piden solo cuando cambia su versión)
const avatars = new Map() // clave -> { rev, src }
const avatarPending = new Set()
const avatarOf = (key) => avatars.get(key) || { src: '', crop: null }

function ensureAvatars() {
  for (const c of state.contacts) {
    const cached = avatars.get(c.key)
    if (!c.profRev || (cached && cached.rev === c.profRev) || avatarPending.has(c.key)) continue
    avatarPending.add(c.key)
    rpc('profile-avatar', { key: c.key })
      .then((r) => { avatars.set(c.key, { rev: c.profRev, src: r.avatar, crop: r.crop }); renderContacts(); renderChatHeader() })
      .catch(() => {})
      .finally(() => avatarPending.delete(c.key))
  }
}

async function refreshOwnAvatar() {
  try {
    const r = await rpc('profile-avatar', { key: state.me.code })
    $('me-avatar').replaceChildren(ProfileUI.avatarEl(r.avatar, state.me.username, '', r.crop))
  } catch { /* no es crítico */ }
}

function openProfile(c) {
  ProfileUI.view({ key: c.key, name: nameOf(c), verified: c.verified, isMe: false })
}

async function refreshMe() {
  state.me = (await rpc('me')).me
  refreshOwnAvatar()
  $('me-name').textContent = state.me.username
  $('me-verified').hidden = !state.me.verified
  $('me-code').textContent = state.me.code
}

async function refreshContacts() {
  const r = await rpc('contacts')
  state.contacts = r.contacts
  state.requests = r.requests
  state.node = r.node
  state.verification = r.verification
  ensureAvatars()
  renderContacts()
  renderRequests()
  renderNode()
  renderChatHeader()
}

function renderNode() {
  const n = state.node
  let text = ''
  if (!n) text = ''
  else if (n.error) text = 'Sin conexión a la red: ' + n.error
  else if (!n.nodeMode) text = 'Modo nodo desactivado'
  else if (n.acting === true) text = 'Estás ayudando a la red como nodo'
  else if (n.acting === false) text = 'Modo nodo: se activa solo cuando tu conexión es estable y accesible'
  else text = 'Modo nodo activado'
  if (n && !n.error) text += ' · ' + n.connected + ' conectado(s)'
  $('node-status').textContent = text
}

function renderContacts() {
  const ul = $('contacts')
  ul.replaceChildren()
  if (state.contacts.length === 0) {
    ul.append(el('li', 'muted small', 'Aún no tienes contactos. Pega el código de un amigo abajo.'))
  }
  for (const c of state.contacts) {
    const li = el('li', 'contact' + (c.key === state.active ? ' active' : ''))
    const av = avatarOf(c.key)
    const face = ProfileUI.avatarEl(av.src, nameOf(c), 'small', av.crop)
    face.classList.add('clickable')
    face.title = 'Ver perfil'
    face.onclick = (ev) => { ev.stopPropagation(); openProfile(c) }
    li.append(el('span', 'dot ' + (c.online ? 'on' : 'off')), face, el('span', '', nameOf(c)))
    if (state.verification) {
      li.append(c.verified ? el('span', 'verified', '✓') : el('span', 'unverified', 'sin registrar'))
    }
    if (state.unread.has(c.key)) li.append(el('span', 'badge', '●'))
    li.onclick = () => openChat(c.key)
    ul.append(li)
  }
}

function renderRequests() {
  $('requests-box').hidden = state.requests.length === 0
  const ul = $('requests')
  ul.replaceChildren()
  for (const r of state.requests) {
    const li = el('li', 'request')
    const mark = state.verification ? (r.verified ? ' ✓ nombre registrado' : ' (nombre sin registrar)') : ''
    li.append(el('span', '', (r.name || 'Alguien') + mark + ' · código ' + r.key.slice(0, 8) + '… · quiere conectar'))
    const yes = el('button', 'primary', 'Aceptar')
    yes.onclick = () => act(() => rpc('request-accept', { key: r.key }))
    const no = el('button', '', 'Rechazar y bloquear')
    no.onclick = () => act(() => rpc('request-reject', { key: r.key }))
    li.append(yes, no)
    ul.append(li)
  }
}

async function act(fn) {
  try { await fn() } catch (err) { toast(err.message) }
  await refreshContacts()
}

$('add-form').onsubmit = async (e) => {
  e.preventDefault()
  setMsg('add-error', '')
  try {
    await rpc('contact-add', { code: $('add-code').value, name: $('add-name').value })
    $('add-code').value = ''
    $('add-name').value = ''
    await refreshContacts()
  } catch (err) {
    setMsg('add-error', err.message)
  }
}

$('btn-attach').onclick = async () => {
  if (!state.active) return
  try {
    const r = await rpc('file-send', { key: state.active })
    if (!r.canceled) toast('Archivo ofrecido: tu contacto decide si lo descarga.')
  } catch (err) { toast(err.message) }
}

$('btn-profile').onclick = () => {
  const c = state.contacts.find((x) => x.key === state.active)
  if (c) openProfile(c)
}
$('me-avatar').onclick = () => ProfileUI.view({ key: state.me.code, name: state.me.username, verified: state.me.verified, isMe: true })
$('me-avatar').onkeydown = (e) => { if (e.key === 'Enter') $('me-avatar').click() }
ProfileUI.init({ rpc, toast, getMe: () => state.me, onSaved: () => refreshOwnAvatar() })
ServersUI.init({ rpc, toast, getMe: () => state.me, showArea })
LinkUI.init({ rpc, toast })

$('btn-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(state.me.code)
    toast('Código copiado')
  } catch {
    toast('No se pudo copiar. Selecciona el código y cópialo a mano.')
  }
}

// ---------- Chat ----------

async function openChat(key) {
  showArea('chat')
  ServersUI.leaveView()
  state.active = key
  state.unread.delete(key)
  $('send-form').hidden = false
  $('chat-hint').hidden = false
  $('btn-remove').hidden = false
  renderContacts()
  renderChatHeader()
  await loadChat(key)
  $('send-text').focus()
}

function renderChatHeader() {
  const c = state.contacts.find((x) => x.key === state.active)
  if (!c) {
    $('chat-title').textContent = 'Elige un contacto para empezar'
    $('chat-avatar').replaceChildren()
    $('btn-call').hidden = true
    $('btn-remove').hidden = true
    $('btn-profile').hidden = true
    return
  }
  const av = avatarOf(c.key)
  $('chat-avatar').replaceChildren(ProfileUI.avatarEl(av.src, nameOf(c), '', av.crop))
  $('btn-profile').hidden = false
  const mark = state.verification ? (c.verified ? ' ✓' : ' (sin registrar)') : ''
  $('chat-title').textContent = nameOf(c) + mark + (c.online ? ' · en línea' : ' · desconectado')
  $('btn-call').hidden = !(c.online && state.call.state === 'idle')
}

function formatSize(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
}

// Ficha de un archivo compartido. La vista previa solo muestra imágenes verificadas o texto plano; nada se abre ni se ejecuta.
function fileCard(m, time) {
  const f = m.file
  const key = state.active
  const card = el('div', 'filecard ' + (m.from === 'me' ? 'me' : 'them'))
  card.dataset.id = m.id
  card.append(
    el('div', 'fname', '📎 ' + f.name),
    el('div', 'small muted', formatSize(f.size) + ' · ' + f.mime + ' · SHA-256 ' + f.sha.slice(0, 12) + '…')
  )
  if (f.dangerous) card.append(el('div', 'small error', '⚠ Este tipo de archivo puede contener virus. No lo abras si no confías al 100 % en quien lo envió.'))
  const row = el('div', 'row')
  const preview = el('div', 'fpreview')
  const button = (label, fn) => { const b = el('button', '', label); b.type = 'button'; b.onclick = fn; row.append(b) }
  const run = async (fn) => { try { return await fn() } catch (err) { toast(err.message) } }

  if (f.state === 'offered') button('Descargar (' + formatSize(f.size) + ')', () => run(() => rpc('file-download', { key, id: m.id })))
  else if (f.state === 'downloading') row.append(el('span', 'small muted', 'Descargando…'))
  else if (f.state === 'failed') button('Reintentar descarga', () => run(() => rpc('file-download', { key, id: m.id })))
  else {
    button('Vista previa', () => run(async () => {
      const p = (await rpc('file-get', { key, id: m.id })).preview
      preview.replaceChildren()
      if (p.kind === 'image') {
        const img = document.createElement('img')
        img.className = 'fimg'
        img.alt = ''
        img.src = p.url
        preview.append(img)
      } else if (p.kind === 'text') {
        preview.append(el('pre', 'ftext', p.text + (p.truncated ? '\n…' : '')))
      } else {
        preview.append(el('div', 'small muted', 'No hay vista previa para este tipo de archivo (por seguridad, la app nunca abre archivos).'))
      }
    }))
    button('Guardar como…', () => run(async () => {
      if (f.dangerous && !confirm('⚠ Este archivo es de un tipo que puede contener virus.\n\nGuardarlo no lo ejecuta, pero si luego lo abres, será bajo tu responsabilidad.\n\n¿Guardarlo igualmente?')) return
      const r = await rpc('file-save', { key, id: m.id })
      if (r.saved) toast('Archivo guardado')
    }))
  }
  card.append(row, preview, el('div', 'meta small muted', time + (m.from === 'me' ? (m.status === 'delivered' ? ' ✓' : ' ⏳') : '')))
  return card
}

function callText(c) {
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
  const out = c.dir === 'out'
  switch (c.result) {
    case 'ended': return (out ? '📞 Llamada saliente' : '📞 Llamada entrante') + ' · ' + mmss(c.duration)
    case 'missed': return '📵 Llamada perdida'
    case 'declined': return out ? '🚫 Llamada rechazada por el contacto' : '🚫 Rechazaste la llamada'
    case 'cancelled': return '📞 Llamada cancelada'
    case 'unanswered': return '📞 Sin respuesta'
    case 'busy': return out ? '📞 El contacto estaba ocupado' : '📵 Llamada perdida (estabas en otra llamada)'
    default: return '📞 Llamada interrumpida'
  }
}

async function loadChat(key) {
  const { messages } = await rpc('chat', { key })
  if (state.active !== key) return
  const box = $('messages')
  box.replaceChildren()
  for (const m of messages) {
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (m.kind === 'call') { // registro de llamada
      box.append(el('div', 'callog', callText(m.call) + ' · ' + time))
      continue
    }
    if (m.kind === 'file') { box.append(fileCard(m, time)); continue }
    const status = m.from === 'me' ? (m.status === 'delivered' ? ' ✓' : ' ⏳') : ''
    const bubble = el('div', 'msg ' + (m.from === 'me' ? 'me' : 'them'))
    bubble.dataset.id = m.id
    const body = el('span', '')
    LinkUI.render(m.text, body)
    bubble.append(body, el('span', 'meta', time + status))
    box.append(bubble)
  }
  box.scrollTop = box.scrollHeight
  if (state.focusMsg) { // venimos del buscador: ir al mensaje y resaltarlo
    const target = [...box.children].find((n) => n.dataset && n.dataset.id === state.focusMsg)
    state.focusMsg = null
    if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash') }
  }
}

$('send-form').onsubmit = async (e) => {
  e.preventDefault()
  const text = $('send-text').value.trim()
  if (!text || !state.active) return
  $('send-text').value = ''
  try { await rpc('send', { key: state.active, text }) } catch (err) { toast(err.message) }
}

$('btn-remove').onclick = async () => {
  if (!state.active || !confirm('¿Eliminar este contacto y su historial de chat?')) return
  const key = state.active
  state.active = null
  $('messages').replaceChildren()
  $('send-form').hidden = true
  $('chat-hint').hidden = true
  await act(() => rpc('contact-remove', { key }))
}

// ---------- Llamadas ----------

$('btn-call').onclick = () => act(() => rpc('call-start', { key: state.active }))
$('call-accept').onclick = () => rpc('call-accept').catch((err) => toast(err.message))
$('call-end').onclick = () => rpc('call-end').catch(() => {})
$('call-mute').onclick = () => {
  audio.muted = !audio.muted
  $('call-mute').textContent = audio.muted ? 'Activar micrófono' : 'Silenciar'
}

const END_REASONS = {
  busy: 'El contacto está en otra llamada',
  missed: 'Llamada perdida',
  timeout: 'Sin respuesta',
  'peer-left': 'Se perdió la conexión',
  remote: 'El contacto colgó'
}

let callTimer = null

function renderCall(c) {
  const previous = state.call.state
  state.call = c
  $('call').hidden = c.state === 'idle'
  clearInterval(callTimer)

  if (c.state === 'idle') {
    stopAudio()
    if (END_REASONS[c.reason]) toast(END_REASONS[c.reason])
    renderChatHeader()
    return
  }

  $('call-title').textContent = c.name || 'Contacto'
  $('call-accept').hidden = c.state !== 'ringing'
  $('call-mute').hidden = c.state !== 'active'
  $('call-end').textContent = c.state === 'ringing' ? 'Rechazar' : 'Colgar'
  $('call-sub').textContent = { calling: 'Llamando…', ringing: 'Llamada entrante', active: '00:00' }[c.state]
  renderChatHeader()

  if (c.state === 'active') {
    callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - c.startedAt) / 1000)
      $('call-sub').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
    }, 500)
    if (previous !== 'active') beginAudio()
  }
}

// ---------- Audio de la llamada ----------
// Micrófono -> números de 16 bits -> conexión cifrada -> reproducir al otro lado.

const audio = { ctx: null, stream: null, source: null, processor: null, nextTime: 0, muted: false }

async function beginAudio() {
  try {
    await startAudio()
  } catch (err) {
    toast('No se pudo usar el micrófono: ' + err.message)
    rpc('call-end').catch(() => {})
  }
}

async function startAudio() {
  stopAudio()
  audio.muted = false
  $('call-mute').textContent = 'Silenciar'
  audio.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
  audio.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  await audio.ctx.resume()
  audio.source = audio.ctx.createMediaStreamSource(audio.stream)
  // ScriptProcessor es antiguo pero simple. Si algún día se retira, cambiar por AudioWorklet.
  audio.processor = audio.ctx.createScriptProcessor(1024, 1, 1)
  audio.processor.onaudioprocess = (ev) => {
    if (audio.muted) return
    const input = ev.inputBuffer.getChannelData(0)
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    window.api.sendAudio(new Uint8Array(pcm.buffer))
  }
  audio.source.connect(audio.processor)
  audio.processor.connect(audio.ctx.destination) // necesario para que se ejecute; su salida es silencio
  audio.nextTime = 0
}

function stopAudio() {
  if (audio.processor) { audio.processor.onaudioprocess = null; audio.processor.disconnect() }
  if (audio.source) audio.source.disconnect()
  if (audio.stream) audio.stream.getTracks().forEach((t) => t.stop())
  if (audio.ctx) audio.ctx.close().catch(() => {})
  audio.ctx = audio.stream = audio.source = audio.processor = null
}

function playChunk(bytes) {
  if (!audio.ctx) return
  const n = Math.floor(bytes.length / 2)
  if (n === 0) return
  const copy = new ArrayBuffer(n * 2) // copia alineada para poder leerla como Int16
  new Uint8Array(copy).set(bytes.subarray(0, n * 2))
  const pcm = new Int16Array(copy)

  const buffer = audio.ctx.createBuffer(1, n, SAMPLE_RATE)
  const out = buffer.getChannelData(0)
  for (let i = 0; i < n; i++) out[i] = pcm[i] / 32768

  const source = audio.ctx.createBufferSource()
  source.buffer = buffer
  source.connect(audio.ctx.destination)

  // Pequeño colchón (80 ms) para absorber irregularidades de la red
  const now = audio.ctx.currentTime
  if (audio.nextTime < now + 0.02 || audio.nextTime - now > 0.4) audio.nextTime = now + 0.08
  source.start(audio.nextTime)
  audio.nextTime += buffer.duration
}

// ---------- Privacidad de red ----------

async function openPrivacy() {
  const r = await rpc('privacy-get')
  $('privacy-mode').textContent = { private: 'Privado', normal: 'Normal', custom: 'Personalizado' }[r.mode]
  const ul = $('privacy-rows')
  ul.replaceChildren()
  for (const row of r.rows) {
    const li = el('li', '')
    li.append(el('span', 'lvl ' + row.level, row.level), el('strong', '', row.who + ': '), el('span', '', row.sees))
    ul.append(li)
  }
  $('privacy-on').disabled = r.mode === 'private'
  $('privacy-off').disabled = r.mode === 'normal'
  if (!$('privacy-dialog').open) $('privacy-dialog').showModal()
}
$('btn-privacy').onclick = () => openPrivacy().catch((err) => toast(err.message))
$('privacy-on').onclick = async () => { try { await rpc('privacy-set', { mode: 'private' }); await refreshMe(); await openPrivacy() } catch (err) { toast(err.message) } }
$('privacy-off').onclick = async () => { try { await rpc('privacy-set', { mode: 'normal' }); await refreshMe(); await openPrivacy() } catch (err) { toast(err.message) } }
$('privacy-close').onclick = () => $('privacy-dialog').close()

// ---------- Buscador ----------

let searchTimer = null
async function runSearch() {
  const q = $('search-q').value.trim()
  const ul = $('search-results')
  ul.replaceChildren()
  if (q.length < 2) return
  let results = []
  try { results = (await rpc('search', { q, scope: $('search-scope').value })).results } catch (err) { return toast(err.message) }
  if (!results.length) ul.append(el('li', 'muted small', 'No se encontró nada.'))
  for (const r of results) {
    const li = el('li', 'result')
    const when = new Date(r.ts).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    const where = r.type === 'chat' ? 'Chat con ' + (r.who || 'contacto') : r.server + ' › #' + r.channel
    const author = r.type === 'chat' ? (r.mine ? 'Tú' : r.who || '') : r.name
    li.append(el('div', 'small muted', where + ' · ' + author + ' · ' + when), el('div', '', r.text))
    li.onclick = () => {
      $('search-dialog').close()
      if (r.type === 'chat') { state.focusMsg = r.id; openChat(r.key) } else ServersUI.open(r.sid, { cid: r.cid, id: r.id })
    }
    ul.append(li)
  }
}
$('btn-search').onclick = () => { $('search-dialog').showModal(); $('search-q').focus() }
$('search-q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250) }
$('search-scope').onchange = runSearch
$('search-close').onclick = () => $('search-dialog').close()

// ---------- Ajustes ----------

function fillBackgroundSettings() {
  $('set-bg').checked = state.me.runInBackground
  $('set-auto').checked = state.me.autoStart
  $('set-auto').disabled = !state.me.packaged
}

$('set-bg').onchange = async (e) => {
  try {
    await rpc('set-background', { background: e.target.checked, autostart: e.target.checked && $('set-auto').checked })
    await refreshMe()
    fillBackgroundSettings()
  } catch (err) { e.target.checked = !e.target.checked; setMsg('set-msg', err.message) }
}

$('set-auto').onchange = async (e) => {
  try {
    await rpc('set-background', { background: $('set-bg').checked || e.target.checked, autostart: e.target.checked })
    await refreshMe()
    fillBackgroundSettings()
  } catch (err) { e.target.checked = !e.target.checked; setMsg('set-msg', err.message) }
}

async function openSettings() {
  await refreshMe()
  $('set-node').checked = state.me.nodeMode
  fillBackgroundSettings()
  $('set-remember').checked = state.me.remembered
  $('set-accept').checked = state.me.acceptRequests
  $('set-key-status').textContent = state.me.hasKeyfile ? 'activa' : 'no creada'
  $('btn-key-del').hidden = !state.me.hasKeyfile
  $('btn-key-new').textContent = state.me.hasKeyfile ? 'Crear una nueva (reemplaza la anterior)' : 'Crear clave de acceso'
  setMsg('set-msg', '')
  $('settings').showModal()
}

$('btn-settings').onclick = () => openSettings().catch((err) => toast(err.message))
$('btn-settings-close').onclick = () => $('settings').close()

$('set-node').onchange = async (e) => {
  try { await rpc('set-node-mode', { value: e.target.checked }); await refreshContacts() } catch (err) { toast(err.message) }
}

$('set-accept').onchange = async (e) => {
  try { await rpc('set-accept-requests', { value: e.target.checked }); await refreshContacts() } catch (err) { toast(err.message) }
}

$('set-remember').onchange = async (e) => {
  try {
    await rpc('remember-set', { value: e.target.checked })
  } catch (err) {
    e.target.checked = !e.target.checked
    setMsg('set-msg', err.message)
  }
}

$('btn-key-new').onclick = async () => {
  try {
    const r = await rpc('keyfile-create')
    if (r.canceled) return
    setMsg('set-msg', 'Guardada en: ' + r.file, true)
    await openSettingsRefresh()
  } catch (err) {
    setMsg('set-msg', err.message)
  }
}

$('btn-key-del').onclick = async () => {
  try {
    await rpc('keyfile-remove')
    setMsg('set-msg', 'Clave de acceso eliminada. El archivo del pendrive ya no sirve.', true)
    await openSettingsRefresh()
  } catch (err) {
    setMsg('set-msg', err.message)
  }
}

async function openSettingsRefresh() {
  await refreshMe()
  $('set-key-status').textContent = state.me.hasKeyfile ? 'activa' : 'no creada'
  $('btn-key-del').hidden = !state.me.hasKeyfile
}

$('btn-logout').onclick = async () => {
  try { await rpc('logout') } catch {}
  location.reload() // vuelve a la pantalla de inicio de sesión
}

// ---------- Eventos que llegan desde la red ----------

window.api.onEvent((ev) => {
  switch (ev.type) {
    case 'contacts':
      refreshContacts().catch(() => {})
      break
    case 'chat':
      if (ev.key === state.active) loadChat(ev.key).catch(() => {})
      else if (ev.incoming) { state.unread.add(ev.key); renderContacts() }
      break
    case 'call':
      renderCall(ev.call)
      break
    case 'audio':
      playChunk(ev.buf)
      break
    case 'node':
      state.node = ev.info
      renderNode()
      break
    case 'servers':
    case 'server-msg':
    case 'server-invite':
      ServersUI.onEvent(ev)
      break
  }
})

boot().catch((err) => {
  show('login')
  setMsg('login-error', err.message)
})
