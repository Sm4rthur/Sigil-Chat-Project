'use strict'
// Lógica de la pantalla. No toca la red directamente: todo pasa por window.api (ver src/preload.js).

const $ = (id) => document.getElementById(id)

const state = {
  me: null,
  contacts: [],
  requests: [],
  node: null,
  active: null,          // clave del contacto con el chat abierto
  unread: new Set(),
  focusMsg: null,        // mensaje al que saltar después de abrir un chat desde el buscador
  verification: false,   // true si hay servicio de verificación: entonces se muestran las marcas
  notify: { notifications: true, sound: true, mutedContacts: [], mutedServers: [] },
  call: { state: 'idle' },
  voice: null,           // { sid, cid } si estoy dentro de un canal de voz
  micMuted: false
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

// Iconos estáticos del HTML (una sola biblioteca, sin recursos externos).
IconUI.hydrate()

function makeActionable(node, action, label) {
  node.setAttribute('role', 'button')
  node.tabIndex = 0
  if (label) node.setAttribute('aria-label', label)
  node.onclick = action
  node.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action() }
  }
  return node
}

// ---------- Navegación principal y panel adaptable ----------

let panelView = 'chats'

function setPanel(view) {
  panelView = view === 'servers' ? 'servers' : 'chats'
  $('panel-chats').hidden = panelView !== 'chats'
  $('panel-servers').hidden = panelView !== 'servers'
  $('panel-title').textContent = panelView === 'servers' ? 'Servidores' : 'Mensajes'
}

