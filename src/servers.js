'use strict'
// Servidores (grupos) alojados en el PC de quien los crea: el "anfitrión".
//
//  - El anfitrión es la autoridad: guarda canales, miembros, roles, historial e invitaciones, y reenvía
//    los mensajes a los miembros conectados. Si su PC está apagado, el servidor está inactivo.
//  - Desde 0.5 los servidores nuevos van cifrados de extremo a extremo: el anfitrión guarda y reenvía
//    sobres cifrados y no puede leer ni falsificar los mensajes. Los servidores antiguos (marcados ⚠)
//    siguen funcionando como antes y en esos el anfitrión sí puede leer todo.
//  - TODO lo que llega por la red se valida: el anfitrión no confía en los miembros ni los miembros
//    en el anfitrión (tipos, largos, formato, permisos y límites de velocidad).
const crypto = require('crypto')
const e2 = require('./e2ee')

const RANK = { member: 0, mod: 1, admin: 2, owner: 3 }
const ROLES = Object.keys(RANK)
const ROLE_BASES = ['member', 'mod', 'admin']
const SID_RE = /^[0-9a-f]{16}$/
const CID_RE = /^[0-9a-f]{8}$/
const KEY_RE = /^[0-9a-f]{64}$/
const TOKEN_RE = /^[0-9a-f]{16}$/
const MSG_ID_RE = /^[0-9a-f]{12}$/
const ROLE_ID_RE = /^[0-9a-f]{8}$/
const ROLE_COLOR_RE = /^#[0-9a-f]{6}$/i
const INVITE2_RE = /^psrv2\.([0-9a-f]{64})\.([0-9a-f]{16})\.([0-9a-f]{16})\.([0-9a-f]{64})\.([0-9a-f]{32})$/
const INVITE_RE = /^psrv1\.([0-9a-f]{64})\.([0-9a-f]{16})\.([0-9a-f]{16})$/

const L = {
  maxMembers: 50, maxChannels: 25, maxInvites: 20, maxServersHosted: 10, maxBans: 200,
  maxText: 2000, histHost: 500, histClient: 300, syncMax: 200, firstSync: 50, auditMax: 30, maxCustomRoles: 20,
  msgBurst: 10, msgPerSec: 2,      // por miembro
  maxSkewMs: 10 * 60 * 1000, // diferencia máxima de hora aceptada en un mensaje cifrado
  maxInviteSecrets: 60,
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

// Roles personalizados: nombre + color + nivel base de permisos. El nivel base
// sigue siendo uno de los cuatro de siempre, así que los permisos no cambian.
function okCustomRoles(list) {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(list) ? list : []) {
    if (out.length >= L.maxCustomRoles) break
    if (!r || typeof r.id !== 'string' || !ROLE_ID_RE.test(r.id) || seen.has(r.id)) continue
    if (!ROLE_BASES.includes(r.base)) continue
    const name = clean(r.name, 24)
    if (!name) continue
    seen.add(r.id)
    out.push({ id: r.id, name, color: ROLE_COLOR_RE.test(r.color) ? r.color.toLowerCase() : '#9294a5', base: r.base })
  }
  return out
}

