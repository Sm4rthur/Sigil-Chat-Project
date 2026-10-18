'use strict'
// Fuzzing: miles de mensajes aleatorios y mal formados desde cada tipo de remitente (contacto, miembro, desconocido y anfitrión)
// para encontrar fallos que las pruebas dirigidas no ven. Reproducible: misma semilla, mismos mensajes.
const assert = require('assert')
const crypto = require('crypto')
const { makeNode, connect, sleep, finish } = require('./helpers')
const { encodeFrame, T_JSON, T_AUDIO, T_FILE } = require('../src/frames')
const { P2PNode, LIMITS } = require('../src/network')
const { Servers } = require('../src/servers')
const e2 = require('../src/e2ee')

process.on('uncaughtException', (e) => { console.error('EXCEPCIÓN NO CONTROLADA:', e); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error('PROMESA RECHAZADA:', e); process.exit(1) })

let seed = Number(process.env.FUZZ_SEED) || 20261013
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1e9) / 1e9 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const int = (n) => Math.floor(rnd() * n)

// ----- Detección de fallos internos (errores de programación, no rechazos de datos inválidos) -----
const bugs = new Map()
const isBug = (e) => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError
const note = (where, e) => { const k = where + ': ' + (e && e.message); if (!bugs.has(k)) bugs.set(k, (e && e.stack || '').split('\n').slice(0, 3).join(' | ')) }

const origFrame = P2PNode.prototype._onFrame
P2PNode.prototype._onFrame = function (peer, type, payload) {
  try { return origFrame.call(this, peer, type, payload) } catch (e) { if (isBug(e)) note('network._onFrame', e); throw e }
}
const origErr = Servers.prototype._err
Servers.prototype._err = function (peer, sid, e) { if (isBug(e)) note('servers (convertido en error al usuario)', e); return origErr.call(this, peer, sid, e) }