// El rail resalta la sección activa (mensajes, contactos o servidores).
function setNav(name) {
  for (const [id, value] of [['btn-nav-chats', 'chats'], ['btn-nav-contacts', 'contacts'], ['btn-nav-servers', 'servers']]) {
    const button = $(id)
    const active = value === name
    button.classList.toggle('is-active', active)
    if (active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
}

const isNarrow = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches

function setPanelExpanded (expanded) {
  const shell = $('screen-main')
  if (expanded) {
    shell.classList.remove('panel-collapsed')
    if (isNarrow()) {
      shell.classList.add('panel-open')
      $('panel-scrim').hidden = false
      $('btn-panel-close').focus()
    }
  } else {
    shell.classList.remove('panel-open')
    $('panel-scrim').hidden = true
    // En ventanas estrechas el panel es un cajón: basta con cerrarlo.
    if (!isNarrow()) shell.classList.add('panel-collapsed')
  }
  syncMeCard()
}

// El panel de contactos solo se muestra en la pestaña de mensajes.
function openPanel() { setPanelExpanded(true) }
function closePanel() { setPanelExpanded(false) }
function closePanelIfNarrow() { if (isNarrow()) closePanel() }

// La tarjeta de perfil vive fuera del panel: se encoge a la barra del rail cuando el panel
// está cerrado, pero nunca desaparece de la esquina inferior izquierda.
function syncMeCard() {
  const card = document.querySelector ? document.querySelector('.me-card') : null
  if (!card) return
  const shell = $('screen-main')
  const open = isNarrow() ? shell.classList.contains('panel-open') : !shell.classList.contains('panel-collapsed')
  card.classList.toggle('is-compact', !open)
  const height = Math.max(56, Math.round(card.getBoundingClientRect().height))
  document.documentElement.style.setProperty('--me-card-h', height + 'px')
}

function initChrome() {
  $('btn-nav-chats').onclick = () => { setPanel('chats'); setNav('chats'); showArea('chat'); openPanel() }
  $('btn-nav-contacts').onclick = () => { setPanel('chats'); setNav('contacts'); showArea('contacts'); renderFriends() }
  $('btn-nav-servers').onclick = () => { setPanel('chats'); setNav('servers'); showArea('servers-home') }
  $('btn-panel-close').onclick = closePanel
  $('panel-scrim').onclick = closePanel
  $('btn-nav-chats').title = 'Mensajes'
  $('btn-nav-contacts').title = 'Contactos'
  $('btn-nav-servers').title = 'Servidores'
  setPanel('chats')
  setNav('chats')

  if (typeof window.matchMedia === 'function') {
    const narrow = window.matchMedia('(max-width: 900px)')
    const onChange = () => { if (!narrow.matches) $('panel-scrim').hidden = true; syncMeCard() }
    if (narrow.addEventListener) narrow.addEventListener('change', onChange)
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', syncMeCard)
  if (typeof ResizeObserver === 'function' && document.querySelector) {
    const card = document.querySelector('.me-card')
    if (card) new ResizeObserver(() => syncMeCard()).observe(card)
  }
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
  t.replaceChildren(IconUI.el('info', 16), el('span', '', text))
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
  await loadNotify()
  loading('Conectando con la red…')
  await waitForNetwork(7000)
  show('main')
  setPanel('chats')
  setNav('chats')
  $('chat-empty').hidden = false
  $('messages').hidden = true
  $('send-form').hidden = true
  $('chat-hint').hidden = true
  syncMeCard()
}

// El área principal muestra un chat con un contacto o un servidor.
function showArea(area) {
  $('chat').hidden = area !== 'chat'
  $('server-view').hidden = area !== 'server'
  $('contacts-home').hidden = area !== 'contacts'
  $('servers-home').hidden = area !== 'servers-home'
  // El panel de contactos solo acompaña a la pestaña de mensajes.
  if (area === 'chat') {
    if (!isNarrow()) openPanel()
  } else {
    closePanel()
  }
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
    $('mic-status').textContent = 'Permitido'
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
    $('me-avatar-card').replaceChildren(ProfileUI.avatarEl(r.avatar, state.me.username, '', r.crop))
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

// ---------- Notificaciones y silencio por contacto/servidor ----------

async function loadNotify() {
  const r = await rpc('notify-get')
  state.notify = {
    notifications: r.notifications !== false,
    sound: r.sound !== false,
    mutedContacts: r.mutedContacts || [],
    mutedServers: r.mutedServers || []
  }
  fillNotifySettings()
  renderMutedList()
}

async function refreshNotify() {
  await loadNotify()
  renderContacts()
}

function fillNotifySettings() {
  $('set-notif').checked = state.notify.notifications
  $('set-notif-sound').checked = state.notify.sound
  $('set-notif-sound').disabled = !state.notify.notifications
}

function renderMutedList() {
  const ul = $('muted-list')
  ul.replaceChildren()
  const contacts = state.contacts.filter((c) => state.notify.mutedContacts.includes(c.key))
  const servers = ServersUI.all().filter((s) => state.notify.mutedServers.includes(s.id))
  if (!contacts.length && !servers.length) {
    ul.append(el('li', 'hint', 'No hay contactos ni servidores silenciados.'))
    return
  }
  const row = (label, onEnable) => {
    const li = el('li', 'muted-item')
    const b = el('button', 'ghost compact', 'Activar')
    b.type = 'button'
    b.onclick = onEnable
    li.append(el('span', '', label), b)
    return li
  }
  for (const c of contacts) ul.append(row('Contacto · ' + nameOf(c), () => setContactMute(c, false)))
  for (const s of servers) ul.append(row('Servidor · ' + s.name, () => setServerMute(s, false)))
}

async function setContactMute(c, muted) {
  const r = await act(() => rpc('mute-contact', { key: c.key, value: muted }))
  if (!r) return
  c.muted = r.muted
  const set = new Set(state.notify.mutedContacts)
  if (r.muted) set.add(c.key)
  else set.delete(c.key)
  state.notify.mutedContacts = [...set]
  renderMutedList()
  renderContacts()
  toast(r.muted ? 'Notificaciones silenciadas para ' + nameOf(c) : 'Notificaciones activadas para ' + nameOf(c))
}

async function setServerMute(s, muted) {
  const r = await act(() => rpc('mute-server', { sid: s.id, value: muted }))
  if (!r) return
  s.muted = r.muted
  const set = new Set(state.notify.mutedServers)
  if (r.muted) set.add(s.id)
  else set.delete(s.id)
  state.notify.mutedServers = [...set]
  renderMutedList()
  await ServersUI.refreshList()
  toast(r.muted ? 'Notificaciones silenciadas en este servidor' : 'Notificaciones activadas')
}

// ---------- Menú contextual (contactos, servidores y ajustes) ----------

function muteMarkNode() {
  const wrap = el('span', 'mute-mark')
  wrap.append(IconUI.labeled('bell-off', 'Notificaciones silenciadas', 13))
  wrap.title = 'Notificaciones silenciadas'
  return wrap
}

function closeContextMenu() {
  const m = $('context-menu')
  m.hidden = true
  m.replaceChildren()
}

function openContextMenu(x, y, items) {
  const m = $('context-menu')
  m.replaceChildren()
  for (const item of items) {
    if (item.sep) { m.append(el('div', 'menu-sep')); continue }
    const b = el('button', '', item.label)
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    if (item.icon) b.prepend(IconUI.el(item.icon, 15))
    if (item.danger) b.classList.add('danger-text')
    if (item.disabled) b.disabled = true
    else b.onclick = () => { closeContextMenu(); item.run() }
    m.append(b)
  }
  m.hidden = false
  const rect = m.getBoundingClientRect()
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px'
  m.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px'
  const first = m.querySelector('button:not([disabled])')
  if (first) first.focus()
}

function openContactMenu(ev, c) {
  ev.preventDefault()
  ev.stopPropagation()
  openContextMenu(ev.clientX, ev.clientY, [
    { label: 'Abrir conversación', icon: 'message-square', run: () => openChat(c.key) },
    { label: 'Ver perfil', icon: 'user', run: () => openProfile(c) },
    { sep: true },
    {
      label: c.muted ? 'Activar notificaciones' : 'Silenciar notificaciones',
      icon: c.muted ? 'bell' : 'bell-off',
      run: () => setContactMute(c, !c.muted)
    }
  ])
}

if (typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', (e) => {
    const m = $('context-menu')
    if (!m.hidden && !m.contains(e.target)) closeContextMenu()
  })
}

$('context-menu').onkeydown = (e) => {
  const buttons = [...$('context-menu').querySelectorAll('button:not([disabled])')]
  if (!buttons.length) return
  const i = buttons.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus() }
  else if (e.key === 'Escape') { e.preventDefault(); closeContextMenu() }
}

function renderNode() {  const n = state.node
  let text = ''
  if (!n) text = ''
  else if (n.error) text = 'Sin conexión a la red: ' + n.error
  else if (!n.nodeMode) text = 'Modo nodo desactivado'
  else if (n.acting === true) text = 'Estás ayudando a la red como nodo'
  else if (n.acting === false) text = 'Modo nodo: se activa solo cuando tu conexión es estable y accesible'
  else text = 'Modo nodo activado'
  if (n && !n.error) text += ' · ' + n.connected + ' conectado(s)'
  const box = $('node-status')
  box.replaceChildren(el('span', '', text))
  box.className = 'node-status small' + (n && n.error ? ' is-off' : (!n || !n.nodeMode ? ' is-warn' : ''))
}

function renderContacts() {
  const ul = $('contacts')
  ul.replaceChildren()
  $('contact-count').textContent = state.contacts.length ? String(state.contacts.length) : ''
  if (state.contacts.length === 0) {
    ul.append(el('li', 'hint', 'Aún no tienes contactos. Usa «Añadir contacto» con el código de un amigo.'))
  }
  for (const c of state.contacts) {
    const li = el('li', '')
    const button = el('button', 'nav-item contact' + (c.key === state.active ? ' active' : ''))
    button.type = 'button'
    if (c.key === state.active) button.setAttribute('aria-current', 'true')
    const presence = el('span', 'presence ' + (c.online ? 'online' : 'offline'))
    presence.title = c.online ? 'En línea' : 'Desconectado'
    presence.setAttribute('aria-label', presence.title)
    const av = avatarOf(c.key)
    const face = ProfileUI.avatarEl(av.src, nameOf(c), 'small', av.crop)
    face.classList.add('clickable')
    face.title = 'Ver perfil de ' + nameOf(c)
    face.onclick = (ev) => { ev.stopPropagation(); openProfile(c) }
    const name = el('span', 'label-text', nameOf(c))
    button.append(presence, face, name)
    if (state.verification) {
      button.append(c.verified ? IconUI.labeled('check', 'Nombre registrado', 13) : el('span', 'unverified', 'sin registrar'))
    }
    if (c.muted) button.append(muteMarkNode())
    if (state.unread.has(c.key)) {
      const unread = el('span', 'badge')
      unread.title = 'Mensajes sin leer'
      unread.setAttribute('aria-label', 'Mensajes sin leer')
      button.append(unread)
    }
    button.onclick = () => openChat(c.key)
    button.oncontextmenu = (ev) => openContactMenu(ev, c)
    li.append(button)
    ul.append(li)
  }
  renderFriends()
}

// Vista dedicada de contactos/amigos (recuadros hacia abajo con foto y acciones).
function renderFriends() {
  const ul = $('friends-list')
  ul.replaceChildren()
  if (state.contacts.length === 0) {
    ul.append(el('li', 'hint', 'Aún no tienes contactos. Usa «Añadir» con el código de un amigo.'))
    return
  }
  for (const c of state.contacts) {
    const li = el('li', 'friend-row')
    li.oncontextmenu = (ev) => openContactMenu(ev, c)
    const av = avatarOf(c.key)
    const face = ProfileUI.avatarEl(av.src, nameOf(c), '', av.crop)
    face.classList.add('clickable')
    face.title = 'Ver perfil de ' + nameOf(c)
    face.onclick = () => openProfile(c)
    const info = el('div', 'friend-info')
    const nameRow = el('div', 'friend-name')
    nameRow.append(el('strong', '', nameOf(c)))
    if (state.verification) {
      nameRow.append(c.verified ? IconUI.labeled('check', 'Nombre registrado', 13) : el('span', 'unverified', 'sin registrar'))
    }
    if (c.muted) nameRow.append(muteMarkNode())
    const status = el('span', 'friend-status', c.online ? 'En línea' : 'Desconectado')
    status.oncontextmenu = (ev) => openContactMenu(ev, c)
    info.append(nameRow, status)
    const actions = el('div', 'friend-actions')
    const msg = el('button', 'ghost compact', 'Mensaje')
    msg.type = 'button'
    msg.onclick = () => openChat(c.key)
    const call = el('button', 'ghost compact', 'Llamar')
    call.type = 'button'
    call.disabled = !c.online || state.call.state !== 'idle'
    if (!c.online) call.title = 'Solo puedes llamar a contactos en línea'
    call.onclick = () => { state.active = c.key; act(() => rpc('call-start', { key: c.key })) }
    const prof = el('button', 'ghost compact', 'Perfil')
    prof.type = 'button'
    prof.onclick = () => openProfile(c)
    actions.append(msg, call, prof)
    li.append(face, info, actions)
    ul.append(li)
  }
}

function renderRequests() {
  $('requests-box').hidden = state.requests.length === 0
  const ul = $('requests')
  ul.replaceChildren()
  for (const r of state.requests) {
    const li = el('li', 'request')
    const mark = state.verification ? (r.verified ? ' · nombre registrado' : ' · nombre sin registrar') : ''
    li.append(el('span', '', (r.name || 'Alguien') + mark + ' · código ' + r.key.slice(0, 8) + '… · quiere conectar'))
    const yes = el('button', 'primary', 'Aceptar')
    yes.onclick = () => act(() => rpc('request-accept', { key: r.key }))
    const no = el('button', '', 'Rechazar')
    no.title = 'Rechazar y bloquear'
    no.setAttribute('aria-label', 'Rechazar y bloquear')
    no.onclick = () => act(() => rpc('request-reject', { key: r.key }))
    li.append(yes, no)
    ul.append(li)
  }
  renderRequestsBadge()
  announceRequests()
}

// Aviso sobre el recuadro de amigos mientras haya solicitudes pendientes.
function renderRequestsBadge() {
  const badge = $('contacts-badge')
  const n = state.requests.length
  badge.hidden = n === 0
  badge.textContent = n > 9 ? '9+' : String(n)
  badge.setAttribute('aria-label', n === 1 ? '1 solicitud de amistad pendiente' : n + ' solicitudes de amistad pendientes')
}

// Las solicitudes ya vistas no vuelven a avisar; solo las nuevas (o las pendientes al abrir).
const knownRequests = new Set()

function announceRequests() {
  const fresh = state.requests.filter((r) => !knownRequests.has(r.key))
  for (const r of state.requests) knownRequests.add(r.key)
  if (fresh.length) showRequestPopup(fresh[0], fresh.length)
}

let requestPopupTimer = null

// Emergente animado con la solicitud recibida. Se va solo tras unos segundos.
function showRequestPopup(req, extra = 0) {
  const box = $('request-popup')
  box.replaceChildren()
  box.append(IconUI.el('user-plus', 18))
  const text = el('div', 'request-popup-text')
  text.append(el('strong', '', extra > 1 ? extra + ' solicitudes de amistad' : 'Nueva solicitud de amistad'))
  text.append(el('span', 'small muted', (req.name || 'Alguien') + ' · código ' + req.key.slice(0, 8) + '… quiere conectar'))
  box.append(text)
  const see = el('button', 'ghost compact', 'Ver')
  see.type = 'button'
  see.onclick = () => { hideRequestPopup(); $('btn-nav-contacts').click() }
  box.append(see)
  box.hidden = false
  box.classList.remove('is-out')
  box.classList.remove('is-in')
  void box.offsetWidth // fuerza el reinicio de la transición
  box.classList.add('is-in')
  clearTimeout(requestPopupTimer)
  requestPopupTimer = setTimeout(hideRequestPopup, 6000)
}

function hideRequestPopup() {
  const box = $('request-popup')
  if (!box || box.hidden) return
  clearTimeout(requestPopupTimer)
  box.classList.remove('is-in')
  box.classList.add('is-out')
  requestPopupTimer = setTimeout(() => { box.hidden = true; box.classList.remove('is-out') }, 320)
}

async function act(fn) {
  try { await fn() } catch (err) { toast(err.message) }
  await refreshContacts()
}

// Ventana de un solo dato (Electron no tiene prompt()).
function askValue({ title, text = '', value = '', okLabel = 'Aceptar', readonly = false }) {
  return new Promise((resolve) => {
    const dialog = $('ask-dialog')
    const input = $('ask-input')
    $('ask-title').textContent = title
    $('ask-text').textContent = text
    $('ask-ok').textContent = okLabel
    input.value = value
    input.readOnly = readonly
    let result = null
    $('ask-ok').onclick = () => { result = input.value; dialog.close() }
    $('ask-cancel').onclick = () => dialog.close()
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('ask-ok').click() } }
    dialog.onclose = () => resolve(result)
    dialog.showModal()
    input.focus()
    input.select()
  })
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
const openMyProfile = () => ProfileUI.view({ key: state.me.code, name: state.me.username, verified: state.me.verified, isMe: true })
$('me-card-open').onclick = openMyProfile
$('btn-contacts-add').onclick = async () => {
  // La lista lateral ya no se muestra en Contactos: se pide el código en una ventana.
  const code = await askValue({ title: 'Añadir contacto', text: 'Pega el código único que te compartió.', okLabel: 'Siguiente' })
  if (!code) return
  const name = await askValue({ title: 'Añadir contacto', text: 'Nombre opcional para reconocerlo en tu lista.', okLabel: 'Añadir' })
  if (name === null) return
  try {
    await rpc('contact-add', { code, name })
    await refreshContacts()
    toast('Contacto añadido')
  } catch (err) { toast(err.message) }
}
$('btn-srv-create-home').onclick = () => $('btn-srv-create').click()
$('btn-srv-join-home').onclick = () => $('btn-srv-join').click()
ProfileUI.init({ rpc, toast, getMe: () => state.me, onSaved: () => refreshOwnAvatar() })
// ---------- Canales de voz de los servidores ----------
// A diferencia de una llamada, aquí no hay ventana propia: se entra y se sale
// desde el canal, y el anfitrión reparte el audio entre quienes están dentro.