// Estado del servidor recibido del anfitrión -> estado limpio, o null
function okState(s) {
  if (!s || typeof s !== 'object') return null
  const name = clean(s.name, 40)
  const channels = (Array.isArray(s.channels) ? s.channels : []).slice(0, L.maxChannels)
    .filter((c) => c && typeof c.id === 'string' && CID_RE.test(c.id))
    .map((c) => ({ id: c.id, name: chanName(c.name) || 'canal', kind: c.kind === 'voice' ? 'voice' : 'text' }))
  const customRoles = okCustomRoles(s.customRoles)
  const roleIdFor = (m) => {
    const id = typeof m.roleId === 'string' ? m.roleId : ''
    return customRoles.some((r) => r.id === id && r.base === m.role) ? id : null
  }
  const members = (Array.isArray(s.members) ? s.members : []).slice(0, L.maxMembers)
    .filter((m) => m && typeof m.key === 'string' && KEY_RE.test(m.key) && ROLES.includes(m.role))
    .map((m) => ({ key: m.key, name: clean(m.name, 40) || 'Usuario', role: m.role, roleId: roleIdFor(m), verified: m.verified === true, online: m.online === true, muted: m.muted === true, hasKey: m.hasKey !== false }))
  const you = s.you && ROLES.includes(s.you.role) ? s.you.role : null
  if (!name || !channels.length || !members.length || !you) return null
  const audit = (Array.isArray(s.audit) ? s.audit : []).slice(-L.auditMax).map((a) => ({
    ts: Number.isFinite(a && a.ts) ? Math.round(a.ts) : 0, by: clean(a && a.by, 40), action: clean(a && a.action, 60), target: clean(a && a.target, 40)
  }))
  const pending = (Array.isArray(s.pending) ? s.pending : []).slice(0, 12).map((p) => (
    p && typeof p.key === 'string' && KEY_RE.test(p.key) && p.xk && typeof p.xk.xpub === 'string' && KEY_RE.test(p.xk.xpub) && e2.isB64(p.xk.sig, 80, 100) &&
    typeof p.proof === 'string' && KEY_RE.test(p.proof) && typeof p.tok === 'string' && TOKEN_RE.test(p.tok)
      ? { key: p.key, xk: { xpub: p.xk.xpub, sig: p.xk.sig }, proof: p.proof, tok: p.tok } : null
  )).filter(Boolean)
  // Quién está en cada canal de voz (lo anuncia el anfitrión).
  const voice = {}
  const voiceIn = s.voice && typeof s.voice === 'object' && !Array.isArray(s.voice) ? s.voice : {}
  for (const [cid, list] of Object.entries(voiceIn)) {
    if (!CID_RE.test(cid) || !Array.isArray(list)) continue
    voice[cid] = list.slice(0, L.maxMembers)
      .filter((v) => v && typeof v.key === 'string' && KEY_RE.test(v.key))
      .map((v) => ({ key: v.key, name: clean(v.name, 40) || 'Usuario', muted: v.muted === true }))
  }
  return { name, channels, members, you, customRoles, audit, pending, voice, needsRotation: s.needsRotation === true }
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
    const customRoles = okCustomRoles(S.customRoles)
    const members = Object.entries(S.members).map(([key, m]) => ({
      key, name: m.name, role: m.role, roleId: m.roleId || null, verified: !!m.verified,
      online: key === this.me ? true : mine ? !!this._peer(key) : !!m.online,
      muted: mine ? (S.mutes[key] || 0) > Date.now() : !!m.muted,
      hasKey: !S.e2ee ? true : mine ? this._hostHasKey(S, key) : m.hasKey !== false
    }))
    const voice = {}
    for (const ch of S.channels) {
      if (ch.kind !== 'voice') continue
      const who = (S.voice || {})[ch.id] || {}
      voice[ch.id] = Object.entries(who).map(([key, x]) => ({
        key, name: x.name, muted: !!x.muted,
        online: key === this.me ? true : (mine ? !!this._peer(key) : x.online !== false)
      }))
    }
    return {
      id: S.id, name: S.name, mine, hostKey: S.hostKey, myRole, members, channels: S.channels, customRoles, voice,
      hostOnline: mine || !!this._peer(S.hostKey),
      e2ee: !!S.e2ee, ownerKey: S.ownerKey || null, needsRotation: !!S.needsRotation,
      hasKey: S.e2ee ? !!(S.epoch && (S.keys || {})[S.epoch]) : true,
      bans: mine && RANK[myRole] >= RANK.admin ? S.bans.slice() : [], // solo el anfitrión conoce la lista
      audit: RANK[myRole] >= RANK.admin ? (S.audit || []).slice(-L.auditMax) : []
    }
  }

  list() {
    return Object.values(this.all).map((S) => {
      const v = this._view(S)
      const cr = (v.customRoles || []).find((r) => r.id === (S.members[this.me] || {}).roleId)
      return {
        id: v.id, name: v.name, mine: v.mine, myRole: v.myRole, hostOnline: v.hostOnline, e2ee: v.e2ee,
        myRoleName: cr ? cr.name : null, myRoleColor: cr ? cr.color : null,
        muted: (this.node.vault.data.settings.mutedServers || []).includes(v.id)
      }
    })
  }
  get(sid) { const S = this.all[sid]; if (!S) throw fail('Servidor no encontrado'); return this._view(S) }
  messages(sid, cid) {
    const S = this.all[sid]
    if (!S || !S.msgs[cid]) throw fail('Canal no encontrado')
    return [...S.msgs[cid]]
  }

  // ---------- Crear, invitar y unirse ----------

  // 'ownerKey': si el anfitrión es un equipo sin persona (Raspberry Pi), el dueño es otra clave.
  // opts.e2ee (por defecto true): servidor cifrado de extremo a extremo.
  create(name, ownerKey = null, opts = {}) {
    const useE2ee = opts.e2ee !== false
    if (useE2ee && !this.node.e2eeReady) throw fail('Tu identidad no permite el cifrado de extremo a extremo (actualiza la app)')
    name = clean(name, 40)
    if (!name) throw fail('Escribe un nombre para el servidor')
    if (Object.values(this.all).filter((s) => s.hostKey === this.me).length >= L.maxServersHosted) throw fail('Ya tienes demasiados servidores')
    const owner = typeof ownerKey === 'string' && KEY_RE.test(ownerKey) ? ownerKey : this.me
    const sid = rid(8)
    const cid = rid(4)
    this.all[sid] = {
      id: sid, name, hostKey: this.me, created: Date.now(),
      channels: [{ id: cid, name: 'general', kind: 'text' }],
      members: {
        [owner]: owner === this.me
          ? { name: this.node.name, role: 'owner', verified: !!this.node.cert, joined: Date.now() }
          : { name: 'Dueño', role: 'owner', verified: false, joined: Date.now() }
      },
      bans: [], mutes: {}, invites: {}, audit: [], msgs: { [cid]: [] }, customRoles: [], voice: {}
    }
    if (useE2ee) {
      Object.assign(this.all[sid], {
        e2ee: true, ownerKey: owner, epoch: 0, keys: {}, approved: {}, inviteSecrets: {}, relay: { [cid]: [] },
        keyBox: {}, needsRotation: false, epochSeen: 0, unsent: [], pendingApprovals: [], undec: []
      })
      if (owner === this.me) this._ownerProcess(this.all[sid]) // crea la clave de la época 1
    }
    this._save()
    this._emit({ sid })
    return this._view(this.all[sid])
  }

  join(code) {
    const text = String(code || '').trim()
    const m2 = INVITE2_RE.exec(text)
    const m = m2 || INVITE_RE.exec(text)
    if (!m) throw fail('El código de invitación no es válido')
    const [, hostKey, sid, token, ownerKey, secret] = m
    if (m2 && !this.node.e2eeReady) throw fail('Tu identidad no permite el cifrado de extremo a extremo (actualiza la app)')
    if (hostKey === this.me) throw fail('Ese servidor es tuyo')
    if (this.all[sid]) throw fail('Ya estás en ese servidor')
    if (this.pending.has(sid)) throw fail('Ya estás intentando unirte a ese servidor')
    const timer = setTimeout(() => {
      if (this.pending.delete(sid)) this._emit({ sid, error: 'No se pudo conectar con el anfitrión. ¿Está encendido su PC?' })
    }, L.joinTimeoutMs)
    timer.unref?.()
    this.pending.set(sid, m2 ? { hostKey, token, owner: ownerKey, secret, e2ee: true, timer } : { hostKey, token, timer })
    this.node.swarm?.joinPeer(Buffer.from(hostKey, 'hex'))
    const peer = this._peer(hostKey)
    if (peer) this.onPeerReady(peer)
  }

  leave(sid) {
    const S = this.all[sid]
    if (!S) return
    if (S.hostKey === this.me) throw fail('Eres el dueño: para salir debes eliminar el servidor')
    for (const cid of Object.keys(S.voice || {})) if ((S.voice[cid] || {})[this.me]) this.node.emit('voice-end', { sid, cid })
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
    if (S.e2ee) return this._sendE2ee(S, cid, text)
    if (S.hostKey === this.me) return this._hostPost(S, this.me, cid, text)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-send', sid, cid, text: bodyText(text) })
  }

  edit(sid, cid, id, text) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    if (S.e2ee) throw fail('Editar mensajes no está disponible en servidores cifrados')
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
    if (S.e2ee && op === 'invite') return this._e2eeInvite(S, args)
    if (S.hostKey === this.me) return this._hostAdmin(S, this.me, op, args)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-admin', sid, op, a: args })
    return { pending: true } // la respuesta llega después (por ejemplo, el código de invitación)
  }

  // ---------- Canales de voz ----------
  // El audio viaja como paquetes Opus: el miembro se los manda al anfitrión y el
  // anfitrión los reparte a las demás personas del mismo canal.

  _voiceChannel(S, cid) {
    const c = (S.channels || []).find((x) => x.id === cid)
    if (!c || c.kind !== 'voice') throw fail('Canal de voz no válido')
    return c
  }

  myVoiceCid(sid) {
    const S = this.all[sid]
    if (!S) return null
    for (const [cid, who] of Object.entries(S.voice || {})) if (who && who[this.me]) return cid
    return null
  }

  voiceJoin(sid, cid) {
    const S = this.all[sid]
    if (!S) throw fail('Servidor no encontrado')
    this._voiceChannel(S, cid)
    if (S.hostKey === this.me) this._hostVoiceJoin({ key: this.me, remoteName: this.node.name, verified: !!this.node.cert }, { sid, cid })
    else this.node._send(this._hostPeerOrThrow(S), { t: 'srv-voice-join', sid, cid })
  }

  voiceLeave(sid, cid) {
    const S = this.all[sid]
    if (!S) return
    const from = cid || this.myVoiceCid(sid)
    if (!from) return
    if (S.hostKey === this.me) this._hostVoiceLeave({ key: this.me }, { sid, cid: from })
    else {
      const peer = this._peer(S.hostKey)
      if (peer) this.node._send(peer, { t: 'srv-voice-leave', sid, cid: from })
    }
    this.node.emit('voice-end', { sid, cid: from, local: true })
  }

  voiceMute(sid, muted) {
    const S = this.all[sid]
    if (!S) return
    const cid = this.myVoiceCid(sid)
    if (!cid) return
    if (S.hostKey === this.me) this._hostVoiceMute({ key: this.me }, { sid, cid, muted: !!muted })
    else {
      const peer = this._peer(S.hostKey)
      if (peer) this.node._send(peer, { t: 'srv-voice-mute', sid, cid, muted: !!muted })
    }
  }

  // El motor de audio de la pantalla entrega aquí cada paquete capturado.
  voiceSend(sid, cid, buf) {
    const S = this.all[sid]
    if (!S || !buf || !buf.length) return
    const who = (S.voice || {})[cid]
    if (!who || !who[this.me]) return
    if (S.hostKey === this.me) this._broadcastVoice(S, cid, this.me, buf)
    else {
      const peer = this._peer(S.hostKey)
      if (peer) this.node.sendVoice(peer, sid, cid, this.me, buf)
    }
  }

  // ---------- Eventos de conexión ----------

  // Un par de la red terminó su presentación (hello).
  onPeerReady(peer) {
    for (const [sid, p] of this.pending) {
      if (p.hostKey !== peer.key) continue
      if (p.e2ee) {
        const x = this._xkeys()
        this.node._send(peer, { t: 'srv-join', sid, token: p.token, xk: this._xk(), proof: e2.joinProof(p.secret, sid, this.me, x.pubHex) })
      } else {
        this.node._send(peer, { t: 'srv-join', sid, token: p.token })
      }
    }
    for (const S of Object.values(this.all)) {
      if (S.hostKey !== peer.key) continue
      const since = S.e2ee ? S.syncTs || 0 : Math.max(0, ...Object.values(S.msgs).map((l) => (l.length ? l[l.length - 1].ts : 0)))
      this.node._send(peer, { t: 'srv-hello', sid: S.id, since })
      if (S.e2ee && S.ownerKey === this.me && S.unsent && S.unsent.length) { // claves que no pudieron entregarse
        const boxes = S.unsent.splice(0, 30)
        this.node._send(peer, { t: 'srv-keys', sid: S.id, boxes })
      }
      this._emit({ sid: S.id })
    }
  }

  onPeerClosed(peer) {
    for (const S of Object.values(this.all)) {
      if (S.hostKey === this.me && S.members[peer.key]) {
        let changed = false
        for (const [cid, who] of Object.entries(S.voice || {})) if (who && who[peer.key]) { delete who[peer.key]; changed = true }
        if (changed) this._save()
        this._broadcastState(S)
      } else if (S.hostKey === peer.key) {
        // El anfitrión se desconectó: salgo de su canal de voz si estaba en uno.
        for (const cid of Object.keys(S.voice || {})) if ((S.voice[cid] || {})[this.me]) this.node.emit('voice-end', { sid: S.id, cid })
        this._emit({ sid: S.id })
      }
    }
  }

  // ---------- Mensajes de la red ----------

  handle(peer, m) {
    switch (m.t) {
      // hacia el anfitrión
      case 'srv-join': return this._hostJoin(peer, m)
      case 'srv-hello': return this._hostHello(peer, m)
      case 'srv-send': return this._hostGuard(peer, m, (S) => (S.e2ee ? this._hostAcceptEnv(S, peer.key, m.cid, m.e) : this._hostPost(S, peer.key, m.cid, m.text)))
      case 'srv-keys': return this._onKeys(peer, m)
      case 'srv-edit': return this._hostGuard(peer, m, (S) => this._hostEdit(S, peer.key, m.cid, m.id, m.text))
      case 'srv-del': return this._hostGuard(peer, m, (S) => this._hostDel(S, peer.key, m.cid, m.id))
      case 'srv-admin': return this._hostGuard(peer, m, (S) => {
        const r = this._hostAdmin(S, peer.key, m.op, m.a && typeof m.a === 'object' ? m.a : {})
        if (r && r.code) this.node._send(peer, { t: 'srv-invite', sid: S.id, code: r.code })
      })
      case 'srv-leave': return this._hostLeave(peer, m)
      case 'srv-voice-join': return this._hostVoiceJoin(peer, m)
      case 'srv-voice-leave': return this._hostVoiceLeave(peer, m)
      case 'srv-voice-mute': return this._hostVoiceMute(peer, m)
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

  // ======================= CIFRADO DE EXTREMO A EXTREMO =======================
  // Cada miembro firma sus mensajes (Ed25519) y los cifra con la clave de grupo de la época actual.
  // El DUEÑO genera las claves y se las entrega, selladas, a cada miembro que haya verificado (por la prueba de su invitación).
  // El anfitrión y los repetidores solo ven sobres cifrados: no pueden leerlos, falsificarlos ni darse una clave a sí mismos.

  _xkeys() {
    const d = this.node.vault.data
    if (!d.e2eeKeys) {
      const k = e2.newXKeyPair()
      d.e2eeKeys = { priv: k.priv.toString('base64'), pub: k.pub.toString('hex') }
      this._save()
    }
    return { priv: Buffer.from(d.e2eeKeys.priv, 'base64'), pub: Buffer.from(d.e2eeKeys.pub, 'hex'), pubHex: d.e2eeKeys.pub }
  }

  _xk() { return e2.bindXKey(this.node.signer, this._xkeys().pubHex) }

  _hostHasKey(S, key) { return key === S.ownerKey || Object.keys((S.keyBox || {})[key] || {}).length > 0 }

  // Invitación de un servidor cifrado: la arma el dueño; el secreto nunca pasa por el anfitrión.
  _e2eeInvite(S, a) {
    if (S.ownerKey !== this.me) throw fail('En servidores cifrados solo el dueño crea invitaciones')
    const token = rid(8)
    const secret = rid(16)
    const args = { hours: a && a.hours, max: a && a.max, token }
    if (S.hostKey === this.me) this._hostAdmin(S, this.me, 'invite', args)
    else this.node._send(this._hostPeerOrThrow(S), { t: 'srv-admin', sid: S.id, op: 'invite', a: args })
    S.inviteSecrets ||= {}
    const old = Object.keys(S.inviteSecrets)
    if (old.length >= L.maxInviteSecrets) delete S.inviteSecrets[old[0]]
    S.inviteSecrets[token] = secret
    this._save()
    return { code: `psrv2.${S.hostKey}.${S.id}.${token}.${S.ownerKey}.${secret}` }
  }

  // Solo actúa si YO soy el dueño: crea la clave inicial, aprueba a quien entró con una invitación válida y renueva la clave
  // cuando alguien sale. Quien no demuestre haber recibido una invitación del dueño no recibe nunca la clave.
  _ownerProcess(S) {
    if (!S.e2ee || S.ownerKey !== this.me) return
    S.approved ||= {}
    S.inviteSecrets ||= {}
    S.keys ||= {}
    if (!S.epoch || !S.keys[S.epoch]) { S.epoch = (S.epoch || 0) + 1; S.keys[S.epoch] = e2.newGroupKey().toString('base64') }
    let rotate = false
    for (const k of Object.keys(S.approved)) if (!S.members[k]) { delete S.approved[k]; rotate = true }

    const pending = S.hostKey === this.me
      ? Object.entries(S.members).filter(([k, m]) => m.xk && k !== this.me && !S.approved[k]).map(([k, m]) => ({ key: k, xk: m.xk, proof: m.proof, tok: m.tok }))
      : S.pendingApprovals || []
    const fresh = []
    for (const p of pending) {
      if (S.approved[p.key] || !S.members[p.key]) continue
      const secret = S.inviteSecrets[p.tok]
      if (!secret || !e2.validXk(p.key, p.xk) || !e2.proofOk(p.proof, e2.joinProof(secret, S.id, p.key, p.xk.xpub))) continue
      S.approved[p.key] = p.xk.xpub
      fresh.push(p.key)
    }
    S.pendingApprovals = []
    if (rotate) { S.epoch++; S.keys[S.epoch] = e2.newGroupKey().toString('base64') }
    const boxes = (rotate ? Object.keys(S.approved) : fresh).map((k) => this._sealKey(S, k)).filter(Boolean)
    if (boxes.length) this._deliverBoxes(S, boxes)
    this._save()
  }

  _sealKey(S, to) {
    const xpub = S.approved[to]
    const key = S.keys[S.epoch]
    if (!xpub || !key) return null
    const box = { to, ep: S.epoch, ...e2.seal(Buffer.from(xpub, 'hex'), Buffer.from(key, 'base64'), e2.keyAad(S.id, S.epoch, to)) }
    box.sig = this.node.signer.sign(e2.keySigData(S.id, box))
    return box
  }

  _deliverBoxes(S, boxes) {
    if (S.hostKey === this.me) return this._hostKeys(S, this.me, boxes)
    const peer = this._peer(S.hostKey)
    if (!peer) { S.unsent = [...(S.unsent || []), ...boxes].slice(-200); return }
    for (let i = 0; i < boxes.length; i += 30) this.node._send(peer, { t: 'srv-keys', sid: S.id, boxes: boxes.slice(i, i + 30) })
  }

  // Anfitrión: guarda las cajas con claves (solo las del dueño, con su firma) y las entrega a cada miembro
  _hostKeys(S, actor, boxes) {
    if (!S.e2ee || actor !== S.ownerKey) throw fail('Solo el dueño puede repartir claves')
    if (!Array.isArray(boxes)) return
    let newest = S.epochSeen || 0
    for (const raw of boxes.slice(0, 40)) {
      const b = e2.okBox(raw)
      if (!b || !S.members[b.to] || !e2.verify(S.ownerKey, e2.keySigData(S.id, b), b.sig)) continue
      const kb = (S.keyBox[b.to] ||= {})
      kb[b.ep] = b
      const eps = Object.keys(kb).map(Number).sort((x, y) => x - y)
      while (eps.length > 4) delete kb[eps.shift()]
      newest = Math.max(newest, b.ep)
      const p = b.to === this.me ? null : this._peer(b.to)
      if (p) this.node._send(p, { t: 'srv-keys', sid: S.id, boxes: [b] })
    }
    if (newest > (S.epochSeen || 0)) { S.epochSeen = newest; S.needsRotation = false }
    this._save()
    this._broadcastState(S)
  }

  _sendKeys(S, peer) {
    const boxes = Object.values((S.keyBox || {})[peer.key] || {}).sort((a, b) => a.ep - b.ep).slice(-4)
    if (boxes.length) this.node._send(peer, { t: 'srv-keys', sid: S.id, boxes })
  }

  _onKeys(peer, m) {
    if (this._hostServer(m.sid)) return this._hostGuard(peer, m, (S) => this._hostKeys(S, peer.key, m.boxes))
    const S = this._fromHost(peer, m.sid)
    if (S) this._clientKeys(S, m.boxes)
  }

  // Miembro: acepta cajas solo si traen la firma del DUEÑO (clave fijada en la invitación) y son para mí
  _clientKeys(S, boxes) {
    if (!S.e2ee || !Array.isArray(boxes)) return
    const x = this._xkeys()
    let got = false
    for (const raw of boxes.slice(0, 8)) {
      const b = e2.okBox(raw)
      if (!b || b.to !== this.me || !e2.verify(S.ownerKey, e2.keySigData(S.id, b), b.sig)) continue
      try {
        const key = e2.open(x.priv, x.pub, b, e2.keyAad(S.id, b.ep, this.me))
        if (key.length !== 32) continue
        S.keys[b.ep] = key.toString('base64')
        if (b.ep > (S.epoch || 0)) S.epoch = b.ep
        got = true
      } catch { /* caja alterada o para otra persona */ }
    }
    if (!got) return
    const queued = S.undec || []
    S.undec = []
    for (const q of queued) this._clientEnv(S, q.cid, q.env, false) // mensajes que esperaban esta clave
    this._save()
    this._emit({ sid: S.id })
  }

  _sendE2ee(S, cid, text) {
    const body = bodyText(text)
    if (!body) throw fail('El mensaje está vacío')
    if (!S.channels.some((c) => c.id === cid)) throw fail('Canal no encontrado')
    const key = S.epoch ? (S.keys || {})[S.epoch] : null
    if (!key) throw fail('Aún no tienes la clave de este servidor: el dueño debe aprobarte (tiene que estar en línea)')
    const env = { id: rid(6), from: this.me, ts: Date.now(), ep: S.epoch }
    Object.assign(env, e2.encryptGroup(Buffer.from(key, 'base64'), Buffer.from(body, 'utf8'), e2.msgAad(S.id, cid, env)))
    env.sig = this.node.signer.sign(e2.msgSigData(S.id, cid, env))
    if (S.hostKey === this.me) return this._hostAcceptEnv(S, this.me, cid, env)
    this.node._send(this._hostPeerOrThrow(S), { t: 'srv-send', sid: S.id, cid, e: env })
  }

  // Anfitrión/repetidor: valida el sobre SIN poder leerlo (forma, autor, hora, firma, silencio, velocidad) y lo reparte
  _hostAcceptEnv(S, key, cid, raw) {
    if (!S.members[key]) throw fail('No eres miembro de este servidor')
    if (typeof cid !== 'string' || !S.relay[cid]) throw fail('Canal no encontrado')
    const env = e2.okEnv(raw)
    if (!env || env.from !== key) throw fail('Mensaje no válido')
    if (Math.abs(env.ts - Date.now()) > L.maxSkewMs) throw fail('La hora de tu equipo no coincide con la del servidor: revísala')
    if (!e2.verify(key, e2.msgSigData(S.id, cid, env), env.sig)) throw fail('Firma no válida')
    if ((S.mutes[key] || 0) > Date.now()) throw fail('Estás silenciado en este servidor')
    const bk = S.id + key
    if (!this.buckets.has(bk)) this.buckets.set(bk, new Bucket(L.msgBurst, L.msgPerSec))
    if (!this.buckets.get(bk).take()) throw fail('Estás escribiendo demasiado rápido')
    const list = S.relay[cid]
    if (list.some((x) => x.id === env.id)) return // repetido
    list.push(env)
    if (list.length > L.histHost) list.splice(0, list.length - L.histHost)
    this._save()
    this._toMembers(S, { t: 'srv-msg', sid: S.id, cid, e: env })
    if (S.members[this.me] && S.keys) this._clientEnv(S, cid, env, true) // si el anfitrión también es miembro, lo lee
  }

  _decryptEnv(S, cid, env) {
    const key = (S.keys || {})[env.ep]
    if (!key) return 'nokey'
    if (!e2.verify(env.from, e2.msgSigData(S.id, cid, env), env.sig)) return null
    try { return bodyText(e2.decryptGroup(Buffer.from(key, 'base64'), env, e2.msgAad(S.id, cid, env)).toString('utf8')) || null } catch { return null }
  }

  // Miembro: verifica la firma del autor, descifra y guarda el texto (en vivo solo hablan miembros actuales)
  _clientEnv(S, cid, raw, live) {
    const env = e2.okEnv(raw)
    if (!env || typeof cid !== 'string' || !S.msgs[cid]) return false
    S.syncTs = Math.max(S.syncTs || 0, Math.min(env.ts, Date.now()))
    if (S.msgs[cid].some((x) => x.id === env.id)) return false
    if (live && !S.members[env.from]) return false
    const text = this._decryptEnv(S, cid, env)
    if (text === 'nokey') { (S.undec ||= []).push({ cid, env }); if (S.undec.length > 300) S.undec.shift(); return false }
    if (text === null) return false
    const mem = S.members[env.from]
    const msg = { id: env.id, from: env.from, name: mem ? mem.name : 'Usuario', v: !!(mem && mem.verified), ts: env.ts, text }
    const list = S.msgs[cid]
    list.push(msg)
    if (!live) list.sort((x, y) => x.ts - y.ts)
    if (list.length > L.histClient) list.splice(0, list.length - L.histClient)
    this._save()
    this.node.emit('server-msg', { sid: S.id, cid, m: msg, mine: msg.from === this.me, history: !live })
    return true
  }

  _sendHistoryE2ee(S, peer, since) {
    const frames = []
    for (const ch of S.channels) {
      const list = (S.relay[ch.id] || []).filter((x) => x.ts > since).slice(-(since ? L.syncMax : L.firstSync))
      let batch = []
      let size = 0
      for (const e of list) {
        const len = Buffer.byteLength(JSON.stringify(e))
        if (batch.length && size + len > L.frameBytes) { frames.push({ t: 'srv-hist', sid: S.id, cid: ch.id, envs: batch }); batch = []; size = 0 }
        batch.push(e); size += len
      }
      if (batch.length) frames.push({ t: 'srv-hist', sid: S.id, cid: ch.id, envs: batch })
    }
    let i = 0
    const step = () => {
      if (i >= frames.length || peer.conn.destroyed || this.node.peers.get(peer.key) !== peer) return
      this.node._send(peer, frames[i++])
      setTimeout(step, L.paceMs).unref?.()
    }
    step()
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
      members: v.members, customRoles: v.customRoles, voice: v.voice,
      audit: RANK[(S.members[key] || {}).role] >= RANK.admin ? S.audit : [],
      e2ee: !!S.e2ee, needsRotation: !!S.needsRotation,
      // solo el dueño recibe los datos para aprobar a quienes entraron (su clave de cifrado y su prueba de invitación)
      pending: S.e2ee && key === S.ownerKey
        ? Object.entries(S.members).filter(([k, m]) => m.xk && k !== S.ownerKey && !this._hostHasKey(S, k)).slice(0, 12).map(([k, m]) => ({ key: k, xk: m.xk, proof: m.proof, tok: m.tok }))
        : undefined
    }
  }

  _broadcastState(S) {
    for (const key of Object.keys(S.members)) {
      const peer = key === this.me ? null : this._peer(key)
      if (peer) this.node._send(peer, { t: 'srv-state', s: this._stateFor(S, key) })
    }
    this._emit({ sid: S.id })
    if (S.e2ee && S.ownerKey === this.me && S.hostKey === this.me) this._ownerProcess(S) // el dueño aprueba y renueva claves
  }

  _toMembers(S, obj) {
    for (const key of Object.keys(S.members)) {
      const peer = key === this.me ? null : this._peer(key)
      if (peer) this.node._send(peer, obj)
    }
  }

  _hostJoin(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return this._err(peer, typeof m.sid === 'string' ? m.sid.slice(0, 16) : '', fail('Ese servidor ya no existe'))
    if (S.bans.includes(peer.key)) return this._err(peer, S.id, fail('No puedes unirte a este servidor'))
    if (!S.members[peer.key]) {
      const inv = typeof m.token === 'string' && TOKEN_RE.test(m.token) ? S.invites[m.token] : null
      if (!inv || inv.exp < Date.now() || inv.uses >= inv.max) return this._err(peer, S.id, fail('La invitación no es válida o venció'))
      let extra = {}
      if (S.e2ee) {
        if (!e2.validXk(peer.key, m.xk) || typeof m.proof !== 'string' || !KEY_RE.test(m.proof)) {
          return this._err(peer, S.id, fail('Este servidor está cifrado: usa una invitación nueva (psrv2) y actualiza la app'))
        }
        extra = { xk: { xpub: m.xk.xpub, sig: m.xk.sig }, proof: m.proof, tok: m.token }
      }
      if (Object.keys(S.members).length >= L.maxMembers) return this._err(peer, S.id, fail('El servidor está lleno'))
      inv.uses++
      if (inv.uses >= inv.max) delete S.invites[m.token]
      S.members[peer.key] = { name: peer.remoteName || 'Usuario', role: 'member', verified: !!peer.verified, joined: Date.now(), ...extra }
      this._audit(S, peer.key, 'se unió al servidor')
      this._save()
    }
    this._broadcastState(S)
    this._sendHistory(S, peer, 0)
  }

  _hostHello(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return this._err(peer, typeof m.sid === 'string' ? m.sid.slice(0, 16) : '', fail('Ese servidor ya no existe'))
    const mem = S.members[peer.key]
    if (!mem) return this._err(peer, S.id, fail('Ya no eres miembro de este servidor'))
    mem.name = peer.remoteName || mem.name
    mem.verified = !!peer.verified
    this._broadcastState(S)
    if (S.e2ee) this._sendKeys(S, peer)
    this._sendHistory(S, peer, Number.isFinite(m.since) ? m.since : 0)
  }

  _hostLeave(peer, m) {
    const S = this._hostServer(m.sid)
    const mem = S && S.members[peer.key]
    if (!mem || mem.role === 'owner') return
    this._audit(S, peer.key, 'salió del servidor')
    delete S.members[peer.key]
    for (const who of Object.values(S.voice || {})) if (who) delete who[peer.key]
    if (S.e2ee) { delete S.keyBox[peer.key]; S.needsRotation = true }
    this._save()
    this._broadcastState(S)
  }

  // ---------- Voz: lado anfitrión ----------

  _hostVoiceJoin(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S || !S.members[peer.key]) return
    const c = (S.channels || []).find((x) => x.id === m.cid)
    if (!c || c.kind !== 'voice') return
    S.voice ||= {}
    for (const [cid, who] of Object.entries(S.voice)) if (cid !== m.cid && who) delete who[peer.key] // un canal a la vez
    S.voice[m.cid] ||= {}
    S.voice[m.cid][peer.key] = { name: S.members[peer.key].name || peer.remoteName || 'Usuario', muted: false }
    this._save()
    this._broadcastState(S)
  }

  _hostVoiceLeave(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return
    let changed = false
    for (const who of Object.values(S.voice || {})) if (who && who[peer.key]) { delete who[peer.key]; changed = true }
    if (!changed) return
    this._save()
    this._broadcastState(S)
  }

  _hostVoiceMute(peer, m) {
    const S = this._hostServer(m.sid)
    if (!S) return
    const who = (S.voice || {})[m.cid]
    if (!who || !who[peer.key]) return
    who[peer.key].muted = m.muted === true
    this._broadcastState(S)
  }

  // Llega un paquete de voz por la conexión. El encabezado dice servidor, canal y hablante.
  onVoice(peer, payload) {
    const sid = payload.toString('utf8', 0, 16)
    const cid = payload.toString('utf8', 16, 24)
    const speaker = payload.toString('utf8', 24, 88)
    const buf = payload.subarray(88)
    if (!buf.length) return
    const S = this.all[sid]
    if (!S) return
    if (S.hostKey === peer.key) {
      // Viene del anfitrión: es audio de otra persona del canal. Solo si estoy en ese canal.
      if (!S.voice || !S.voice[cid] || !S.voice[cid][speaker] || !S.voice[cid][this.me]) return
      this.node.emit('voice', { sid, cid, from: speaker, buf })
      return
    }
    // Soy el anfitrión: reenvío el audio del miembro (ignoro la clave que él diga, uso la real).
    if (S.hostKey !== this.me || !S.members[peer.key]) return
    if (!S.voice || !S.voice[cid] || !S.voice[cid][peer.key]) return
    this.node.emit('voice', { sid, cid, from: peer.key, buf }) // el anfitrión también escucha
    this._broadcastVoice(S, cid, peer.key, buf)
  }

  _broadcastVoice(S, cid, fromKey, buf) {
    const who = (S.voice || {})[cid]
    if (!who) return
    for (const key of Object.keys(who)) {
      if (key === fromKey || key === this.me) continue
      const peer = this._peer(key)
      if (peer) this.node.sendVoice(peer, S.id, cid, fromKey, buf)
    }
  }

  // Envía el historial reciente en paquetes pequeños y con pausas.
  _sendHistory(S, peer, since) {
    if (S.e2ee) return this._sendHistoryE2ee(S, peer, since)
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
    if (S.e2ee) throw fail('Editar mensajes no está disponible en servidores cifrados')
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
    if (S.e2ee) { // el anfitrión solo ve sobres cifrados: borra por su identificador
      const relay = typeof cid === 'string' ? S.relay[cid] : null
      const env = relay && typeof id === 'string' ? relay.find((x) => x.id === id) : null
      if (!env) throw fail('Mensaje no encontrado')
      const rank = RANK[(S.members[key] || {}).role] ?? -1
      if (env.from !== key && rank < RANK.mod) throw fail('No tienes permiso para borrar ese mensaje')
      relay.splice(relay.indexOf(env), 1)
      const own = S.msgs[cid] || []
      const i = own.findIndex((x) => x.id === id)
      if (i >= 0) own.splice(i, 1)
      if (env.from !== key) this._audit(S, key, 'borró un mensaje de', env.from)
      this._save()
      this._toMembers(S, { t: 'srv-msg-del', sid: S.id, cid, id })
      this.node.emit('server-msg', { sid: S.id, cid, removed: id })
      return
    }
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
      for (const who of Object.values(S.voice || {})) if (who) delete who[key]
      if (S.e2ee) { delete S.keyBox[key]; S.needsRotation = true } // quien sale ya no debe recibir claves nuevas
    }

    switch (op) {
      case 'channel-add': {
        need('admin')
        const name = chanName(a.name)
        if (!name) throw fail('Nombre de canal no válido')
        if (S.channels.length >= L.maxChannels) throw fail('Demasiados canales')
        const id = rid(4)
        const kind = a.kind === 'voice' ? 'voice' : 'text'
        S.channels.push({ id, name, kind })
        S.msgs[id] = []
        if (S.e2ee) S.relay[id] = []
        return done('creó el canal ' + (kind === 'voice' ? '🔊 ' : '#') + name)
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
        if (S.relay) delete S.relay[c.id]
        if (S.voice) delete S.voice[c.id]
        return done('eliminó el canal ' + (c.kind === 'voice' ? '🔊 ' : '#') + c.name)
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
        let roleId = null
        if (a.roleId != null) {
          const cr = (S.customRoles || []).find((r) => r.id === a.roleId)
          if (!cr || cr.base !== a.role) throw fail('Ese rol personalizado no es válido')
          roleId = cr.id
        }
        S.members[key].role = a.role
        if (roleId) S.members[key].roleId = roleId
        else delete S.members[key].roleId
        const label = roleId ? (S.customRoles.find((r) => r.id === roleId) || {}).name : a.role
        return done('cambió el rol a ' + label + ' de', key)
      }
      case 'role-add': {
        need('admin')
        const base = ROLE_BASES.includes(a.base) ? a.base : null
        const name = clean(a.name, 24)
        if (!base || !name) throw fail('Rol no válido')
        if (RANK[base] >= rank(actor)) throw fail('No puedes crear un rol con ese nivel')
        S.customRoles = S.customRoles || []
        if (S.customRoles.length >= L.maxCustomRoles) throw fail('Hay demasiados roles personalizados')
        const id = rid(4)
        S.customRoles.push({ id, name, color: ROLE_COLOR_RE.test(a.color) ? String(a.color).toLowerCase() : '#9294a5', base })
        return done('creó el rol ' + name)
      }
      case 'role-edit': {
        need('admin')
        const r = (S.customRoles || []).find((x) => x.id === a.id)
        if (!r) throw fail('Rol no encontrado')
        if (RANK[r.base] >= rank(actor)) throw fail('No puedes editar ese rol')
        const base = ROLE_BASES.includes(a.base) ? a.base : r.base
        if (RANK[base] >= rank(actor)) throw fail('No puedes usar ese nivel')
        const name = clean(a.name, 24)
        if (!name) throw fail('Nombre de rol no válido')
        r.name = name
        r.base = base
        if (ROLE_COLOR_RE.test(a.color)) r.color = String(a.color).toLowerCase()
        for (const m of Object.values(S.members)) if (m.roleId === r.id) m.role = base
        return done('editó el rol ' + name)
      }
      case 'role-del': {
        need('admin')
        const i = (S.customRoles || []).findIndex((x) => x.id === a.id)
        if (i < 0) throw fail('Rol no encontrado')
        const r = S.customRoles[i]
        if (RANK[r.base] >= rank(actor)) throw fail('No puedes eliminar ese rol')
        S.customRoles.splice(i, 1)
        for (const m of Object.values(S.members)) if (m.roleId === r.id) delete m.roleId
        return done('eliminó el rol ' + r.name)
      }
      case 'invite': {
        need(S.e2ee ? 'owner' : 'mod') // en servidores cifrados la invitación lleva un secreto que solo conoce el dueño
        const now = Date.now()
        for (const [t, inv] of Object.entries(S.invites)) if (inv.exp < now || inv.uses >= inv.max) delete S.invites[t]
        if (Object.keys(S.invites).length >= L.maxInvites) throw fail('Hay demasiadas invitaciones activas')
        const hours = Number.isInteger(a.hours) ? Math.min(720, Math.max(1, a.hours)) : 24
        const max = Number.isInteger(a.max) ? Math.min(50, Math.max(1, a.max)) : 5
        const token = S.e2ee ? (typeof a.token === 'string' && TOKEN_RE.test(a.token) && !S.invites[a.token] ? a.token : null) : rid(8)
        if (!token) throw fail('Invitación no válida')
        S.invites[token] = { exp: now + hours * 3600000, max, uses: 0, by: actor }
        this._save()
        if (S.e2ee) return {}
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
      S = this.all[sid] = {
        id: sid, hostKey: peer.key, created: Date.now(), msgs: {}, members: {}, channels: [],
        // en un servidor cifrado, el dueño y el cifrado vienen de la invitación (no de lo que diga el anfitrión)
        ...(pend.e2ee ? { e2ee: true, ownerKey: pend.owner, epoch: 0, keys: {}, approved: {}, inviteSecrets: {}, undec: [], needsRotation: false } : {})
      }
    } else if (S.hostKey !== peer.key) return
    S.name = state.name
    S.channels = state.channels
    S.members = Object.fromEntries(state.members.map((x) => [x.key, { name: x.name, role: x.role, roleId: x.roleId || null, verified: x.verified, online: x.online, muted: x.muted, hasKey: x.hasKey }]))
    S.customRoles = state.customRoles
    S.audit = state.audit
    // Canales de voz: si el anfitrión ya no me cuenta donde estaba, corto el audio.
    const wasIn = new Set(Object.entries(S.voice || {}).filter(([, who]) => who && who[this.me]).map(([cid]) => cid))
    S.voice = {}
    for (const [cid, list] of Object.entries(state.voice || {})) {
      S.voice[cid] = Object.fromEntries(list.map((v) => [v.key, { name: v.name, muted: v.muted }]))
    }
    for (const cid of wasIn) if (!S.voice[cid]) this.node.emit('voice-end', { sid: S.id, cid })
    if (S.e2ee) { S.needsRotation = state.needsRotation; S.pendingApprovals = state.pending; this._ownerProcess(S) }
    for (const c of S.channels) S.msgs[c.id] ||= []
    for (const cid of Object.keys(S.msgs)) if (!S.channels.some((c) => c.id === cid)) delete S.msgs[cid]
    this._save()
    this._emit({ sid })
  }

  _clientMsg(peer, m) {
    const S = this._fromHost(peer, m.sid)
    if (S && S.e2ee) { if (m.e) this._clientEnv(S, m.cid, m.e, true); return } // en un servidor cifrado, el texto plano se descarta
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
    if (S && S.e2ee) return // no se aceptan ediciones del anfitrión en servidores cifrados
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
    if (S && S.e2ee) {
      if (typeof m.cid !== 'string' || !S.msgs[m.cid] || !Array.isArray(m.envs)) return
      let added = false
      for (const raw of m.envs.slice(0, 20)) added = this._clientEnv(S, m.cid, raw, false) || added
      if (added) this.node.emit('server-msg', { sid: S.id, cid: m.cid, history: true })
      return
    }
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
