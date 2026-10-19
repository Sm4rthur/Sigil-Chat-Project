'use strict'
// Servidores (grupos) en pantalla. El servidor vive en el PC de quien lo creó (el anfitrión).
// SEGURIDAD: nombres y mensajes de otras personas se dibujan SOLO con textContent. Nunca HTML.
const ServersUI = (() => {
  const byId = (id) => document.getElementById(id)
  const RANK = { member: 0, mod: 1, admin: 2, owner: 3 }
  const ROLE_LABEL = { owner: 'Dueño', admin: 'Admin', mod: 'Moderador', member: 'Miembro' }
  const ROLE_GROUP = { owner: 'Dueño', admin: 'Administradores', mod: 'Moderadores', member: 'Miembros' }
  const GONE_TEXT = {
    kicked: 'Te expulsaron del servidor', banned: 'Te banearon del servidor',
    closed: 'El servidor fue eliminado', left: 'Saliste del servidor'
  }

  let rpc = null
  let toast = () => {}
  let getMe = () => null
  let showArea = () => {}
  let openPanel = () => {}
  let onOpen = () => {}
  let menu = () => {}
  let onNotifyChange = () => {}
  let voice = { info: () => null, any: () => false, join: async () => {}, leave: async () => {}, setMuted: async () => {} }
  const st = { list: [], current: null, view: null, cid: null, unread: new Set(), joining: false, focus: null, editingRole: null }

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function avatarFor(name) {
    return el('span', 'avatar small', String(name || '?').trim().charAt(0).toUpperCase() || '?')
  }

  function presence(online, label) {
    const dot = el('span', 'presence ' + (online ? 'online' : 'offline'))
    dot.title = label
    dot.setAttribute('aria-label', label)
    return dot
  }

  // Pregunta un dato en una ventana (Electron no tiene prompt()).
  function ask({ title, text = '', value = '', okLabel = 'Aceptar', readonly = false }) {
    return new Promise((resolve) => {
      const dialog = byId('ask-dialog')
      const input = byId('ask-input')
      byId('ask-title').textContent = title
      byId('ask-text').textContent = text
      byId('ask-ok').textContent = okLabel
      input.value = value
      input.readOnly = readonly
      let result = null
      byId('ask-ok').onclick = () => { result = input.value; dialog.close() }
      byId('ask-cancel').onclick = () => dialog.close()
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); byId('ask-ok').click() } }
      dialog.onclose = () => resolve(result)
      dialog.showModal()
      input.focus()
      input.select()
    })
  }

  async function act(fn) {
    try { return await fn() } catch (err) { toast(err.message); return null }
  }

  // Si dos personas del servidor se llaman igual, se añade parte de su código para distinguirlas (anti-suplantación)
  function shown(name, key) {
    const dup = st.view && st.view.members.some((m) => m.key !== key && m.name.toLowerCase() === String(name).toLowerCase())
    return dup ? name + ' · ' + key.slice(0, 4) : name
  }

  const can = (min) => st.view && RANK[st.view.myRole] >= RANK[min]
  const channelKey = (sid, cid) => sid + ':' + cid

  // ---------- Roles personalizados ----------

  function roleDef(id) {
    return st.view ? (st.view.customRoles || []).find((r) => r.id === id) || null : null
  }

  // Nombre y color visibles de un miembro: su rol personalizado o su nivel base.
  function roleInfo(m) {
    const cr = roleDef(m.roleId)
    return cr
      ? { name: cr.name, color: cr.color, base: cr.base, custom: true }
      : { name: ROLE_LABEL[m.role], color: '', base: m.role, custom: false }
  }

  function roleColor(node, info) {
    if (info.color) node.style.color = info.color
    return node
  }

  // ---------- Lista de servidores ----------

  async function refreshList() {
    try { st.list = (await rpc('srv-list')).servers } catch { return }
    const ul = byId('servers')
    ul.replaceChildren()
    if (!st.list.length) ul.append(el('li', 'hint', 'Aún no estás en ningún servidor.'))
    for (const s of st.list) {
      const li = el('li', '')
      const button = el('button', 'nav-item server server-item' + (s.id === st.current ? ' active' : ''))
      button.type = 'button'
      if (s.id === st.current) button.setAttribute('aria-current', 'true')
      button.append(el('span', 'server-mark-sm', serverInitial(s.name)))
      button.append(el('span', 'label-text', s.name))
      button.append(presence(s.hostOnline, s.hostOnline ? 'Anfitrión en línea' : 'Anfitrión desconectado'))
      const lock = IconUI.el(s.e2ee ? 'lock' : 'alert-triangle', 14, s.e2ee ? 'icon-safe' : 'icon-warn')
      lock.setAttribute('title', s.e2ee ? 'Cifrado de extremo a extremo' : 'Sin cifrado de extremo a extremo')
      button.append(lock)
      button.append(el('span', 'sr-only', s.e2ee ? 'Cifrado de extremo a extremo' : 'Sin cifrado'))
      if (s.muted) button.append(muteMark())
      if ([...st.unread].some((k) => k.startsWith(s.id + ':'))) {
        const unread = el('span', 'badge')
        unread.title = 'Mensajes sin leer'
        unread.setAttribute('aria-label', 'Mensajes sin leer')
        button.append(unread)
      }
      button.onclick = () => open(s.id)
      button.oncontextmenu = (ev) => openServerMenu(ev, s)
      li.append(button)
      ul.append(li)
    }

    // Vista "Tus servidores": recuadros hacia abajo con la inicial o el nombre.
    const grid = byId('servers-grid')
    grid.replaceChildren()
    if (!st.list.length) {
      grid.append(el('li', 'hint', 'Aún no estás en ningún servidor. Crea uno o únete con una invitación.'))
    }
    for (const s of st.list) {
      const li = el('li', '')
      const card = el('button', 'server-card')
      card.type = 'button'
      card.append(el('span', 'server-mark', serverInitial(s.name)))
      const info = el('span', 'server-info')
      const nameRow = el('span', 'server-name-row')
      nameRow.append(el('strong', '', s.name))
      if (s.muted) nameRow.append(muteMark())
      if ([...st.unread].some((k) => k.startsWith(s.id + ':'))) {
        const unread = el('span', 'badge')
        unread.title = 'Mensajes sin leer'
        unread.setAttribute('aria-label', 'Mensajes sin leer')
        nameRow.append(unread)
      }
      info.append(nameRow, el('span', 'server-meta', serverMeta(s)))
      card.append(info)
      const lock = IconUI.el(s.e2ee ? 'lock' : 'alert-triangle', 16, s.e2ee ? 'icon-safe' : 'icon-warn')
      lock.setAttribute('title', s.e2ee ? 'Cifrado de extremo a extremo' : 'Sin cifrado de extremo a extremo')
      card.append(lock)
      card.onclick = () => open(s.id)
      card.oncontextmenu = (ev) => openServerMenu(ev, s)
      li.append(card)
      grid.append(li)
    }
  }

  function serverMeta(s) {
    const role = s.myRoleName || ROLE_LABEL[s.myRole]
    return role + (s.mine ? ' · tuyo' : '') + ' · ' + (s.hostOnline ? 'en línea' : 'desconectado') + (s.muted ? ' · silenciado' : '')
  }

  function muteMark() {
    const wrap = el('span', 'mute-mark')
    wrap.append(IconUI.labeled('bell-off', 'Notificaciones silenciadas', 13))
    wrap.title = 'Notificaciones silenciadas'
    return wrap
  }

  function openServerMenu(ev, s) {
    ev.preventDefault()
    ev.stopPropagation()
    menu(ev.clientX, ev.clientY, [
      { label: 'Abrir servidor', icon: 'server', run: () => open(s.id) },
      {
        label: s.muted ? 'Activar notificaciones' : 'Silenciar notificaciones',
        icon: s.muted ? 'bell' : 'bell-off',
        run: async () => {
          const r = await act(() => rpc('mute-server', { sid: s.id, value: !s.muted }))
          if (!r) return
          s.muted = r.muted
          toast(r.muted ? 'Notificaciones silenciadas en este servidor' : 'Notificaciones activadas')
          await refreshList()
          onNotifyChange()
        }
      }
    ])
  }

  // Inicial del servidor cuando no hay foto (los servidores aún no tienen imagen).
  function serverInitial(name) {
    const t = (name || '').trim()
    return t ? Array.from(t)[0] : '#'
  }

  // ---------- Vista de un servidor ----------

  async function open(sid, focus = null) {
    st.current = sid
    st.cid = focus ? focus.cid : null
    st.focus = focus
    onOpen()
    showArea('server')
    await refreshView()
    refreshList()
  }

  async function refreshView() {
    if (!st.current) return
    try { st.view = (await rpc('srv-get', { sid: st.current })).server } catch { st.view = null; st.current = null; showArea('chat'); openPanel(); return }
    const v = st.view
    if (!v.channels.some((c) => c.id === st.cid)) st.cid = v.channels[0].id
    st.unread.delete(channelKey(v.id, st.cid))
    byId('srv-name').textContent = v.name
    const meMember = v.members.find((m) => m.key === getMe().code)
    const mine = meMember ? roleInfo(meMember) : { name: ROLE_LABEL[v.myRole] }
    byId('srv-role').textContent = mine.name + (v.mine ? ' · anfitrión (tu PC)' : '') + (v.e2ee ? ' · cifrado de extremo a extremo' : ' · sin cifrado')
    byId('srv-host').textContent = v.hostOnline ? 'Anfitrión en línea' : 'Anfitrión desconectado'
    byId('srv-host').title = v.hostOnline ? 'El computador que aloja el servidor está conectado' : 'El servidor no está disponible ahora mismo'
    byId('srv-invite').hidden = !(v.e2ee ? v.myRole === 'owner' : can('mod')) // en servidores cifrados solo el dueño invita
    byId('srv-leave').textContent = v.mine ? 'Eliminar' : 'Salir'
    byId('srv-leave').title = v.mine ? 'Eliminar servidor' : 'Salir del servidor'
    byId('srv-leave').setAttribute('aria-label', v.mine ? 'Eliminar servidor' : 'Salir del servidor')
    byId('srv-form').hidden = !(v.hostOnline && (!v.e2ee || v.hasKey))
    renderNote()
    renderChannels()
    renderVoice()
    renderMembers()
    renderAudit()
    if (byId('srv-settings-dialog').open) renderSettings()
    const activeChan = v.channels.find((c) => c.id === st.cid)
    if (!activeChan || activeChan.kind !== 'voice') await loadMessages()
  }

  // Aviso sobre el estado del cifrado
  function renderNote() {
    const v = st.view
    const note = byId('srv-note')
    let text = ''
    let warn = false
    let icon = 'lock'
    if (!v.e2ee) {
      text = 'Servidor sin cifrado de extremo a extremo: el anfitrión puede leer todo lo que se escribe aquí.'
      warn = true
      icon = 'alert-triangle'
    } else if (!v.hasKey) {
      text = 'Esperando que el dueño te apruebe y te entregue la clave (debe estar conectado). Aún no puedes leer ni escribir. Si tienes una invitación antigua, pide una nueva.'
      icon = 'clock'
    } else if (v.needsRotation) {
      text = 'Alguien salió del servidor y falta que el dueño renueve la clave. Hasta entonces, quien salió podría seguir leyendo si el anfitrión se lo permite.'
      warn = true
      icon = 'alert-triangle'
    } else if (v.mine && v.myRole === 'owner') {
      text = 'Cifrado de extremo a extremo. Quienes entren solo leerán lo que se escriba desde que se unan.'
      icon = 'shield'
    }
    note.hidden = !text
    note.className = 'srv-note small' + (warn ? ' warn' : '')
    note.replaceChildren()
    if (text) note.append(IconUI.el(icon, 14), el('span', '', text))
  }

  function renderChannels() {
    const box = byId('srv-channels')
    box.replaceChildren()
    const active = st.view.channels.find((c) => c.id === st.cid)
    byId('srv-channel-title').textContent = active ? (active.kind === 'voice' ? 'Voz · ' + active.name : '# ' + active.name) : '# canal'
    const mine = voice.info(st.view.id)
    for (const c of st.view.channels) {
      const isVoice = c.kind === 'voice'
      const joined = isVoice && mine && mine.cid === c.id
      const button = el('button', 'nav-item chan' + (isVoice ? ' chan-voice' : '') + (joined ? ' joined' : '') + (c.id === st.cid ? ' active' : ''))
      button.type = 'button'
      if (c.id === st.cid) button.setAttribute('aria-current', 'true')
      button.append(IconUI.el(isVoice ? 'volume-2' : 'hash', 15), el('span', 'label-text', c.name))
      if (isVoice) {
        const inside = st.view.voice[c.id] || []
        if (inside.length) {
          const n = el('span', 'voice-count', String(inside.length))
          n.title = inside.length + (inside.length === 1 ? ' persona en el canal de voz' : ' personas en el canal de voz')
          n.setAttribute('aria-label', n.title)
          button.append(n)
        }
        if (joined) button.append(IconUI.labeled('mic', 'Estás en este canal de voz', 13))
      } else if (st.unread.has(channelKey(st.view.id, c.id))) {
        const unread = el('span', 'badge')
        unread.title = 'Mensajes sin leer'
        unread.setAttribute('aria-label', 'Mensajes sin leer')
        button.append(unread)
      }
      button.onclick = () => {
        st.cid = c.id
        st.unread.delete(channelKey(st.view.id, c.id))
        renderChannels()
        renderVoice()
        if (!isVoice) loadMessages()
      }
      box.append(button)
    }
    if (can('admin')) {
      const actions = el('div', 'chan-actions')
      const add = el('button', '', '+ Nuevo canal'); add.type = 'button'
      add.onclick = async () => {
        const name = await ask({ title: 'Nuevo canal', text: 'Nombre del canal (letras, números y guiones).', okLabel: 'Crear' })
        if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-add', args: { name } }))
      }
      const addVoice = el('button', '', '+ Canal de voz'); addVoice.type = 'button'
      addVoice.onclick = async () => {
        const name = await ask({ title: 'Nuevo canal de voz', text: 'Nombre del canal de voz (letras, números y guiones).', okLabel: 'Crear' })
        if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-add', args: { name, kind: 'voice' } }))
      }
      const ren = el('button', '', 'Renombrar canal'); ren.type = 'button'
      ren.onclick = async () => {
        const name = await ask({ title: 'Renombrar canal', value: st.view.channels.find((c) => c.id === st.cid).name })
        if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-rename', args: { cid: st.cid, name } }))
      }
      const del = el('button', 'danger-text', 'Eliminar canal'); del.type = 'button'
      del.onclick = () => {
        if (confirm('¿Eliminar este canal y todos sus mensajes?')) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-del', args: { cid: st.cid } }))
      }
      actions.append(add, addVoice, ren, del)
      box.append(actions)
    }
  }

  // Panel del canal de voz: quién está dentro y los botones para entrar, salir y silenciar.
  function renderVoice() {
    const panel = byId('srv-voice')
    const v = st.view
    if (!v) { panel.hidden = true; return }
    const active = v.channels.find((c) => c.id === st.cid)
    const isVoice = !!active && active.kind === 'voice'
    panel.hidden = !isVoice
    byId('srv-messages').hidden = isVoice
    byId('srv-form').hidden = isVoice
    if (!isVoice) return

    const inside = v.voice[active.id] || []
    const me = getMe()
    const mine = voice.info(v.id)
    const joined = !!mine && mine.cid === active.id
    byId('srv-voice-title').textContent = active.name
    byId('srv-voice-sub').textContent = inside.length
      ? inside.length + (inside.length === 1 ? ' persona conectada' : ' personas conectadas')
      : 'Nadie conectado'
    byId('srv-voice-join').hidden = joined
    byId('srv-voice-leave').hidden = !joined
    const mute = byId('srv-voice-mute')
    mute.hidden = !joined
    mute.setAttribute('aria-pressed', mine && mine.muted ? 'true' : 'false')
    mute.setAttribute('aria-label', mine && mine.muted ? 'Activar micrófono' : 'Silenciar micrófono')
    mute.title = mute.getAttribute('aria-label')
    mute.replaceChildren(IconUI.el(mine && mine.muted ? 'mic-off' : 'mic', 18))

    const ul = byId('srv-voice-members')
    ul.replaceChildren()
    if (!inside.length) {
      ul.append(el('li', 'hint', 'Entra al canal para hablar. Solo se oyen entre quienes están dentro.'))
      return
    }
    for (const p of inside) {
      const isMe = p.key === me.code
      const li = el('li', 'voice-member' + (isMe ? ' me' : ''))
      li.append(avatarFor(p.name))
      li.append(el('span', 'voice-member-name', isMe ? 'Tú' : shown(p.name, p.key)))
      if (p.muted) li.append(IconUI.labeled('mic-off', 'Micrófono silenciado', 14))
      else li.append(IconUI.el('mic', 14, 'voice-member-mic'))
      ul.append(li)
    }
  }

  // Directorio de miembros: siempre visible y sin herramientas de administración
  // (los roles, el silencio y la expulsión viven en Configuración del servidor).
  function renderMembers() {
    const ul = byId('srv-members')
    ul.replaceChildren()
    byId('srv-member-count').textContent = String(st.view.members.length)
    const groups = ['owner', 'admin', 'mod', 'member']
    for (const role of groups) {
      const members = st.view.members.filter((m) => m.role === role)
      if (!members.length) continue
      const group = el('li', 'member-group')
      group.append(el('h3', '', ROLE_GROUP[role]))
      const list = el('ul', 'plain')
      for (const m of members) {
        const li = el('li', '')
        const row = el('div', 'member-row')
        const nameWrap = el('span', 'member-name')
        const title = el('span', 'member-title')
        title.append(el('strong', '', shown(m.name, m.key)))
        if (m.verified) title.append(IconUI.labeled('check', 'Nombre registrado', 12))
        const info = roleInfo(m)
        const roleLine = roleColor(el('span', 'member-role', info.name), info)
        const extra = []
        if (m.muted) extra.push('silenciado')
        if (m.hasKey === false) extra.push('sin clave')
        if (extra.length) roleLine.append(document.createTextNode(' · ' + extra.join(' · ')))
        nameWrap.append(title, roleLine)
        row.append(
          presence(m.online, m.online ? 'En línea' : 'Desconectado'),
          avatarFor(m.name),
          nameWrap
        )
        li.append(row)
        list.append(li)
      }
      group.append(list)
      ul.append(group)
    }
  }

  function renderAudit() {
    byId('srv-bans-box').hidden = !st.view.bans.length
    const bans = byId('srv-bans')
    bans.replaceChildren()
    for (const key of st.view.bans) {
      const li = el('li', 'row', key.slice(0, 12) + '…')
      const b = el('button', '', 'Quitar baneo'); b.type = 'button'
      b.onclick = () => adminOp('unban', { key })
      li.append(b)
      bans.append(li)
    }
    byId('srv-audit-box').hidden = !st.view.audit.length
    const ul = byId('srv-audit')
    ul.replaceChildren()
    for (const a of [...st.view.audit].reverse()) {
      const time = new Date(a.ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
      ul.append(el('li', '', time + ' · ' + a.by + ' ' + a.action + (a.target ? ' ' + a.target : '')))
    }
  }

  // ---------- Configuración del servidor ----------

  function showSettingsPanel(name) {
    for (const b of document.querySelectorAll('[data-srv-panel]')) {
      const active = b.dataset.srvPanel === name
      b.classList.toggle('is-active', active)
      if (active) b.setAttribute('aria-current', 'true')
      else b.removeAttribute('aria-current')
    }
    for (const s of document.querySelectorAll('[data-srv-section]')) s.hidden = s.dataset.srvSection !== name
  }

  function openSettings() {
    if (!st.view) return
    byId('srv-settings-msg').textContent = ''
    byId('srv-role-form').hidden = true
    st.editingRole = null
    showSettingsPanel('general')
    renderSettings()
    byId('srv-settings-dialog').showModal()
  }

  function renderSettings() {
    if (!st.view) return
    const v = st.view
    byId('srv-set-sub').textContent = v.name
    const nameInput = byId('srv-set-name')
    if (document.activeElement !== nameInput) nameInput.value = v.name
    nameInput.disabled = !can('admin')
    byId('srv-set-name-save').hidden = !can('admin')
    byId('srv-set-invite').hidden = !(v.e2ee ? v.myRole === 'owner' : can('mod'))
    byId('srv-set-danger-row').hidden = !v.mine
    byId('srv-set-meta').textContent = v.members.length + ' miembros · ' + v.channels.length + ' canales · ' +
      (v.e2ee ? 'cifrado de extremo a extremo' : 'sin cifrado')
    renderRoles()
    renderSettingsMembers()
  }

  function renderRoles() {
    const ul = byId('srv-roles')
    ul.replaceChildren()
    const myRank = RANK[st.view.myRole]
    // Niveles fijos: siempre visibles, sin edición.
    for (const role of ['owner', 'admin', 'mod', 'member']) {
      const li = el('li', 'role-row')
      li.append(el('span', 'role-dot'))
      const copy = el('div', 'role-copy')
      copy.append(el('strong', '', ROLE_LABEL[role]), el('span', '', ROLE_GROUP[role] + ' · nivel fijo'))
      li.append(copy)
      ul.append(li)
    }
    for (const cr of (st.view.customRoles || [])) {
      const li = el('li', 'role-row')
      const dot = el('span', 'role-dot')
      dot.style.background = cr.color
      li.append(dot)
      const copy = el('div', 'role-copy')
      copy.append(el('strong', '', cr.name), el('span', '', ROLE_LABEL[cr.base] + ' · personalizado'))
      li.append(copy)
      if (can('admin') && RANK[cr.base] < myRank) {
        const actions = el('div', 'role-actions')
        const edit = el('button', '', 'Editar'); edit.type = 'button'
        edit.onclick = () => openRoleForm(cr)
        const del = el('button', 'danger-text', 'Eliminar'); del.type = 'button'
        del.onclick = () => {
          if (confirm('¿Eliminar el rol «' + cr.name + '»? Quienes lo tengan pasarán a su nivel base.')) removeRole(cr.id)
        }
        actions.append(edit, del)
        li.append(actions)
      }
      ul.append(li)
    }
    byId('srv-role-add').hidden = !can('admin')
  }

  function openRoleForm(role) {
    st.editingRole = role ? role.id : null
    byId('srv-role-form-title').textContent = role ? 'Editar rol' : 'Nuevo rol'
    byId('srv-role-name').value = role ? role.name : ''
    byId('srv-role-color').value = role ? role.color : '#8bc34a'
    const myRank = RANK[st.view.myRole]
    for (const opt of byId('srv-role-base').options) opt.disabled = RANK[opt.value] >= myRank
    byId('srv-role-base').value = role ? role.base : 'member'
    byId('srv-role-form').hidden = false
    byId('srv-role-name').focus()
  }

  function closeRoleForm() {
    byId('srv-role-form').hidden = true
    st.editingRole = null
  }

  async function saveRole(ev) {
    ev.preventDefault()
    const name = byId('srv-role-name').value.trim()
    if (!name) return
    const color = byId('srv-role-color').value
    const base = byId('srv-role-base').value
    const args = st.editingRole ? { id: st.editingRole, name, color, base } : { name, color, base }
    const r = await adminOp(st.editingRole ? 'role-edit' : 'role-add', args)
    if (r) closeRoleForm()
  }

  function removeRole(id) {
    adminOp('role-del', { id })
  }

  function renderSettingsMembers() {
    const ul = byId('srv-set-members')
    ul.replaceChildren()
    const myKey = getMe().code
    const myRank = RANK[st.view.myRole]
    for (const m of st.view.members) {
      const li = el('li', 'settings-member')
      li.append(avatarFor(m.name))
      const copy = el('div', 'settings-member-copy')
      const title = el('div', 'member-title')
      title.append(el('strong', '', shown(m.name, m.key)))
      if (m.verified) title.append(IconUI.labeled('check', 'Nombre registrado', 12))
      copy.append(title)
      const info = roleInfo(m)
      const roleLine = roleColor(el('span', '', info.name), info)
      if (m.muted) roleLine.append(document.createTextNode(' · silenciado'))
      if (m.hasKey === false) roleLine.append(document.createTextNode(' · sin clave'))
      copy.append(roleLine)
      li.append(copy)

      const tools = el('div', 'settings-member-tools')
      const manageable = m.key !== myKey && RANK[m.role] < myRank
      if (manageable && can('admin')) {
        const sel = document.createElement('select')
        sel.setAttribute('aria-label', 'Rol de ' + m.name)
        for (const role of ['member', 'mod', 'admin']) {
          if (RANK[role] >= myRank) continue
          const o = el('option', '', ROLE_LABEL[role]); o.value = role + ':'; sel.append(o)
        }
        for (const cr of (st.view.customRoles || [])) {
          if (RANK[cr.base] >= myRank) continue
          const o = el('option', '', cr.name + ' · ' + ROLE_LABEL[cr.base]); o.value = cr.base + ':' + cr.id; sel.append(o)
        }
        sel.value = m.role + ':' + (m.roleId || '')
        if (![...sel.options].some((o) => o.value === sel.value)) sel.value = m.role + ':'
        sel.onchange = () => {
          const [role, roleId] = sel.value.split(':')
          adminOp('role', { key: m.key, role, roleId: roleId || null })
        }
        tools.append(sel)
      }
      if (manageable && can('mod')) {
        const mute = el('button', '', m.muted ? 'Quitar silencio' : 'Silenciar'); mute.type = 'button'
        mute.onclick = async () => {
          if (m.muted) return adminOp('mute', { key: m.key, minutes: 0 })
          const mins = await ask({ title: 'Silenciar a ' + m.name, text: 'Minutos (1 a 43200).', value: '10', okLabel: 'Silenciar' })
          const n = Number(mins)
          if (mins !== null && Number.isInteger(n) && n > 0) adminOp('mute', { key: m.key, minutes: n })
        }
        const kick = el('button', 'danger-text', 'Expulsar'); kick.type = 'button'
        kick.onclick = () => { if (confirm('¿Expulsar a ' + m.name + '? Podrá volver con una invitación.')) adminOp('kick', { key: m.key }) }
        tools.append(mute, kick)
      }
      if (manageable && can('admin')) {
        const ban = el('button', 'danger-text', 'Banear'); ban.type = 'button'
        ban.onclick = () => { if (confirm('¿Banear a ' + m.name + '? No podrá volver aunque tenga una invitación.')) adminOp('ban', { key: m.key }) }
        tools.append(ban)
      }
      li.append(tools)
      ul.append(li)
    }
  }

  async function adminOp(op, args) {
    const r = await act(() => rpc('srv-admin', { sid: st.current, op, args }))
    if (r) {
      await refreshView()
      if (byId('srv-settings-dialog').open) renderSettings()
    }
    return r
  }

  // ---------- Mensajes ----------

  function skeleton(box) {
    box.replaceChildren()
    for (let i = 0; i < 4; i++) {
      const row = el('div', 'skeleton-row')
      row.append(el('span', 'skeleton-avatar'), el('span', 'skeleton-line'))
      box.append(row)
    }
  }

  async function loadMessages() {
    if (!st.view || !st.cid) return
    const chan = st.view.channels.find((c) => c.id === st.cid)
    if (chan && chan.kind === 'voice') return // los canales de voz no tienen mensajes
    const box = byId('srv-messages')
    skeleton(box)
    let messages = []
    try {
      messages = (await rpc('srv-messages', { sid: st.current, cid: st.cid })).messages
    } catch (err) {
      box.replaceChildren()
      const wrap = el('div', 'empty-state')
      wrap.append(IconUI.el('alert-triangle', 28))
      wrap.append(el('h2', '', 'No se pudieron cargar los mensajes'))
      wrap.append(el('p', '', err.message || 'Inténtalo de nuevo.'))
      box.append(wrap)
      return
    }
    box.replaceChildren()
    const me = getMe()
    let previous = null
    for (const m of messages) {
      const mine = m.from === me.code
      const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const grouped = previous && previous.from === m.from && (m.ts - previous.ts) < 5 * 60 * 1000
      const row = el('div', 'msg-group ' + (mine ? 'me' : 'them') + (grouped ? ' cont' : ''))
      row.dataset.id = m.id
      const avatar = el('div', 'msg-avatar')
      avatar.append(grouped ? el('span', 'sr-only', '') : avatarFor(shown(m.name, m.from)))
      const content = el('div', 'msg-content')
      if (!grouped) {
        const head = el('div', 'msg-head')
        head.append(el('span', 'msg-who', shown(m.name, m.from)), el('span', 'msg-time', time))
        if (m.v) head.append(IconUI.labeled('check', 'Nombre registrado', 13))
        if (m.edited) head.append(el('span', 'msg-edited', 'editado'))
        content.append(head)
      }
      const body = el('span', 'msg-body')
      LinkUI.render(m.text, body)
      content.append(body)
      if (mine || can('mod')) {
        const tools = el('span', 'msg-tools')
        if (mine && !st.view.e2ee) { // en servidores cifrados no se editan mensajes
          const edit = el('button', '', 'Editar'); edit.type = 'button'
          edit.onclick = async () => {
            const text = await ask({ title: 'Editar mensaje', value: m.text, okLabel: 'Guardar' })
            if (text) act(() => rpc('srv-edit', { sid: st.current, cid: st.cid, id: m.id, text }))
          }
          tools.append(edit)
        }
        const del = el('button', 'danger-text', 'Borrar'); del.type = 'button'
        del.onclick = () => { if (confirm('¿Borrar este mensaje?')) act(() => rpc('srv-del', { sid: st.current, cid: st.cid, id: m.id })) }
        tools.append(del)
        content.append(tools)
      }
      row.append(avatar, content)
      box.append(row)
      previous = { from: m.from, ts: m.ts }
    }
    if (!messages.length) box.append(el('div', 'callog', 'Todavía no hay mensajes en este canal.'))
    box.scrollTop = box.scrollHeight
    if (st.focus) { // venimos del buscador
      const target = [...box.children].find((n) => n.dataset && n.dataset.id === st.focus.id)
      st.focus = null
      if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash') }
    }
  }

  // ---------- Botones ----------

  async function showInvite(code) {
    const value = await ask({
      title: 'Código de invitación',
      text: 'Compártelo con quien quieras invitar (por un canal que confíes). Quien lo tenga podrá unirse hasta que venza o se agoten los usos.',
      value: code, readonly: true, okLabel: 'Copiar'
    })
    if (value !== null) {
      try { await navigator.clipboard.writeText(code); toast('Invitación copiada') } catch { toast('Selecciona el código y cópialo a mano') }
    }
  }

  async function createInvite() {
    const hours = Number(await ask({ title: 'Invitación', text: '¿Cuántas horas será válida? (1 a 720)', value: '24', okLabel: 'Siguiente' }))
    if (!Number.isInteger(hours)) return
    const max = Number(await ask({ title: 'Invitación', text: '¿Cuántas personas pueden usarla? (1 a 50)', value: '5', okLabel: 'Crear' }))
    if (!Number.isInteger(max)) return
    const r = await act(() => rpc('srv-admin', { sid: st.current, op: 'invite', args: { hours, max } }))
    if (r && r.code) showInvite(r.code) // si el anfitrión es otra persona, el código llega después por un evento
  }

  async function leaveServer() {
    if (!st.view) return
    if (st.view.mine) {
      if (!confirm('¿Eliminar el servidor para TODOS sus miembros? No se puede deshacer.')) return
      await act(() => rpc('srv-admin', { sid: st.current, op: 'close', args: {} }))
    } else {
      if (!confirm('¿Salir del servidor?')) return
      await act(() => rpc('srv-leave', { sid: st.current }))
    }
  }

  function bind() {
    byId('btn-srv-create').onclick = async () => {
      const name = await ask({ title: 'Crear servidor', text: 'Se aloja en tu PC: mantén la app abierta (o en segundo plano). Los mensajes se cifran de extremo a extremo: solo los miembros pueden leerlos. Tú, como dueño, apruebas las entradas y renuevas la clave.', okLabel: 'Crear' })
      if (!name) return
      const r = await act(() => rpc('srv-create', { name }))
      if (r) { await refreshList(); open(r.server.id) }
    }
    byId('btn-srv-join').onclick = async () => {
      const code = await ask({ title: 'Unirme a un servidor', text: 'Pega el código de invitación que te enviaron.', okLabel: 'Unirme' })
      if (!code) return
      const r = await act(() => rpc('srv-join', { code }))
      if (r) { st.joining = true; toast('Conectando con el anfitrión…') }
    }
    byId('srv-invite').onclick = createInvite
    byId('srv-set-invite').onclick = createInvite
    byId('srv-leave').onclick = leaveServer
    byId('srv-set-close').onclick = leaveServer
    byId('srv-settings').onclick = openSettings
    byId('srv-settings-close').onclick = () => byId('srv-settings-dialog').close()
    byId('srv-set-name-save').onclick = () => {
      const name = byId('srv-set-name').value.trim()
      if (name) adminOp('rename', { name })
    }
    for (const b of document.querySelectorAll('[data-srv-panel]')) {
      b.onclick = () => showSettingsPanel(b.dataset.srvPanel)
    }
    byId('srv-role-add').onclick = () => openRoleForm(null)
    byId('srv-role-cancel').onclick = closeRoleForm
    byId('srv-role-form').onsubmit = saveRole
    byId('srv-voice-join').onclick = () => act(async () => {
      await voice.join(st.current, st.cid)
      renderVoice()
      renderChannels()
    })
    byId('srv-voice-leave').onclick = () => act(async () => {
      await voice.leave()
      renderVoice()
      renderChannels()
    })
    byId('srv-voice-mute').onclick = () => act(async () => {
      const info = voice.info(st.current)
      await voice.setMuted(!(info && info.muted))
      renderVoice()
      renderChannels()
    })
    byId('srv-form').onsubmit = async (e) => {
      e.preventDefault()
      const text = byId('srv-text').value.trim()
      if (!text || !st.cid) return
      byId('srv-text').value = ''
      await act(() => rpc('srv-send', { sid: st.current, cid: st.cid, text }))
    }
  }

  // ---------- Eventos de la red ----------

  function onEvent(ev) {
    if (ev.type === 'server-invite') return showInvite(ev.code)
    if (ev.type === 'voice-mute') {
      if (st.view && (!ev.sid || st.current === ev.sid)) renderVoice()
      return
    }
    if (ev.type === 'voice-end') {
      if (st.current === ev.sid && st.view) { renderVoice(); renderChannels() }
      return
    }
    if (ev.type === 'servers') {
      if (ev.error) toast(ev.error)
      if (ev.gone) {
        toast(GONE_TEXT[ev.gone] || 'Saliste del servidor')
        if (st.current === ev.sid) {
          st.current = null; st.view = null
          if (byId('srv-settings-dialog').open) byId('srv-settings-dialog').close()
          showArea('chat'); openPanel()
        }
      }
      const wasJoining = st.joining
      refreshList().then(() => {
        if (wasJoining && !ev.error && !ev.gone && st.list.some((s) => s.id === ev.sid) && st.current !== ev.sid) { st.joining = false; open(ev.sid) }
      })
      if (ev.error) st.joining = false
      if (st.current === ev.sid && !ev.gone) refreshView()
      return
    }
    if (ev.type === 'server-msg') {
      if (ev.sid === st.current && ev.cid === st.cid) loadMessages()
      else if (ev.m && !ev.mine) { st.unread.add(channelKey(ev.sid, ev.cid)); refreshList(); if (ev.sid === st.current && st.view) renderChannels() }
    }
  }

  function init(deps) {
    rpc = deps.rpc
    toast = deps.toast
    getMe = deps.getMe
    showArea = deps.showArea
    openPanel = deps.openPanel || (() => {})
    onOpen = deps.onOpen || (() => {})
    menu = deps.menu || (() => {})
    onNotifyChange = deps.onNotifyChange || (() => {})
    voice = deps.voice || voice
    bind()
  }

  // Al abrir un chat con un contacto, el servidor deja de estar seleccionado.
  function leaveView() { if (st.current) { st.current = null; st.view = null; refreshList() } }

  return { init, refreshList, onEvent, open, leaveView, all: () => st.list.slice() }
})()