const VoiceSession = {
  info: (sid) => (state.voice && state.voice.sid === sid ? { cid: state.voice.cid, muted: state.micMuted } : null),
  any: () => !!state.voice,
  async join(sid, cid) {
    if (state.voice && state.voice.sid === sid && state.voice.cid === cid) return
    if (state.voice) await VoiceSession.leave()
    await rpc('srv-voice-join', { sid, cid })
    state.voice = { sid, cid }
    try { await ensureAudio() } catch (err) {
      toast('Micrófono no disponible (' + err.message + '). Entrarás en modo solo escuchar.')
    }
  },
  async leave() {
    const v = state.voice
    state.voice = null
    if (v) { try { await rpc('srv-voice-leave', { sid: v.sid, cid: v.cid }) } catch {} }
    maybeStopAudio()
  },
  async setMuted(muted) {
    state.micMuted = !!muted
    AudioEngine.setMuted(state.micMuted)
    if (state.voice) { try { await rpc('srv-voice-mute', { sid: state.voice.sid, muted: state.micMuted }) } catch {} }
  }
}

ServersUI.init({
  rpc, toast, getMe: () => state.me, showArea, openPanel,
  onOpen: () => { setNav('servers'); setPanel('chats') },
  menu: openContextMenu,
  voice: VoiceSession,
  onNotifyChange: () => { refreshNotify().catch(() => {}) }
})
LinkUI.init({ rpc, toast })
initChrome()

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
  setPanel('chats')
  setNav('chats')
  showArea('chat')
  ServersUI.leaveView()
  state.active = key
  state.unread.delete(key)
  $('chat-empty').hidden = true
  $('messages').hidden = false
  $('send-form').hidden = false
  $('chat-hint').hidden = false
  $('btn-remove').hidden = false
  renderContacts()
  renderChatHeader()
  closePanelIfNarrow()
  await loadChat(key)
  $('send-text').focus()
}

