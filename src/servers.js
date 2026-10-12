'use strict'
// Servidores (grupos) alojados en el PC de quien los crea: el "anfitrión".
//
//  - El anfitrión es la autoridad: guarda canales, miembros, roles, historial e invitaciones, y reenvía
//    los mensajes a los miembros conectados. Si su PC está apagado, el servidor está inactivo.
//  - Los miembros se conectan al anfitrión por su código; la conexión va cifrada, PERO el anfitrión
//    puede leer todo lo que se escribe en su servidor (no es cifrado de extremo a extremo entre miembros).
//  - TODO lo que llega por la red se valida: el anfitrión no confía en los miembros ni los miembros
//    en el anfitrión (tipos, largos, formato, permisos y límites de velocidad).
const crypto = require('crypto')

const RANK = { member: 0, mod: 1, admin: 2, owner: 3 }
const ROLES = Object.keys(RANK)
const SID_RE = /^[0-9a-f]{16}$/
const CID_RE = /^[0-9a-f]{8}$/
const KEY_RE = /^[0-9a-f]{64}$/
const TOKEN_RE = /^[0-9a-f]{16}$/
const MSG_ID_RE = /^[0-9a-f]{12}$/
const INVITE_RE = /^psrv1\.([0-9a-f]{64})\.([0-9a-f]{16})\.([0-9a-f]{16})$/

const L = {
  maxMembers: 50, maxChannels: 25, maxInvites: 20, maxServersHosted: 10, maxBans: 200,
  maxText: 2000, histHost: 500, histClient: 300, syncMax: 200, firstSync: 50, auditMax: 30,
  msgBurst: 10, msgPerSec: 2,      // por miembro
  joinTimeoutMs: 20000, frameBytes: 14000, paceMs: 30
}

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g
const clean = (s, max) => (typeof s === 'string' ? s : '').replace(INVISIBLE, '').trim().slice(0, max)
const bodyText = (s) => (typeof s === 'string' ? s : '').replace(BODY_CONTROL, '').trim().slice(0, L.maxText)
const chanName = (s) => clean(s, 24).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9áéíóúñü_-]/g, '').slice(0, 24) || ''
const rid = (n) => crypto.randomBytes(n).toString('hex')
const fail = (msg) => new Error(msg)

class Bucket {
  constructor(capacity, perSec) { this.capacity = capacity; this.perSec = perSec; this.tokens = capacity; this.last = Date.now() }
  take() {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

// Mensaje recibido de la red -> mensaje limpio, o null
function okMsg(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !MSG_ID_RE.test(m.id)) return null
  if (typeof m.from !== 'string' || !KEY_RE.test(m.from) || !Number.isFinite(m.ts)) return null
  const text = bodyText(m.text)
  if (!text) return null
  const out = { id: m.id, from: m.from, name: clean(m.name, 40) || 'Usuario', v: m.v === true, ts: Math.min(Math.max(0, Math.round(m.ts)), Date.now() + 86400000), text }
  if (Number.isFinite(m.edited)) out.edited = Math.round(m.edited)
  return out
}

// Estado del servidor recibido del anfitrión -> estado limpio, o null
function okState(s) {
  if (!s || typeof s !== 'object') return null
  const name = clean(s.name, 40)
  const channels = (Array.isArray(s.channels) ? s.channels : []).slice(0, L.maxChannels)
    .filter((c) => c && typeof c.id === 'string' && CID_RE.test(c.id)).map((c) => ({ id: c.id, name: chanName(c.name) || 'canal' }))
  const members = (Array.isArray(s.members) ? s.members : []).slice(0, L.maxMembers)
    .filter((m) => m && typeof m.key === 'string' && KEY_RE.test(m.key) && ROLES.includes(m.role))
    .map((m) => ({ key: m.key, name: clean(m.name, 40) || 'Usuario', role: m.role, verified: m.verified === true, online: m.online === true, muted: m.muted === true }))
  const you = s.you && ROLES.includes(s.you.role) ? s.you.role : null
  if (!name || !channels.length || !members.length || !you) return null
  const audit = (Array.isArray(s.audit) ? s.audit : []).slice(-L.auditMax).map((a) => ({
    ts: Number.isFinite(a && a.ts) ? Math.round(a.ts) : 0, by: clean(a && a.by, 40), action: clean(a && a.action, 60), target: clean(a && a.target, 40)
  }))
  return { name, channels, members, you, audit }
}

class Servers {
  constructor(node) {
    this.node = node
    this.pending = new Map()  // uniones en curso: sid -> { hostKey, token, timer }
    this.buckets = new Map()  // límites de velocidad por miembro
  }

