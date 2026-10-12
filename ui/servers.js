'use strict'
// Servidores (grupos) en pantalla. El servidor vive en el PC de quien lo creó (el anfitrión).
// SEGURIDAD: nombres y mensajes de otras personas se dibujan SOLO con textContent. Nunca HTML.
const ServersUI = (() => {
  const byId = (id) => document.getElementById(id)
  const RANK = { member: 0, mod: 1, admin: 2, owner: 3 }
  const ROLE_LABEL = { owner: 'Dueño', admin: 'Admin', mod: 'Moderador', member: 'Miembro' }
  const GONE_TEXT = {
    kicked: 'Te expulsaron del servidor', banned: 'Te banearon del servidor',
    closed: 'El servidor fue eliminado', left: 'Saliste del servidor'
  }

  let rpc = null
  let toast = () => {}
  let getMe = () => null
  let showArea = () => {}
  const st = { list: [], current: null, view: null, cid: null, unread: new Set(), joining: false }

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
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

  const can = (min) => st.view && RANK[st.view.myRole] >= RANK[min]
  const channelKey = (sid, cid) => sid + ':' + cid

  // ---------- Lista de servidores ----------

  async function refreshList() {
    try { st.list = (await rpc('srv-list')).servers } catch { return }
    const ul = byId('servers')
    ul.replaceChildren()
    if (!st.list.length) ul.append(el('li', 'muted small', 'Aún no estás en ningún servidor.'))
    for (const s of st.list) {
      const li = el('li', 'contact' + (s.id === st.current ? ' active' : ''))
      li.append(el('span', 'dot ' + (s.hostOnline ? 'on' : 'off')), el('span', '', s.name))
      if ([...st.unread].some((k) => k.startsWith(s.id + ':'))) li.append(el('span', 'badge', '●'))
      li.onclick = () => open(s.id)
      ul.append(li)
    }
  }

  // ---------- Vista de un servidor ----------

  async function open(sid) {
    st.current = sid
    st.cid = null
    showArea('server')
    await refreshView()
    refreshList()
  }

  async function refreshView() {
    if (!st.current) return
    try { st.view = (await rpc('srv-get', { sid: st.current })).server } catch { st.view = null; st.current = null; showArea('chat'); return }
    const v = st.view
    if (!v.channels.some((c) => c.id === st.cid)) st.cid = v.channels[0].id
    st.unread.delete(channelKey(v.id, st.cid))
    byId('srv-name').textContent = v.name
    byId('srv-role').textContent = ROLE_LABEL[v.myRole] + (v.mine ? ' · anfitrión (tu PC)' : '')
    byId('srv-host').textContent = v.hostOnline ? '● anfitrión en línea' : '○ anfitrión desconectado'
    byId('srv-invite').hidden = !can('mod')
    byId('srv-rename').hidden = !can('admin')
    byId('srv-leave').textContent = v.mine ? 'Eliminar servidor' : 'Salir'
    byId('srv-form').hidden = !v.hostOnline
    renderChannels()
    renderMembers()
    renderAudit()
    await loadMessages()
  }

  function renderChannels() {
    const box = byId('srv-channels')
    box.replaceChildren()
    for (const c of st.view.channels) {
      const tab = el('span', 'chan' + (c.id === st.cid ? ' active' : ''), '#' + c.name)
      if (st.unread.has(channelKey(st.view.id, c.id))) tab.textContent += ' ●'
      tab.onclick = () => { st.cid = c.id; st.unread.delete(channelKey(st.view.id, c.id)); renderChannels(); loadMessages() }
      box.append(tab)
    }
    if (can('admin')) {
      const add = el('button', '', '+ canal'); add.type = 'button'
      add.onclick = async () => {
        const name = await ask({ title: 'Nuevo canal', text: 'Nombre del canal (letras, números y guiones).', okLabel: 'Crear' })
        if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-add', args: { name } }))
      }
      const ren = el('button', '', 'Renombrar canal'); ren.type = 'button'
      ren.onclick = async () => {
        const name = await ask({ title: 'Renombrar canal', value: st.view.channels.find((c) => c.id === st.cid).name })
        if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-rename', args: { cid: st.cid, name } }))
      }
      const del = el('button', 'danger', 'Eliminar canal'); del.type = 'button'
      del.onclick = () => {
        if (confirm('¿Eliminar este canal y todos sus mensajes?')) act(() => rpc('srv-admin', { sid: st.current, op: 'channel-del', args: { cid: st.cid } }))
      }
      box.append(add, ren, del)
    }
  }

  function renderMembers() {
    const ul = byId('srv-members')
    ul.replaceChildren()
    const myKey = getMe().code
    const myRank = RANK[st.view.myRole]
    for (const m of st.view.members) {
      const li = el('li', 'smember')
      const head = el('div', 'row')
      head.append(el('span', 'dot ' + (m.online ? 'on' : 'off')), el('span', '', m.name + (m.verified ? ' ✓' : '')), el('span', 'small muted', ROLE_LABEL[m.role] + (m.muted ? ' · silenciado' : '')))
      li.append(head)
      if (m.key !== myKey && RANK[m.role] < myRank) {
        const tools = el('div', 'row')
        const op = (label, fn, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; tools.append(b) }
        const run = (opName, args) => act(() => rpc('srv-admin', { sid: st.current, op: opName, args: { key: m.key, ...args } }))
        if (can('mod')) {
          op(m.muted ? 'Quitar silencio' : 'Silenciar', async () => {
            if (m.muted) return run('mute', { minutes: 0 })
            const mins = await ask({ title: 'Silenciar a ' + m.name, text: 'Minutos (1 a 43200).', value: '10', okLabel: 'Silenciar' })
            const n = Number(mins)
            if (mins !== null && Number.isInteger(n) && n > 0) run('mute', { minutes: n })
          })
          op('Expulsar', () => { if (confirm('¿Expulsar a ' + m.name + '? Podrá volver con una invitación.')) run('kick', {}) }, 'danger')
        }
        if (can('admin')) {
          op('Banear', () => { if (confirm('¿Banear a ' + m.name + '? No podrá volver aunque tenga una invitación.')) run('ban', {}) }, 'danger')
          const sel = document.createElement('select')
          for (const r of ['member', 'mod', 'admin']) {
            if (RANK[r] >= myRank) continue
            const o = el('option', '', ROLE_LABEL[r]); o.value = r; sel.append(o)
          }
          sel.value = m.role === 'owner' ? 'member' : m.role
          sel.onchange = () => run('role', { role: sel.value })
          if (sel.options.length) tools.append(sel)
        }
        li.append(tools)
      }
      ul.append(li)
    }
    byId('srv-bans-box').hidden = !st.view.bans.length
    const bans = byId('srv-bans')
    bans.replaceChildren()
    for (const key of st.view.bans) {
      const li = el('li', 'row', key.slice(0, 12) + '…')
      const b = el('button', '', 'Quitar baneo'); b.type = 'button'
      b.onclick = () => act(() => rpc('srv-admin', { sid: st.current, op: 'unban', args: { key } }))
      li.append(b)
      bans.append(li)
    }
  }

  function renderAudit() {
    byId('srv-audit-box').hidden = !st.view.audit.length
    const ul = byId('srv-audit')
    ul.replaceChildren()
    for (const a of [...st.view.audit].reverse()) {
      const time = new Date(a.ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
      ul.append(el('li', '', time + ' · ' + a.by + ' ' + a.action + (a.target ? ' ' + a.target : '')))
    }
  }

  async function loadMessages() {
    if (!st.view || !st.cid) return
    let messages = []
    try { messages = (await rpc('srv-messages', { sid: st.current, cid: st.cid })).messages } catch { return }
    const box = byId('srv-messages')
    box.replaceChildren()
    const me = getMe()
    const mentionRe = new RegExp('@' + me.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])', 'i')
    for (const m of messages) {
      const mine = m.from === me.code
      const bubble = el('div', 'msg ' + (mine ? 'me' : 'them'))
      const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      bubble.append(el('span', 'who', m.name + (m.v ? ' ✓' : '') + ' · ' + time + (m.edited ? ' · editado' : '')))
      const body = el('span', mentionRe.test(m.text) ? 'mention' : '', m.text)
      bubble.append(body)
      if (mine || can('mod')) {
        const tools = el('span', 'tools')
        if (mine) {
          const edit = el('button', '', 'Editar'); edit.type = 'button'
          edit.onclick = async () => {
            const text = await ask({ title: 'Editar mensaje', value: m.text, okLabel: 'Guardar' })
            if (text) act(() => rpc('srv-edit', { sid: st.current, cid: st.cid, id: m.id, text }))
          }
          tools.append(edit)
        }
        const del = el('button', '', 'Borrar'); del.type = 'button'
        del.onclick = () => { if (confirm('¿Borrar este mensaje?')) act(() => rpc('srv-del', { sid: st.current, cid: st.cid, id: m.id })) }
        tools.append(del)
        bubble.append(tools)
      }
      box.append(bubble)
    }
    box.scrollTop = box.scrollHeight
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

  function bind() {
    byId('btn-srv-create').onclick = async () => {
      const name = await ask({ title: 'Crear servidor', text: 'Se aloja en tu PC: mantén la app abierta (o en segundo plano) para que tus miembros puedan conectarse.', okLabel: 'Crear' })
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
    byId('srv-invite').onclick = async () => {
      const hours = Number(await ask({ title: 'Invitación', text: '¿Cuántas horas será válida? (1 a 720)', value: '24', okLabel: 'Siguiente' }))
      if (!Number.isInteger(hours)) return
      const max = Number(await ask({ title: 'Invitación', text: '¿Cuántas personas pueden usarla? (1 a 50)', value: '5', okLabel: 'Crear' }))
      if (!Number.isInteger(max)) return
      const r = await act(() => rpc('srv-admin', { sid: st.current, op: 'invite', args: { hours, max } }))
      if (r && r.code) showInvite(r.code) // si el anfitrión es otra persona, el código llega después por un evento
    }
    byId('srv-rename').onclick = async () => {
      const name = await ask({ title: 'Renombrar servidor', value: st.view.name })
      if (name) act(() => rpc('srv-admin', { sid: st.current, op: 'rename', args: { name } }))
    }
    byId('srv-leave').onclick = async () => {
      if (!st.view) return
      if (st.view.mine) {
        if (!confirm('¿Eliminar el servidor para TODOS sus miembros? No se puede deshacer.')) return
        await act(() => rpc('srv-admin', { sid: st.current, op: 'close', args: {} }))
      } else {
        if (!confirm('¿Salir del servidor?')) return
        await act(() => rpc('srv-leave', { sid: st.current }))
      }
    }
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
    if (ev.type === 'servers') {
      if (ev.error) toast(ev.error)
      if (ev.gone) {
        toast(GONE_TEXT[ev.gone] || 'Saliste del servidor')
        if (st.current === ev.sid) { st.current = null; st.view = null; showArea('chat') }
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
    bind()
  }

  // Al abrir un chat con un contacto, el servidor deja de estar seleccionado.
  function leaveView() { if (st.current) { st.current = null; st.view = null; refreshList() } }

  return { init, refreshList, onEvent, open, leaveView }
})()