function renderChatHeader() {
  const c = state.contacts.find((x) => x.key === state.active)
  if (!c) {
    $('chat-title').textContent = 'Elige una conversación'
    $('chat-sub').textContent = 'Tus mensajes se guardan cifrados en este equipo.'
    $('chat-empty').hidden = false
    $('messages').hidden = true
    $('chat-avatar').replaceChildren()
    $('btn-call').hidden = true
    $('btn-remove').hidden = true
    $('btn-profile').hidden = true
    return
  }
  const av = avatarOf(c.key)
  $('chat-avatar').replaceChildren(ProfileUI.avatarEl(av.src, nameOf(c), '', av.crop))
  $('chat-empty').hidden = true
  $('messages').hidden = false
  $('btn-profile').hidden = false
  const verified = state.verification ? (c.verified ? ' · nombre registrado' : ' · nombre sin registrar') : ''
  $('chat-title').textContent = nameOf(c)
  $('chat-sub').textContent = (c.online ? 'En línea' : 'Desconectado') + verified
  $('btn-call').hidden = !(c.online && state.call.state === 'idle')
}

function formatSize(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
}

function messageStatus(status) {
  const icon = IconUI.labeled(status === 'delivered' ? 'check' : 'clock', status === 'delivered' ? 'Entregado' : 'Pendiente de entrega', 13)
  icon.classList.add(status === 'delivered' ? 'icon-safe' : 'icon-warn')
  return icon
}