  get all() { return this.node.vault.data.servers }
  get me() { return this.node.code }
  _save() { this.node.vault.save() }
  _emit(info) { this.node.emit('servers', info) }
  _peer(key) { const p = this.node.peers.get(key); return p && p.ready ? p : null }

  hostsAny() { return Object.values(this.all).some((s) => s.hostKey === this.me) }
  joinsAny() { return this.pending.size > 0 || Object.values(this.all).some((s) => s.hostKey !== this.me) }
  isHostOf(key) { return [...this.pending.values()].some((p) => p.hostKey === key) || Object.values(this.all).some((s) => s.hostKey === key && key !== this.me) }
  isMemberOfMine(key) { return Object.values(this.all).some((s) => s.hostKey === this.me && s.members[key]) }
  hostKeys() { return [...new Set(Object.values(this.all).filter((s) => s.hostKey !== this.me).map((s) => s.hostKey))] }

  // ---------- Consultas (para la pantalla) ----------

  _view(S) {
    const mine = S.hostKey === this.me
    const myRole = (S.members[this.me] || {}).role || 'member'
    const members = Object.entries(S.members).map(([key, m]) => ({
      key, name: m.name, role: m.role, verified: !!m.verified,
      online: key === this.me ? true : mine ? !!this._peer(key) : !!m.online,
      muted: mine ? (S.mutes[key] || 0) > Date.now() : !!m.muted
    }))
    return {
      id: S.id, name: S.name, mine, hostKey: S.hostKey, myRole, members, channels: S.channels,
      hostOnline: mine || !!this._peer(S.hostKey),
      bans: mine && RANK[myRole] >= RANK.admin ? S.bans.slice() : [], // solo el anfitrión conoce la lista
      audit: RANK[myRole] >= RANK.admin ? (S.audit || []).slice(-L.auditMax) : []
    }
  }

  list() { return Object.values(this.all).map((S) => { const v = this._view(S); return { id: v.id, name: v.name, mine: v.mine, myRole: v.myRole, hostOnline: v.hostOnline } }) }
  get(sid) { const S = this.all[sid]; if (!S) throw fail('Servidor no encontrado'); return this._view(S) }
  messages(sid, cid) {
    const S = this.all[sid]
    if (!S || !S.msgs[cid]) throw fail('Canal no encontrado')
    return [...S.msgs[cid]]
  }

  // ---------- Crear, invitar y unirse ----------

  create(name) {
    name = clean(name, 40)
    if (!name) throw fail('Escribe un nombre para el servidor')
    if (Object.values(this.all).filter((s) => s.hostKey === this.me).length >= L.maxServersHosted) throw fail('Ya tienes demasiados servidores')
    const sid = rid(8)
    const cid = rid(4)
    this.all[sid] = {
      id: sid, name, hostKey: this.me, created: Date.now(),
      channels: [{ id: cid, name: 'general' }],
      members: { [this.me]: { name: this.node.name, role: 'owner', verified: !!this.node.cert, joined: Date.now() } },
      bans: [], mutes: {}, invites: {}, audit: [], msgs: { [cid]: [] }
    }
    this._save()
    this._emit({ sid })
    return this._view(this.all[sid])
  }

  join(code) {
    const m = INVITE_RE.exec(String(code || '').trim())
    if (!m) throw fail('El código de invitación no es válido')
    const [, hostKey, sid, token] = m
    if (hostKey === this.me) throw fail('Ese servidor es tuyo')
    if (this.all[sid]) throw fail('Ya estás en ese servidor')
    if (this.pending.has(sid)) throw fail('Ya estás intentando unirte a ese servidor')
    const timer = setTimeout(() => {
      if (this.pending.delete(sid)) this._emit({ sid, error: 'No se pudo conectar con el anfitrión. ¿Está encendido su PC?' })
    }, L.joinTimeoutMs)
    timer.unref?.()
    this.pending.set(sid, { hostKey, token, timer })
    this.node.swarm?.joinPeer(Buffer.from(hostKey, 'hex'))
    const peer = this._peer(hostKey)
    if (peer) this.onPeerReady(peer)
  }

