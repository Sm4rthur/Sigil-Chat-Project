'use strict'
// Datos simulados exclusivos del previsualizador. No se cargan en la app real.
;(() => {
  const params = new URLSearchParams(location.search)
  const view = params.get('view') || 'chat'
  const me = {
    username: 'ana',
    email: 'ana@gmail.com',
    code: 'a'.repeat(64),
    hasKeyfile: true,
    remembered: true,
    nodeMode: true,
    acceptRequests: true,
    runInBackground: true,
    autoStart: false,
    packaged: false,
    verified: true
  }

  const contacts = [
    { key: 'b'.repeat(64), name: 'Mara', remoteName: 'mara', verified: true, online: true, muted: false, profRev: '1'.repeat(16) },
    { key: 'c'.repeat(64), name: 'Iván', remoteName: 'ivan', verified: true, online: true, muted: false, profRev: '2'.repeat(16) },
    { key: 'd'.repeat(64), name: 'Noa', remoteName: 'noa', verified: false, online: false, muted: false, profRev: '3'.repeat(16) },
    { key: 'e'.repeat(64), name: 'Teo', remoteName: 'teo', verified: true, online: true, muted: false, profRev: '4'.repeat(16) },
    { key: 'f'.repeat(64), name: 'Lía', remoteName: 'lia', verified: true, online: false, muted: true, profRev: '5'.repeat(16) },
    { key: 'g'.repeat(64), name: 'Sol', remoteName: 'sol', verified: false, online: true, muted: false, profRev: '6'.repeat(16) },
    { key: 'h'.repeat(64), name: 'Bruno', remoteName: 'bruno', verified: true, online: false, muted: false, profRev: '7'.repeat(16) }
  ]

  const sid = 's'.repeat(16)
  const serverId2 = 't'.repeat(16)
  const channels = [
    { id: 'general', name: 'general', kind: 'text' },
    { id: 'refugio', name: 'refugio', kind: 'text' },
    { id: 'mapas', name: 'mapas', kind: 'text' },
    { id: 'sala-voz', name: 'sala-de-voz', kind: 'voice' },
    { id: 'off-topic', name: 'off-topic', kind: 'text' }
  ]

  const voice = {
    'sala-voz': [
      { key: contacts[0].key, name: 'Mara', muted: false },
      { key: contacts[1].key, name: 'Iván', muted: true }
    ]
  }

  const servers = [
    { id: sid, name: 'Casa de invierno', mine: true, myRole: 'owner', hostOnline: true, e2ee: true, muted: false },
    { id: serverId2, name: 'Taller de mapas', mine: false, myRole: 'admin', hostOnline: true, e2ee: true, myRoleName: 'Cartógrafo', myRoleColor: '#5aa9e6', muted: false },
    { id: 'u'.repeat(16), name: 'Archivo antiguo', mine: false, myRole: 'member', hostOnline: false, e2ee: false, muted: true }
  ]

  const customRoles = [
    { id: 'aa000001', name: 'Anfitrión', color: '#c9a227', base: 'admin' },
    { id: 'aa000002', name: 'Cartógrafo', color: '#5aa9e6', base: 'mod' },
    { id: 'aa000003', name: 'Lector', color: '#8bc34a', base: 'member' }
  ]

  const members = [
    { key: me.code, name: 'ana', role: 'owner', roleId: null, verified: true, online: true, muted: false, hasKey: true },
    { key: contacts[0].key, name: 'Mara', role: 'admin', roleId: 'aa000001', verified: true, online: true, muted: false, hasKey: true },
    { key: contacts[1].key, name: 'Iván', role: 'mod', roleId: 'aa000002', verified: true, online: true, muted: false, hasKey: true },
    { key: contacts[2].key, name: 'Noa', role: 'member', roleId: null, verified: false, online: false, muted: false, hasKey: true },
    { key: contacts[3].key, name: 'Teo', role: 'member', roleId: 'aa000003', verified: true, online: true, muted: false, hasKey: true },
    { key: contacts[4].key, name: 'Lía', role: 'member', roleId: null, verified: true, online: false, muted: true, hasKey: true },
    { key: contacts[5].key, name: 'Sol', role: 'member', roleId: null, verified: false, online: true, muted: false, hasKey: false },
    { key: contacts[6].key, name: 'Bruno', role: 'member', roleId: null, verified: true, online: false, muted: false, hasKey: true }
  ]

  const notify = { notifications: true, sound: true, mutedContacts: [contacts[4].key], mutedServers: ['u'.repeat(16)] }

  const now = Date.now()
  const mins = (n) => now - n * 60000
  const chatMessages = [
    { id: 'm01', from: contacts[0].key, text: '¿Ya tienes lista la sala para esta noche?', ts: mins(52), status: 'delivered' },
    { id: 'm02', from: 'me', text: 'Sí. La clave nueva está en el sobre.', ts: mins(50), status: 'delivered' },
    { id: 'm03', from: 'me', text: 'Te la paso cuando entres.', ts: mins(49), status: 'delivered' },
    { id: 'm04', from: contacts[0].key, text: 'Perfecto. Llevo el té y algo para picar.', ts: mins(45) },
    { id: 'm05', from: contacts[0].key, kind: 'call', ts: mins(39), call: { dir: 'in', result: 'ended', duration: 384 } },
    { id: 'm06', from: contacts[0].key, text: 'La llamada se cortó, pero ya funcionó.', ts: mins(36) },
    { id: 'm07', from: 'me', kind: 'file', ts: mins(30), status: 'delivered', file: { name: 'plano-sala.png', size: 486400, mime: 'image/png', sha: '9'.repeat(64), state: 'ready', dangerous: false } },
    { id: 'm08', from: contacts[0].key, text: 'Mira https://ejemplo.org/refugio — ahí está la lista de lecturas.', ts: mins(24) },
    { id: 'm09', from: 'me', text: 'Nos vemos a las 21:00. La puerta queda cerrada.', ts: mins(12), status: 'delivered' },
    { id: 'm10', from: contacts[0].key, text: 'Anotado. Gracias por el refugio.', ts: mins(9) },
    { id: 'm11', from: 'me', text: 'Siempre.', ts: mins(8), status: 'pending' }
  ]

  const serverMessages = [
    { id: 's01', from: me.code, name: 'ana', v: true, ts: mins(68), text: 'Bienvenidos a la Casa de invierno. Este es el canal general.' },
    { id: 's02', from: contacts[0].key, name: 'Mara', v: true, ts: mins(66), text: 'Gracias. La luz de la entrada ya está puesta.' },
    { id: 's03', from: contacts[1].key, name: 'Iván', v: true, ts: mins(64), text: 'Subí las lecturas al canal #refugio.' },
    { id: 's04', from: contacts[1].key, name: 'Iván', v: true, ts: mins(63), text: 'También dejé una nota sobre los mapas antiguos.' },
    { id: 's05', from: contacts[3].key, name: 'Teo', v: true, ts: mins(58), text: '¿La clave nueva ya está repartida?' },
    { id: 's06', from: me.code, name: 'ana', v: true, ts: mins(56), text: 'Sí. Solo falta Sol, que aún no se ha conectado.' },
    { id: 's07', from: contacts[2].key, name: 'Noa', v: false, ts: mins(44), text: 'Puedo revisar el diseño de la sala esta tarde.' },
    { id: 's08', from: contacts[4].key, name: 'Lía', v: true, ts: mins(31), text: 'Me gusta la idea de una puerta que no haga ruido al cerrar.' },
    { id: 's09', from: contacts[0].key, name: 'Mara', v: true, ts: mins(18), text: 'He dejado una lista de reproducción para la noche.', edited: true },
    { id: 's10', from: me.code, name: 'ana', v: true, ts: mins(7), text: 'Perfecto. Nos vemos a las 21:00.' }
  ]

  const privacyRows = [
    { who: 'Tus contactos (7)', sees: 'Tu IP y el contenido que les envías', level: 'alto' },
    { who: 'Anfitriones de tus servidores', sees: 'Tu IP y los metadatos de conexión', level: 'alto' },
    { who: 'Desconocidos que te buscan', sees: 'Nada, si el modo privado está activo', level: 'bajo' },
    { who: 'Nodos de la red', sees: 'Tu presencia como nodo, si lo tienes activo', level: 'medio' }
  ]

  const contactProfile = {
    v: 1,
    status: 'Diseño refugios digitales y colecciono mapas imposibles.',
    avatar: '',
    avatarCrop: { zoom: 1, x: 0, y: 0 },
    nameFont: 'sans',
    fonts: [],
    page: {
      height: 520,
      bg: { color: '#15161c', image: '', fit: 'cover' },
      blocks: [
        { id: 'p1', type: 'text', x: 56, y: 48, w: 680, h: 70, z: 1, rot: 0, text: 'Mara', font: 'serif', size: 48, color: '#dcdce5', bg: '', bold: false, italic: false, align: 'left' },
        { id: 'p2', type: 'text', x: 56, y: 128, w: 560, h: 80, z: 2, rot: 0, text: 'Diseño de interiores para lugares que no aparecen en los mapas.', font: 'sans', size: 20, color: '#9294a5', bg: '', bold: false, italic: false, align: 'left' },
        { id: 'p3', type: 'text', x: 56, y: 260, w: 640, h: 140, z: 3, rot: 0, text: 'Me interesan las habitaciones silenciosas, las cerraduras antiguas y las conversaciones que empiezan cuando ya no queda nadie despierto.', font: 'sans', size: 17, color: '#c5a477', bg: '', bold: false, italic: false, align: 'left' }
      ]
    }
  }

  const myProfile = {
    v: 1,
    status: 'Un refugio pequeño, una puerta que cierra bien.',
    avatar: '',
    avatarCrop: { zoom: 1, x: 0, y: 0 },
    nameFont: 'sans',
    fonts: [],
    page: {
      height: 460,
      bg: { color: '#191a21', image: '', fit: 'cover' },
      blocks: [
        { id: 'q1', type: 'text', x: 52, y: 46, w: 620, h: 70, z: 1, rot: 0, text: 'ana', font: 'sans', size: 44, color: '#dcdce5', bg: '', bold: true, italic: false, align: 'left' },
        { id: 'q2', type: 'text', x: 52, y: 140, w: 600, h: 120, z: 2, rot: 0, text: 'Escribo, ordeno mapas y preparo té para las conversaciones largas. Si estás aquí, la puerta ya está abierta.', font: 'serif', size: 19, color: '#9294a5', bg: '', bold: false, italic: false, align: 'left' }
      ]
    }
  }

  const searchResults = [
    { type: 'chat', key: contacts[0].key, who: 'Mara', mine: true, id: 'm09', ts: mins(12), text: 'Nos vemos a las 21:00. La puerta queda cerrada.' },
    { type: 'server', sid, server: 'Casa de invierno', channel: 'general', cid: 'general', id: 's10', name: 'ana', ts: mins(7), text: 'Perfecto. Nos vemos a las 21:00.' },
    { type: 'server', sid, server: 'Casa de invierno', channel: 'refugio', cid: 'refugio', id: 's03', name: 'Iván', ts: mins(64), text: 'Subí las lecturas al canal #refugio.' }
  ]

  let eventListener = null
  const ok = (extra = {}) => Promise.resolve({ ok: true, ...extra })

  window.api = {
    invoke(channel, arg) {
      switch (channel) {
        case 'boot':
          if (view === 'login') return ok({ loggedIn: false, hasAccounts: true })
          if (view === 'signup') return ok({ loggedIn: false, hasAccounts: false })
          return ok({ loggedIn: true })
        case 'me': return ok({ me })
        case 'contacts':
          return ok({
            contacts,
            requests: [{ key: 'r'.repeat(64), name: 'Alguien nuevo', verified: false, ts: now - 3600000 }],
            node: { ready: true, nodeMode: true, acting: true, connected: 5 },
            verification: true
          })
        case 'chat': return ok({ messages: chatMessages })
        case 'send': return ok()
        case 'profile-avatar': return ok({ avatar: '', crop: { zoom: 1, x: 0, y: 0 } })
        case 'profile-get': return ok({ profile: arg && arg.key === me.code ? myProfile : contactProfile, consent: true })
        case 'profile-save': return ok({ profile: contactProfile })
        case 'srv-list': return ok({ servers })
        case 'srv-get':
          return ok({
            server: {
              id: sid,
              name: 'Casa de invierno',
              mine: true,
              myRole: 'owner',
              hostKey: me.code,
              hostOnline: true,
              e2ee: true,
              e2eeEpoch: 3,
              hasKey: true,
              needsRotation: false,
              ownerKey: me.code,
              channels,
              voice,
              members,
              customRoles,
              bans: ['z'.repeat(64)],
              audit: [
                { ts: mins(240), by: 'ana', action: 'creó el servidor', target: '' },
                { ts: mins(210), by: 'ana', action: 'invitó a', target: 'Mara' },
                { ts: mins(120), by: 'Mara', action: 'renombró el canal', target: 'refugio' },
                { ts: mins(45), by: 'ana', action: 'renovó la clave', target: '' }
              ]
            }
          })
        case 'srv-messages': return ok({ messages: serverMessages })
        case 'srv-admin': {
          const op = arg && arg.op
          const a = (arg && arg.args) || {}
          if (op === 'role-add' && customRoles.length < 20) {
            customRoles.push({ id: String(Date.now()).slice(-8), name: a.name || 'Rol', color: a.color || '#9294a5', base: a.base || 'member' })
          } else if (op === 'role-edit') {
            const r = customRoles.find((x) => x.id === a.id)
            if (r) { r.name = a.name || r.name; r.color = a.color || r.color; r.base = a.base || r.base }
          } else if (op === 'role-del') {
            const i = customRoles.findIndex((x) => x.id === a.id)
            if (i >= 0) customRoles.splice(i, 1)
          } else if (op === 'role' && a.key) {
            const m = members.find((x) => x.key === a.key)
            if (m) { m.role = a.role; m.roleId = a.roleId || null }
          }
          return ok({ server: { id: sid } })
        }
        case 'srv-send': case 'srv-edit': case 'srv-del': case 'srv-create': case 'srv-join': case 'srv-leave':
          return ok({ server: { id: sid }, code: 'invite-demo' })
        case 'notify-get': return ok({ ...notify })
        case 'notify-set':
          if (typeof arg.notifications === 'boolean') notify.notifications = arg.notifications
          if (typeof arg.sound === 'boolean') notify.sound = arg.sound
          return ok({ notifications: notify.notifications, sound: notify.sound })
        case 'mute-contact': {
          const c = contacts.find((x) => x.key === arg.key)
          if (c) c.muted = arg.value === true
          notify.mutedContacts = contacts.filter((x) => x.muted).map((x) => x.key)
          return ok({ muted: c ? c.muted : false })
        }
        case 'mute-server': {
          const s = servers.find((x) => x.id === arg.sid)
          if (s) s.muted = arg.value === true
          notify.mutedServers = servers.filter((x) => x.muted).map((x) => x.id)
          return ok({ muted: s ? s.muted : false })
        }
        case 'privacy-get': return ok({ mode: 'normal', settings: { nodeMode: true, acceptRequests: true }, rows: privacyRows })
        case 'privacy-set': return ok()
        case 'search': {
          const q = String((arg && arg.q) || '').toLowerCase()
          const scope = arg && arg.scope
          const results = searchResults.filter((r) => {
            if (scope === 'chats' && r.type !== 'chat') return false
            if (scope === 'servers' && r.type !== 'server') return false
            const hay = [r.text, r.who, r.name, r.server, r.channel].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(q)
          })
          return ok({ results })
        }
        case 'set-background': case 'set-node-mode': case 'set-accept-requests': case 'remember-set': case 'ask-mic':
        case 'keyfile-create': return ok({ canceled: false, file: 'E:\\SigilChat\\ana.privchat-key' })
        case 'keyfile-remove': case 'logout': return ok()
        case 'srv-voice-join': case 'srv-voice-leave': {
          const join = channel === 'srv-voice-join'
          for (const list of Object.values(voice)) {
            const i = list.findIndex((p) => p.key === me.code)
            if (i >= 0) list.splice(i, 1)
          }
          if (join && arg && voice[arg.cid]) voice[arg.cid].push({ key: me.code, name: 'ana', muted: false })
          if (eventListener) eventListener({ type: 'servers', sid: (arg && arg.sid) || sid })
          return ok()
        }
        case 'srv-voice-mute': {
          const list = voice[(arg && arg.cid) || 'sala-voz'] || []
          const mine = list.find((p) => p.key === me.code)
          if (mine) mine.muted = !!(arg && arg.muted)
          if (eventListener) eventListener({ type: 'servers', sid: (arg && arg.sid) || sid })
          return ok()
        }
        case 'call-start': case 'call-accept': case 'call-end': return ok()
        case 'file-send': return ok({ canceled: true })
        case 'file-get': return ok({ preview: { kind: 'text', text: 'Vista previa de ejemplo. Los archivos no se ejecutan.', truncated: false } })
        case 'file-save': case 'file-download': return ok({ saved: true })
        case 'link-check': return ok({ host: 'ejemplo.org', warnings: [] })
        default: return ok()
      }
    },
    onEvent(cb) { eventListener = cb },
    sendAudio() {},
    sendVoice() {},
  }

  window.__mock = {
    me,
    contacts,
    servers,
    sid,
    emit(event) { if (eventListener) eventListener(event) }
  }
})()