// Ficha de un archivo compartido. La vista previa solo muestra imágenes verificadas o texto plano; nada se abre ni se ejecuta.
function fileCard(m, time) {
  const f = m.file
  const key = state.active
  const card = el('div', 'filecard ' + (m.from === 'me' ? 'me' : 'them'))
  card.dataset.id = m.id
  const name = el('div', 'fname')
  name.append(IconUI.el('file', 16), el('span', '', f.name))
  card.append(
    name,
    el('div', 'small muted', formatSize(f.size) + ' · ' + f.mime + ' · SHA-256 ' + f.sha.slice(0, 12) + '…')
  )
  if (f.dangerous) {
    const warning = el('div', 'small error')
    warning.append(IconUI.el('alert-triangle', 14), el('span', '', 'Este tipo de archivo puede contener virus. No lo abras si no confías al 100 % en quien lo envió.'))
    card.append(warning)
  }
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
      if (f.dangerous && !confirm('Este archivo es de un tipo que puede contener virus.\n\nGuardarlo no lo ejecuta, pero si luego lo abres, será bajo tu responsabilidad.\n\n¿Guardarlo igualmente?')) return
      const r = await rpc('file-save', { key, id: m.id })
      if (r.saved) toast('Archivo guardado')
    }))
  }
  const meta = el('div', 'meta small muted')
  meta.append(el('span', '', time))
  if (m.from === 'me') meta.append(messageStatus(m.status))
  card.append(row, preview, meta)
  return card
}