  leave(sid) {
    const S = this.all[sid]
    if (!S) return
    if (S.hostKey === this.me) throw fail('Eres el dueño: para salir debes eliminar el servidor')
    const peer = this._peer(S.hostKey)
    if (peer) this.node._send(peer, { t: 'srv-leave', sid })
    delete this.all[sid]
    this._save()
    this._emit({ sid, gone: 'left' })
  }

  // ---------- Acciones del usuario local (anfitrión o miembro) ----------

  _hostPeerOrThrow(S) {
    const peer = this._peer(S.hostKey)
    if (!peer) throw fail('El anfitrión está desconectado')
    return peer
  }

  send(sid, cid, text) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    if (S.hostKey === this.me) return this._hostPost(S, this.me, cid, text)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-send', sid, cid, text: bodyText(text) })
  }

  edit(sid, cid, id, text) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    if (S.hostKey === this.me) return this._hostEdit(S, this.me, cid, id, text)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-edit', sid, cid, id, text: bodyText(text) })
  }

  del(sid, cid, id) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    if (S.hostKey === this.me) return this._hostDel(S, this.me, cid, id)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-del', sid, cid, id })
  }

  admin(sid, op, args = {}) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    if (S.hostKey === this.me) return this._hostAdmin(S, this.me, op, args)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-admin', sid, op, a: args })
    return { pending: true } // la respuesta llega después (por ejemplo, el código de invitación)
  }

  // ---------- Eventos de conexión ----------

  // Un par de la red terminó su presentación (hello).
  onPeerReady(peer) {
    for (const [sid, p] of this.pending) {
      if (p.hostKey === peer.key) this.node._send(peer, { t: 'srv-join', sid, token: p.token })
    }
    for (const S of Object.values(this.all)) {
      if (S.hostKey !== peer.key) continue
      const since = Math.max(0, ...Object.values(S.msgs).map((l) => (l.length ? l[l.length - 1].ts : 0)))
      this.node._send(peer, { t: 'srv-hello', sid: S.id, since })
      this._emit({ sid: S.id })
    }
  }

  onPeerClosed(peer) {
    for (const S of Object.values(this.all)) {
      if (S.hostKey === this.me && S.members[peer.key]) this._broadcastState(S)
      else if (S.hostKey === peer.key) this._emit({ sid: S.id })
    }
  }

  // ---------- Mensajes de la red ----------

  handle(peer, m) {
    switch (m.t) {
      // hacia el anfitrión
      case 'srv-join': return this._hostJoin(peer, m)
      case 'srv-hello': return this._hostHello(peer, m)
      case 'srv-send': return this._hostGuard(peer, m, (S) => this._hostPost(S, peer.key, m.cid, m.text))
      case 'srv-edit': return this._hostGuard(peer, m, (S) => this._hostEdit(S, peer.key, m.cid, m.id, m.text))
      case 'srv-del': return this._hostGuard(peer, m, (S) => this._hostDel(S, peer.key, m.cid, m.id))
      case 'srv-admin': return this._hostGuard(peer, m, (S) => {
        const r = this._hostAdmin(S, peer.key, m.op, m.a && typeof m.a === 'object' ? m.a : {})
        if (r && r.code) this.node._send(peer, { t: 'srv-invite', sid: S.id, code: r.code })
      })
      case 'srv-leave': return this._hostLeave(peer, m)
      // hacia un miembro (los envía el anfitrión)
      case 'srv-state': return this._clientState(peer, m)
      case 'srv-msg': return this._clientMsg(peer, m)
      case 'srv-msg-edit': return this._clientEdit(peer, m)
      case 'srv-msg-del': return this._clientDel(peer, m)
      case 'srv-hist': return this._clientHist(peer, m)
      case 'srv-invite': return this._clientInvite(peer, m)
      case 'srv-err': return this._clientErr(peer, m)
      case 'srv-gone': return this._clientGone(peer, m)
    }
  }

  // ======================= LADO ANFITRIÓN =======================

  _hostServer(sid) {
    const S = typeof sid === 'string' && SID_RE.test(sid) ? this.all[sid] : null
    return S && S.hostKey === this.me ? S : null
  }

  _err(peer, sid, e) {
    this.node._send(peer, { t: 'srv-err', sid, msg: String(e.message || e).slice(0, 120) })
  }

  // Ejecuta una acción de un miembro: solo si el servidor existe, es mío y quien escribe es miembro.
  _hostGuard(peer, m, fn) {
    const S = this._hostServer(m.sid)
    if (!S || !S.members[peer.key]) return
    try { fn(S) } catch (e) { this._err(peer, S.id, e) }
  }

  _audit(S, actorKey, action, targetKey) {
    S.audit.push({
      ts: Date.now(), by: (S.members[actorKey] || {}).name || 'Alguien', action,
      target: targetKey ? ((S.members[targetKey] || {}).name || 'Usuario') : ''
    })
    if (S.audit.length > L.auditMax) S.audit.splice(0, S.audit.length - L.auditMax)
  }

  _stateFor(S, key) {
    const v = this._view(S)
    return {
      id: S.id, name: S.name, channels: S.channels, you: { role: (S.members[key] || {}).role || 'member' },
      members: v.members, audit: RANK[(S.members[key] || {}).role] >= RANK.admin ? S.audit : []
    }
  }

  _broadcastState(S) {
    for (const key of Object.keys(S.members)) {
      const peer = key === this.me ? null : this._peer(key)
      if (peer) this.node._send(peer, { t: 'srv-state', s: this._stateFor(S, key) })
    }
    this._emit({ sid: S.id })
  }

  _toMembers(S, obj) {
    for (const key of Object.keys(S.members)) {
      const peer = key === this.me ? null : this._peer(key)
      if (peer) this.node._send(peer, obj)
    }
  }

  _hostJoin(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return this._err(peer, String(m.sid).slice(0, 16), fail('Ese servidor ya no existe'))
    if (S.bans.includes(peer.key)) return this._err(peer, S.id, fail('No puedes unirte a este servidor'))
    if (!S.members[peer.key]) {
      const inv = typeof m.token === 'string' && TOKEN_RE.test(m.token) ? S.invites[m.token] : null
      if (!inv || inv.exp < Date.now() || inv.uses >= inv.max) return this._err(peer, S.id, fail('La invitación no es válida o venció'))
      if (Object.keys(S.members).length >= L.maxMembers) return this._err(peer, S.id, fail('El servidor está lleno'))
      inv.uses++
      if (inv.uses >= inv.max) delete S.invites[m.token]
      S.members[peer.key] = { name: peer.remoteName || 'Usuario', role: 'member', verified: !!peer.verified, joined: Date.now() }
      this._audit(S, peer.key, 'se unió al servidor')
      this._save()
    }
    this._broadcastState(S)
    this._sendHistory(S, peer, 0)
  }

  _hostHello(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return this._err(peer, String(m.sid).slice(0, 16), fail('Ese servidor ya no existe'))
    const mem = S.members[peer.key]
    if (!mem) return this._err(peer, S.id, fail('Ya no eres miembro de este servidor'))
    mem.name = peer.remoteName || mem.name
    mem.verified = !!peer.verified
    this._broadcastState(S)
    this._sendHistory(S, peer, Number.isFinite(m.since) ? m.since : 0)
  }

  _hostLeave(peer, m) {
    const S = this._hostServer(m.sid)
    const mem = S && S.members[peer.key]
    if (!mem || mem.role === 'owner') return
    this._audit(S, peer.key, 'salió del servidor')
    delete S.members[peer.key]
    this._save()
    this._broadcastState(S)
  }

  // Envía el historial reciente en paquetes pequeños y con pausas.
  _sendHistory(S, peer, since) {
    const frames = []
    for (const ch of S.channels) {
      let list = (S.msgs[ch.id] || []).filter((x) => x.ts > since)
      list = list.slice(-(since ? L.syncMax : L.firstSync))
      let batch = []
      let size = 0
      for (const x of list) {
        const len = Buffer.byteLength(JSON.stringify(x))
        if (batch.length && size + len > L.frameBytes) { frames.push({ t: 'srv-hist', sid: S.id, cid: ch.id, msgs: batch }); batch = []; size = 0 }
        batch.push(x); size += len
      }
      if (batch.length) frames.push({ t: 'srv-hist', sid: S.id, cid: ch.id, msgs: batch })
    }
    let i = 0
    const step = () => {
      if (i >= frames.length || peer.conn.destroyed || this.node.peers.get(peer.key) !== peer) return
      this.node._send(peer, frames[i++])
      setTimeout(step, L.paceMs).unref?.()
    }
    step()
  }

  _hostPost(S, key, cid, text) {
    const mem = S.members[key]
    if (!mem) throw fail('No eres miembro de este servidor')
    if (typeof cid !== 'string' || !S.msgs[cid]) throw fail('Canal no encontrado')
    const body = bodyText(text)
    if (!body) throw fail('El mensaje está vacío')
    if ((S.mutes[key] || 0) > Date.now()) throw fail('Estás silenciado en este servidor')
    const bk = S.id + key
    if (!this.buckets.has(bk)) this.buckets.set(bk, new Bucket(L.msgBurst, L.msgPerSec))
    if (!this.buckets.get(bk).take()) throw fail('Estás escribiendo demasiado rápido')
    const msg = { id: rid(6), from: key, name: mem.name, v: !!mem.verified, ts: Date.now(), text: body }
    const list = S.msgs[cid]
    list.push(msg)
    if (list.length > L.histHost) list.splice(0, list.length - L.histHost)
    this._save()
    this._toMembers(S, { t: 'srv-msg', sid: S.id, cid, m: msg })
    this.node.emit('server-msg', { sid: S.id, cid, m: msg, mine: key === this.me })
  }

  _findMsg(S, cid, id) {
    const list = typeof cid === 'string' ? S.msgs[cid] : null
    const msg = list && typeof id === 'string' ? list.find((x) => x.id === id) : null
    if (!msg) throw fail('Mensaje no encontrado')
    return { list, msg }
  }

  _hostEdit(S, key, cid, id, text) {
    const { msg } = this._findMsg(S, cid, id)
    if (msg.from !== key) throw fail('Solo puedes editar tus propios mensajes')
    const body = bodyText(text)
    if (!body) throw fail('El mensaje está vacío')
    msg.text = body
    msg.edited = Date.now()
    this._save()
    this._toMembers(S, { t: 'srv-msg-edit', sid: S.id, cid, id, text: body, edited: msg.edited })
    this.node.emit('server-msg', { sid: S.id, cid, edited: id })
  }

  _hostDel(S, key, cid, id) {
    const { list, msg } = this._findMsg(S, cid, id)
    const rank = RANK[(S.members[key] || {}).role] ?? -1
    if (msg.from !== key && rank < RANK.mod) throw fail('No tienes permiso para borrar ese mensaje')
    list.splice(list.indexOf(msg), 1)
    if (msg.from !== key) this._audit(S, key, 'borró un mensaje de', msg.from)
    this._save()
    this._toMembers(S, { t: 'srv-msg-del', sid: S.id, cid, id })
    this.node.emit('server-msg', { sid: S.id, cid, removed: id })
  }

  // Acciones de administración. 'actor' es quien las pide (puede ser el propio anfitrión).
  _hostAdmin(S, actor, op, a) {
    const rank = (k) => (S.members[k] ? RANK[S.members[k].role] : -1)
    const need = (min) => { if (rank(actor) < RANK[min]) throw fail('No tienes permiso para hacer eso') }
    const target = () => {
      if (typeof a.key !== 'string' || !KEY_RE.test(a.key) || !S.members[a.key]) throw fail('Miembro no encontrado')
      if (a.key === actor) throw fail('No puedes hacerlo contigo mismo')
      if (rank(a.key) >= rank(actor)) throw fail('No puedes actuar sobre alguien con tu mismo rango o mayor')
      return a.key
    }
    const channel = () => { const c = S.channels.find((x) => x.id === a.cid); if (!c) throw fail('Canal no encontrado'); return c }
    const done = (action, targetKey) => { this._audit(S, actor, action, targetKey); this._save(); this._broadcastState(S) }
    const remove = (key, reason) => {
      const peer = this._peer(key)
      if (peer) this.node._send(peer, { t: 'srv-gone', sid: S.id, reason })
      delete S.members[key]
    }

    switch (op) {
      case 'channel-add': {
        need('admin')
        const name = chanName(a.name)
        if (!name) throw fail('Nombre de canal no válido')
        if (S.channels.length >= L.maxChannels) throw fail('Demasiados canales')
        const id = rid(4)
        S.channels.push({ id, name })
        S.msgs[id] = []
        return done('creó el canal #' + name)
      }
      case 'channel-rename': {
        need('admin')
        const c = channel()
        const name = chanName(a.name)
        if (!name) throw fail('Nombre de canal no válido')
        c.name = name
        return done('renombró un canal a #' + name)
      }
      case 'channel-del': {
        need('admin')
        const c = channel()
        if (S.channels.length <= 1) throw fail('Debe quedar al menos un canal')
        S.channels = S.channels.filter((x) => x !== c)
        delete S.msgs[c.id]
        return done('eliminó el canal #' + c.name)
      }
      case 'rename': {
        need('admin')
        const name = clean(a.name, 40)
        if (!name) throw fail('Nombre no válido')
        S.name = name
        return done('renombró el servidor')
      }
      case 'kick': {
        need('mod')
        const key = target()
        this._audit(S, actor, 'expulsó a', key)
        remove(key, 'kicked')
        this._save(); this._broadcastState(S)
        return {}
      }
      case 'ban': {
        need('admin')
        const key = target()
        this._audit(S, actor, 'baneó a', key)
        if (!S.bans.includes(key)) S.bans.push(key)
        if (S.bans.length > L.maxBans) S.bans.shift()
        remove(key, 'banned')
        this._save(); this._broadcastState(S)
        return {}
      }
      case 'unban': {
        need('admin')
        if (typeof a.key !== 'string' || !S.bans.includes(a.key)) throw fail('Esa persona no está baneada')
        S.bans = S.bans.filter((k) => k !== a.key)
        return done('quitó un baneo')
      }
      case 'mute': {
        need('mod')
        const key = target()
        const minutes = Number.isInteger(a.minutes) ? Math.min(43200, Math.max(0, a.minutes)) : 10
        if (minutes === 0) delete S.mutes[key]
        else S.mutes[key] = Date.now() + minutes * 60000
        return done(minutes ? 'silenció por ' + minutes + ' min a' : 'quitó el silencio a', key)
      }
      case 'role': {
        need('admin')
        const key = target()
        if (!ROLES.includes(a.role) || a.role === 'owner' || RANK[a.role] >= rank(actor)) throw fail('No puedes asignar ese rol')
        S.members[key].role = a.role
        return done('cambió el rol a ' + a.role + ' de', key)
      }
      case 'invite': {
        need('mod')
        const now = Date.now()
        for (const [t, inv] of Object.entries(S.invites)) if (inv.exp < now || inv.uses >= inv.max) delete S.invites[t]
        if (Object.keys(S.invites).length >= L.maxInvites) throw fail('Hay demasiadas invitaciones activas')
        const hours = Number.isInteger(a.hours) ? Math.min(720, Math.max(1, a.hours)) : 24
        const max = Number.isInteger(a.max) ? Math.min(50, Math.max(1, a.max)) : 5
        const token = rid(8)
        S.invites[token] = { exp: now + hours * 3600000, max, uses: 0, by: actor }
        this._save()
        return { code: `psrv1.${this.me}.${S.id}.${token}` }
      }
      case 'close': {
        need('owner')
        for (const key of Object.keys(S.members)) {
          const peer = key === this.me ? null : this._peer(key)
          if (peer) this.node._send(peer, { t: 'srv-gone', sid: S.id, reason: 'closed' })
        }
        delete this.all[S.id]
        this._save()
        this._emit({ sid: S.id, gone: 'closed' })
        return {}
      }
      default:
        throw fail('Acción no válida')
    }
  }

  // ======================= LADO MIEMBRO =======================
  // Solo se aceptan mensajes del anfitrión de ESE servidor.

  _fromHost(peer, sid) {
    const S = typeof sid === 'string' && SID_RE.test(sid) ? this.all[sid] : null
    return S && S.hostKey === peer.key ? S : null
  }

  _clientState(peer, m) {
    const state = okState(m.s)
    const sid = m.s && typeof m.s.id === 'string' ? m.s.id : ''
    if (!state || !SID_RE.test(sid)) return
    let S = this.all[sid]
    const pend = this.pending.get(sid)
    if (!S) {
      if (!pend || pend.hostKey !== peer.key) return // un servidor al que no me uní: se ignora
      clearTimeout(pend.timer)
      this.pending.delete(sid)
      S = this.all[sid] = { id: sid, hostKey: peer.key, created: Date.now(), msgs: {}, members: {}, channels: [] }
    } else if (S.hostKey !== peer.key) return
    S.name = state.name
    S.channels = state.channels
    S.members = Object.fromEntries(state.members.map((x) => [x.key, { name: x.name, role: x.role, verified: x.verified, online: x.online, muted: x.muted }]))
    S.audit = state.audit
    for (const c of S.channels) S.msgs[c.id] ||= []
    for (const cid of Object.keys(S.msgs)) if (!S.channels.some((c) => c.id === cid)) delete S.msgs[cid]
    this._save()
    this._emit({ sid })
  }

  _clientMsg(peer, m) {
    const S = this._fromHost(peer, m.sid)
    const msg = okMsg(m.m)
    if (!S || !msg || typeof m.cid !== 'string' || !S.msgs[m.cid]) return
    const list = S.msgs[m.cid]
    if (list.some((x) => x.id === msg.id)) return
    list.push(msg)
    if (list.length > L.histClient) list.splice(0, list.length - L.histClient)
    this._save()
    this.node.emit('server-msg', { sid: S.id, cid: m.cid, m: msg, mine: msg.from === this.me })
  }

  _clientEdit(peer, m) {
    const S = this._fromHost(peer, m.sid)
    const msg = S && typeof m.cid === 'string' && S.msgs[m.cid] ? S.msgs[m.cid].find((x) => x.id === m.id) : null
    const text = bodyText(m.text)
    if (!msg || !text) return
    msg.text = text
    msg.edited = Number.isFinite(m.edited) ? Math.round(m.edited) : Date.now()
    this._save()
    this.node.emit('server-msg', { sid: S.id, cid: m.cid, edited: m.id })
  }

  _clientDel(peer, m) {
    const S = this._fromHost(peer, m.sid)
    const list = S && typeof m.cid === 'string' ? S.msgs[m.cid] : null
    if (!list || typeof m.id !== 'string') return
    const i = list.findIndex((x) => x.id === m.id)
    if (i < 0) return
    list.splice(i, 1)
    this._save()
    this.node.emit('server-msg', { sid: S.id, cid: m.cid, removed: m.id })
  }

  _clientHist(peer, m) {
    const S = this._fromHost(peer, m.sid)
    if (!S || typeof m.cid !== 'string' || !S.msgs[m.cid] || !Array.isArray(m.msgs)) return
    const list = S.msgs[m.cid]
    let added = false
    for (const raw of m.msgs.slice(0, 20)) {
      const msg = okMsg(raw)
      if (msg && !list.some((x) => x.id === msg.id)) { list.push(msg); added = true }
    }
    if (!added) return
    list.sort((x, y) => x.ts - y.ts)
    if (list.length > L.histClient) list.splice(0, list.length - L.histClient)
    this._save()
    this.node.emit('server-msg', { sid: S.id, cid: m.cid, history: true })
  }

  _clientInvite(peer, m) {
    const S = this._fromHost(peer, m.sid)
    if (!S || typeof m.code !== 'string' || !INVITE_RE.test(m.code)) return
    this.node.emit('server-invite', { sid: S.id, code: m.code })
  }

  _clientErr(peer, m) {
    const known = typeof m.sid === 'string' && (this.all[m.sid] ? this.all[m.sid].hostKey === peer.key : this.pending.get(m.sid)?.hostKey === peer.key)
    if (!known) return
    const pend = this.pending.get(m.sid)
    if (pend) { clearTimeout(pend.timer); this.pending.delete(m.sid) }
    this._emit({ sid: m.sid, error: clean(m.msg, 120) || 'Error del servidor' })
  }

  _clientGone(peer, m) {
    const S = this._fromHost(peer, m.sid)
    if (!S) return
    delete this.all[S.id]
    this._save()
    this._emit({ sid: S.id, gone: ['kicked', 'banned', 'closed'].includes(m.reason) ? m.reason : 'closed' })
  }
}

module.exports = { Servers, LIMITS: L, RANK }