;(async () => {
  LIMITS.jsonBurst = 1e9; LIMITS.jsonPerSec = 1e9; LIMITS.maxUnknownConnections = 1000; LIMITS.helloTimeoutMs = 60000

  const ana = await makeNode('ana')      // objetivo
  const beto = await makeNode('beto')    // contacto
  const carlos = await makeNode('carlos') // miembro de los servidores de ana
  const dana = await makeNode('dana')    // desconocida
  const hosty = await makeNode('hosty')  // anfitrión de un servidor al que se une 'vic'
  const vic = await makeNode('vic')      // objetivo del lado miembro
  ana.addContact(beto.code, 'Beto'); beto.addContact(ana.code, 'Ana')

  const sidE = ana.servers.create('E2EE').id
  const sidL = ana.servers.create('Legacy', null, { e2ee: false }).id
  const cid = (sid) => ana.servers.all[sid].channels[0].id
  for (const sid of [sidE, sidL]) ana.servers.all[sid].members[carlos.code] = { name: 'carlos', role: 'member', verified: false, joined: Date.now() }
  // vic se une de verdad a dos servidores de hosty
  const hE = hosty.servers.create('HE'); const hL = hosty.servers.create('HL', null, { e2ee: false })
  for (const [sv, leg] of [[hE, false], [hL, true]]) {
    const inv = hosty.servers.admin(sv.id, 'invite', { hours: 1, max: 5 })
    vic.servers.join(inv.code)
  }
  connect(hosty, vic)
  await sleep(500)
  assert.strictEqual(vic.servers.list().length, 2, 'vic pertenece a dos servidores de hosty')

  // ----- Generadores -----
  const hex = (n) => crypto.randomBytes(n / 2).toString('hex')
  const REAL = () => [sidE, sidL, hE.id, hL.id, ana.code, beto.code, carlos.code, dana.code, cid(sidE), cid(sidL), hex(16), hex(8), hex(64), hex(12), hex(32)]
  const strings = () => ['', 'a', 'hola', '__proto__', 'constructor', 'prototype', 'toString', '../../x', '\u0000', '\u202e', '<script>alert(1)</script>', 'x'.repeat(300), 'y'.repeat(5000), 'z'.repeat(15000), ...REAL()]
  function rv(depth = 0) {
    const r = rnd()
    if (r < 0.12) return pick([null, true, false])
    if (r < 0.27) return pick([0, 1, -1, 2, 12, 100, 1.5, -0.5, 2 ** 31, 2 ** 53, 1e300, -1e300, 4294967296, 999999999999])
    if (r < 0.6) return pick(strings())
    if (r < 0.7 && depth < 3) return Array.from({ length: int(5) }, () => rv(depth + 1))
    if (depth < 3) { const o = {}; for (let i = 0; i < int(5); i++) o[pick(FIELDS)] = rv(depth + 1); return o }
    return null
  }
  const FIELDS = ['id', 'name', 'text', 'cert', 'prof', 'srv', 'rev', 'n', 'size', 'sha', 'mime', 'd', 'i', 'sid', 'cid', 'token', 'tok', 'xk', 'xpub', 'proof', 'e', 'm', 's', 'code', 'msg', 'reason', 'boxes', 'msgs', 'envs', 'op', 'a', 'key', 'role', 'hours', 'max', 'minutes', 'since', 'edited', 'from', 'ts', 'ep', 'to', 'epk', 'c', 'sig', 'you', 'members', 'channels', 'audit', 'pending', 'online', 'verified', 'muted', 'hasKey', 'needsRotation', 'e2ee', 'u', 'p', 'i', '__proto__', 'constructor', 'toString', 'hasOwnProperty']
  const frameOf = (t) => {
    const o = { t }
    for (let i = 0; i < 1 + int(7); i++) o[pick(FIELDS)] = rv()
    // a veces con los campos "correctos" para llegar más profundo en el código
    if (rnd() < 0.5) Object.assign(o, { sid: pick([sidE, sidL, hE.id, hL.id]), cid: pick([cid(sidE), cid(sidL)]), key: pick([ana.code, beto.code, carlos.code, vic.code]), id: hex(12), op: pick(['kick', 'ban', 'unban', 'mute', 'role', 'invite', 'channel-add', 'channel-rename', 'channel-del', 'rename', 'close', '__proto__']) })
    if (rnd() < 0.3) o.t = t
    return o
  }
  const raw = (c, obj) => { try { if (!c.destroyed) c.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(obj)))) } catch { /* conexión cerrada */ } }
  const bin = (c, type) => { try { if (!c.destroyed) c.write(encodeFrame(type, crypto.randomBytes(1 + int(200)))) } catch {} }

  const TYPES = ['hello', 'msg', 'ack', 'call-invite', 'call-accept', 'call-end', 'profile-new', 'profile-req', 'profile-start', 'profile-chunk',
    'file-offer', 'file-req', 'file-end', 'file-gone', 'srv-join', 'srv-hello', 'srv-send', 'srv-edit', 'srv-del', 'srv-admin', 'srv-leave',
    'srv-state', 'srv-msg', 'srv-msg-edit', 'srv-msg-del', 'srv-hist', 'srv-invite', 'srv-err', 'srv-gone', 'srv-keys', 'desconocido', 'srv-x', '']
  const HOST_TYPES = TYPES.filter((t) => t.startsWith('srv-') || t === 'hello')

  const PER = Number(process.env.FUZZ_ROUNDS) || 40
  let sent = 0
  const campaign = async (name, makeLink, types, usesBinary) => {
    let c = makeLink()
    for (const t of types) {
      for (let i = 0; i < PER; i++) {
        if (c.destroyed) { c = makeLink(); await sleep(2) }
        raw(c, frameOf(t)); sent++
        if (usesBinary && i % 10 === 0) { bin(c, T_FILE); bin(c, T_AUDIO) }
      }
      await sleep(1)
    }
  }

  // Contacto, miembro y desconocido le escriben a ana; el anfitrión le escribe a vic
  await campaign('contacto', () => connect(ana, beto)[1], TYPES, true)
  await campaign('miembro', () => connect(ana, carlos)[1], TYPES.filter((t) => t.startsWith('srv-') || t === 'hello' || t === ''), true)
  await campaign('desconocido', () => connect(ana, dana)[1], TYPES, true)
  await campaign('anfitrión', () => { const [a] = connect(hosty, vic); return a }, HOST_TYPES, false)
  await sleep(300)
  console.log('fuzz: ' + sent + ' mensajes enviados (semilla ' + (process.env.FUZZ_SEED || 20261013) + ')')

  // ----- Invariantes -----
  assert.deepStrictEqual(Object.keys(Object.prototype), [], 'contaminación de Object.prototype')
  assert.strictEqual({}.polluted, undefined)
  assert.strictEqual([].polluted, undefined)
  for (const n of [ana, vic, beto, hosty]) {
    const text = JSON.stringify(n.vault.data) // debe poder serializarse
    assert.ok(text.length < 8 * 1024 * 1024, 'el almacén no debe crecer sin control (' + text.length + ' bytes)')
    assert.ok(Array.isArray(n.vault.data.contacts) && typeof n.vault.data.chats === 'object' && typeof n.vault.data.servers === 'object')
  }
  assert.ok(ana.data.requests.length <= 20, 'tope de solicitudes')
  for (const S of Object.values(ana.servers.all)) {
    assert.ok(Object.keys(S.members).length <= 50 && S.channels.length <= 25, 'topes del servidor')
    for (const m of Object.values(S.members)) assert.ok(['owner', 'admin', 'mod', 'member'].includes(m.role), 'rol válido')
    assert.strictEqual(Object.values(S.members).filter((m) => m.role === 'owner').length, 1, 'siempre exactamente un dueño')
    for (const list of Object.values(S.msgs)) assert.ok(list.length <= 500)
  }
  for (const S of Object.values(vic.servers.all)) {
    assert.ok(Object.keys(S.members).length <= 50 && S.channels.length <= 25)
    if (S.e2ee) assert.strictEqual(S.e2ee, true, 'un anfitrión no puede quitar el cifrado')
  }
  const he = vic.servers.all[hE.id] // el anfitrión SÍ puede sacar a vic (srv-gone); lo que no puede es quitar el cifrado ni cambiar al dueño
  if (he) assert.ok(he.e2ee === true && he.ownerKey === hosty.code, 'el cifrado y el dueño fijados en la invitación no cambian')
  // El dueño de ana no cambió, y ningún desconocido obtuvo rol
  for (const sid of [sidE, sidL]) assert.strictEqual(ana.servers.all[sid].members[ana.code].role, 'owner')

  if (bugs.size) {
    console.error('\nFALLOS INTERNOS ENCONTRADOS (' + bugs.size + '):')
    for (const [k, v] of bugs) console.error(' - ' + k + '\n     ' + v)
    process.exit(1)
  }
  await finish('fuzz.js: todo bien')
})().catch((e) => { console.error(e); process.exit(1) })