function callText(c) {
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
  const out = c.dir === 'out'
  switch (c.result) {
    case 'ended': return (out ? 'Llamada saliente' : 'Llamada entrante') + ' · ' + mmss(c.duration)
    case 'missed': return 'Llamada perdida'
    case 'declined': return out ? 'Llamada rechazada por el contacto' : 'Rechazaste la llamada'
    case 'cancelled': return 'Llamada cancelada'
    case 'unanswered': return 'Sin respuesta'
    case 'busy': return out ? 'El contacto estaba ocupado' : 'Llamada perdida (estabas en otra llamada)'
    default: return 'Llamada interrumpida'
  }
}

function callIcon(c) {
  if (c.result === 'missed' || c.result === 'busy') return 'phone-missed'
  if (c.result === 'declined' || c.result === 'cancelled') return 'phone-off'
  return 'phone'
}

function showSkeleton(box) {
  box.replaceChildren()
  for (let i = 0; i < 4; i++) {
    const row = el('div', 'skeleton-row')
    row.append(el('span', 'skeleton-avatar'), el('span', 'skeleton-line'))
    box.append(row)
  }
}

function showChatError(err, key) {
  const box = $('messages')
  box.hidden = false
  box.replaceChildren()
  const wrap = el('div', 'empty-state')
  wrap.append(IconUI.el('alert-triangle', 28))
  wrap.append(el('h2', '', 'No se pudo cargar la conversación'))
  wrap.append(el('p', '', err.message || 'Revisa la conexión e inténtalo de nuevo.'))
  const retry = el('button', 'ghost', 'Reintentar')
  retry.type = 'button'
  retry.onclick = () => loadChat(key)
  wrap.append(retry)
  box.append(wrap)
}

async function loadChat(key) {
  const box = $('messages')
  box.hidden = false
  showSkeleton(box)
  let messages = []
  try {
    ({ messages } = await rpc('chat', { key }))
  } catch (err) {
    if (state.active === key) showChatError(err, key)
    return
  }
  if (state.active !== key) return
  box.replaceChildren()
  const contact = state.contacts.find((x) => x.key === key)
  const theirName = contact ? nameOf(contact) : 'Contacto'
  let current = null
  for (const m of messages) {
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (m.kind === 'call') { // registro de llamada
      const log = el('div', 'callog')
      log.append(IconUI.el(callIcon(m.call), 14), el('span', '', callText(m.call) + ' · ' + time))
      box.append(log)
      current = null
      continue
    }
    if (m.kind === 'file') {
      box.append(fileCard(m, time))
      current = null
      continue
    }
    const mine = m.from === 'me'
    const sameGroup = current && current.from === m.from && (m.ts - current.ts) < 5 * 60 * 1000
    const body = el('div', 'msg-body')
    body.dataset.id = m.id
    LinkUI.render(m.text, body)
    if (sameGroup) {
      current.content.append(body)
      current.ts = m.ts
      continue
    }
    const group = el('div', 'msg-group ' + (mine ? 'me' : 'them'))
    group.dataset.id = m.id
    const avatar = el('div', 'msg-avatar')
    const av = mine ? { src: '', crop: null } : avatarOf(key)
    avatar.append(ProfileUI.avatarEl(av.src, mine ? (state.me ? state.me.username : 'Tú') : theirName, 'small', av.crop))
    const content = el('div', 'msg-content')
    const head = el('div', 'msg-head')
    head.append(el('span', 'msg-who', mine ? 'Tú' : theirName), el('span', 'msg-time', time))
    if (mine) {
      const status = el('span', 'msg-meta')
      status.append(messageStatus(m.status))
      head.append(status)
    }
    content.append(head, body)
    group.append(avatar, content)
    box.append(group)
    current = { from: m.from, ts: m.ts, content }
  }
  box.scrollTop = box.scrollHeight
  if (state.focusMsg) { // venimos del buscador: ir al mensaje y resaltarlo
    const nodes = box.querySelectorAll ? [...box.querySelectorAll('[data-id]')] : [...box.children]
    const target = nodes.find((n) => n.dataset && n.dataset.id === state.focusMsg)
    state.focusMsg = null
    if (target) {
      const flash = target.closest ? (target.closest('.msg-group, .filecard') || target) : target
      flash.scrollIntoView({ block: 'center' })
      flash.classList.add('flash')
    }
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
  $('messages').hidden = true
  $('send-form').hidden = true
  $('chat-hint').hidden = true
  renderChatHeader()
  await act(() => rpc('contact-remove', { key }))
}

// ---------- Llamadas con amigos ----------

$('btn-call').onclick = () => act(() => rpc('call-start', { key: state.active }))
$('call-accept').onclick = () => rpc('call-accept').catch((err) => toast(err.message))
$('call-end').onclick = () => rpc('call-end').catch(() => {})
$('call-mute').onclick = () => setMicMuted(!state.micMuted)

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
    stopCallAudio()
    if (END_REASONS[c.reason]) toast(END_REASONS[c.reason])
    renderChatHeader()
    return
  }

  $('call-title').textContent = c.name || 'Contacto'
  $('call-avatar').replaceChildren(IconUI.el('user', 34))
  $('call-accept').hidden = c.state !== 'ringing'
  $('call-mute').hidden = c.state !== 'active'
  $('call-end-label').textContent = c.state === 'ringing' ? 'Rechazar' : 'Colgar'
  $('call-sub').textContent = { calling: 'Llamando…', ringing: 'Llamada entrante', active: '00:00' }[c.state]
  $('call-codec').textContent = c.state === 'active'
    ? (AudioEngine.opus ? 'Voz con Opus · cifrada de extremo a extremo' : 'Voz PCM · cifrada de extremo a extremo')
    : ''
  renderChatHeader()

  if (c.state === 'active') {
    callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - c.startedAt) / 1000)
      $('call-sub').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
    }, 500)
    if (previous !== 'active') beginCallAudio()
  }
}

// ---------- Audio (llamadas y canales de voz) ----------
// El motor vive en ui/audio.js: micrófono -> Opus -> conexión cifrada -> reproducir.
// Una sola captura sirve para las dos cosas: los paquetes salen por el destino activo.

function audioSender() {
  return (packet) => {
    if (state.call.state === 'active') window.api.sendAudio(packet)
    if (state.voice) window.api.sendVoice(state.voice.sid, state.voice.cid, packet)
  }
}

async function ensureAudio() {
  if (AudioEngine.isRunning()) AudioEngine.setSend(audioSender())
  else await AudioEngine.start(audioSender())
  AudioEngine.setMuted(state.micMuted)
}

function maybeStopAudio() {
  if (state.call.state !== 'active' && !state.voice) AudioEngine.stop()
}

function setMicMuted(muted) {
  state.micMuted = !!muted
  AudioEngine.setMuted(state.micMuted)
  const btn = $('call-mute')
  btn.setAttribute('aria-pressed', state.micMuted ? 'true' : 'false')
  $('call-mute-label').textContent = state.micMuted ? 'Activar micrófono' : 'Silenciar'
  btn.title = state.micMuted ? 'Activar micrófono' : 'Silenciar micrófono'
  ServersUI.onEvent({ type: 'voice-mute', sid: state.voice ? state.voice.sid : null })
}

async function beginCallAudio() {
  try { await ensureAudio() } catch (err) {
    toast('No se pudo usar el micrófono: ' + err.message)
    rpc('call-end').catch(() => {})
    return
  }
  const btn = $('call-mute')
  btn.setAttribute('aria-pressed', state.micMuted ? 'true' : 'false')
  $('call-mute-label').textContent = state.micMuted ? 'Activar micrófono' : 'Silenciar'
}

function stopCallAudio() {
  AudioEngine.dropSource('call')
  maybeStopAudio()
}

function playChunk(bytes) {
  AudioEngine.play(bytes, 'call')
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
    makeActionable(li, () => {
      $('search-dialog').close()
      if (r.type === 'chat') { state.focusMsg = r.id; openChat(r.key) } else ServersUI.open(r.sid, { cid: r.cid, id: r.id })
    }, 'Abrir resultado')
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
  await loadNotify()
  $('set-node').checked = state.me.nodeMode
  fillBackgroundSettings()
  $('set-remember').checked = state.me.remembered
  $('set-accept').checked = state.me.acceptRequests
  $('set-key-status').textContent = state.me.hasKeyfile ? 'activa' : 'no creada'
  $('btn-key-del').hidden = !state.me.hasKeyfile
  $('btn-key-new').textContent = state.me.hasKeyfile ? 'Crear nueva' : 'Crear clave'
  $('btn-key-new').title = state.me.hasKeyfile ? 'Reemplaza la clave de acceso actual' : 'Crear una clave de acceso en un pendrive'
  setMsg('set-msg', '')
  showSettingsSection('identity')
  if (!$('settings').open) $('settings').showModal()
}

function showSettingsSection(name) {
  document.querySelectorAll('[data-settings-panel]').forEach((button) => {
    const active = button.dataset.settingsPanel === name
    button.classList.toggle('is-active', active)
    if (active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  document.querySelectorAll('[data-settings-section]').forEach((section) => {
    section.hidden = section.dataset.settingsSection !== name
  })
}

document.querySelectorAll('[data-settings-panel]').forEach((button) => {
  button.onclick = () => showSettingsSection(button.dataset.settingsPanel)
})

$('btn-settings').onclick = () => openSettings().catch((err) => toast(err.message))
$('btn-settings-close').onclick = () => $('settings').close()

$('set-node').onchange = async (e) => {
  try { await rpc('set-node-mode', { value: e.target.checked }); await refreshContacts() } catch (err) { toast(err.message) }
}

$('set-accept').onchange = async (e) => {
  try { await rpc('set-accept-requests', { value: e.target.checked }); await refreshContacts() } catch (err) { toast(err.message) }
}

$('set-notif').onchange = async (e) => {
  try {
    const r = await rpc('notify-set', { notifications: e.target.checked })
    state.notify.notifications = r.notifications
    fillNotifySettings()
  } catch (err) { e.target.checked = !e.target.checked; setMsg('set-msg', err.message) }
}

$('set-notif-sound').onchange = async (e) => {
  try {
    const r = await rpc('notify-set', { sound: e.target.checked })
    state.notify.sound = r.sound
    fillNotifySettings()
  } catch (err) { e.target.checked = !e.target.checked; setMsg('set-msg', err.message) }
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
    case 'voice':
      if (state.voice && state.voice.sid === ev.sid && state.voice.cid === ev.cid) AudioEngine.play(ev.buf, ev.from)
      break
    case 'voice-end':
      if (state.voice && state.voice.sid === ev.sid && state.voice.cid === ev.cid) {
        state.voice = null
        maybeStopAudio()
      }
      ServersUI.onEvent(ev)
      break
  }
})

boot().catch((err) => {
  show('login')
  setMsg('login-error', err.message)
})
