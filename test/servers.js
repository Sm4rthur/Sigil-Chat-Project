'use strict'
// Servidores alojados en el PC del creador: unirse, mensajes, roles, moderación, invitaciones y ataques.
const assert = require('assert')
const { makeNode, connect, sleep, finish } = require('./helpers')
const { encodeFrame, T_JSON } = require('../src/frames')
const { LIMITS: NET } = require('../src/network')

const watch = (node) => {
  const w = { errors: [], gone: [], invites: [], msgs: [] }
  node.on('servers', (i) => { if (i.error) w.errors.push(i.error); if (i.gone) w.gone.push(i.gone) })
  node.on('server-invite', (i) => w.invites.push(i.code))
  node.on('server-msg', (i) => i.m && w.msgs.push(i.m.text))
  return w
}
const lastErr = (w) => w.errors[w.errors.length - 1] || ''

;(async () => {
  const ana = await makeNode('ana')
  const beto = await makeNode('beto')
  const carlos = await makeNode('carlos')
  const dana = await makeNode('dana')
  const [wa, wb, wc, wd] = [ana, beto, carlos, dana].map(watch)

  // ---------- Crear servidor e invitar ----------
  const sv = ana.servers.create('Mi servidor', null, { e2ee: false })
  const sid = sv.id
  const gen = sv.channels[0].id
  assert.strictEqual(sv.mine, true)
  assert.strictEqual(sv.myRole, 'owner')
  assert.throws(() => ana.servers.create('   '), /nombre/)
  const inv1 = ana.servers.admin(sid, 'invite', { hours: 1, max: 1 })
  assert.match(inv1.code, /^psrv1\.[0-9a-f]{64}\.[0-9a-f]{16}\.[0-9a-f]{16}$/)

  // ---------- Unirse ----------
  assert.throws(() => beto.servers.join('basura'), /no es válido/)
  assert.throws(() => ana.servers.join(inv1.code), /tuyo/)
  beto.servers.join(inv1.code)
  const [la, lb] = connect(ana, beto) // lb es el extremo de Beto
  await sleep(250)
  let vb = beto.servers.get(sid)
  assert.deepStrictEqual([vb.name, vb.mine, vb.myRole, vb.hostOnline, vb.members.length, vb.channels.length], ['Mi servidor', false, 'member', true, 2, 1])
  assert.ok(ana.servers.get(sid).members.find((m) => m.key === beto.code).online)
  assert.strictEqual(ana.data.requests.length, 0, 'unirse a un servidor no crea solicitudes de chat')
  assert.throws(() => beto.servers.join(inv1.code), /Ya estás/)

  // La invitación de un solo uso ya se gastó: otra persona no puede usarla
  carlos.servers.join(inv1.code)
  const [lac, lc] = connect(ana, carlos)
  await sleep(250)
  assert.match(lastErr(wc), /invitación/)
  assert.strictEqual(carlos.servers.list().length, 0)
  lac.destroy()

  // ---------- Mensajes ----------
  beto.servers.send(sid, gen, 'hola grupo')
  await sleep(100)
  ana.servers.send(sid, gen, 'bienvenido')
  await sleep(100)
  for (const n of [ana, beto]) assert.deepStrictEqual(n.servers.messages(sid, gen).map((m) => m.text), ['hola grupo', 'bienvenido'])
  assert.strictEqual(ana.servers.messages(sid, gen)[0].name, 'beto')
  assert.deepStrictEqual(wb.msgs, ['hola grupo', 'bienvenido'])

  // ---------- Permisos ----------
  beto.servers.admin(sid, 'channel-add', { name: 'Nuevo' })
  await sleep(100)
  assert.match(lastErr(wb), /permiso/)
  beto.servers.admin(sid, 'role', { key: beto.code, role: 'admin' })
  await sleep(100)
  assert.match(lastErr(wb), /permiso/, 'un miembro no se puede ascender')

  ana.servers.admin(sid, 'role', { key: beto.code, role: 'mod' })
  await sleep(100)
  assert.strictEqual(beto.servers.get(sid).myRole, 'mod')
  beto.servers.admin(sid, 'invite', { hours: 2, max: 5 }) // un mod sí puede invitar
  await sleep(100)
  assert.strictEqual(wb.invites.length, 1)
  beto.servers.admin(sid, 'channel-add', { name: 'Nuevo' })
  await sleep(100)
  assert.match(lastErr(wb), /permiso/, 'un mod no crea canales')
  beto.servers.admin(sid, 'ban', { key: ana.code })
  await sleep(100)
  assert.match(lastErr(wb), /permiso/)

  ana.servers.admin(sid, 'role', { key: beto.code, role: 'admin' })
  await sleep(100)
  beto.servers.admin(sid, 'channel-add', { name: 'Charla Libre!!' })
  await sleep(100)
  const chans = beto.servers.get(sid).channels
  assert.deepStrictEqual(chans.map((c) => c.name), ['general', 'charla-libre'])
  beto.servers.admin(sid, 'kick', { key: ana.code })
  await sleep(100)
  assert.match(lastErr(wb), /rango/, 'nadie actúa sobre el dueño')
  beto.servers.admin(sid, 'role', { key: ana.code, role: 'member' })
  await sleep(100)
  assert.match(lastErr(wb), /rango|permiso|asignar/)
  assert.strictEqual(ana.servers.get(sid).myRole, 'owner')
  assert.ok(ana.servers.get(sid).audit.length > 0, 'hay registro de acciones')
  assert.ok(beto.servers.get(sid).audit.length > 0, 'un admin ve el registro')

  // ---------- Otro miembro (Carlos) con la invitación de Beto ----------
  carlos.servers.join(wb.invites[0])
  const [lac2, lc2] = connect(ana, carlos)
  await sleep(300)
  assert.strictEqual(carlos.servers.get(sid).members.length, 3)
  assert.strictEqual(carlos.servers.get(sid).audit.length, 0, 'un miembro no ve el registro')
  assert.deepStrictEqual(carlos.servers.messages(sid, gen).map((m) => m.text), ['hola grupo', 'bienvenido'], 'recibe el historial')

  // Beto no puede dar admin (solo el dueño), sí mod
  beto.servers.admin(sid, 'role', { key: carlos.code, role: 'admin' })
  await sleep(100)
  assert.match(lastErr(wb), /asignar/)

  // ---------- Silenciar ----------
  beto.servers.admin(sid, 'mute', { key: carlos.code, minutes: 10 })
  await sleep(100)
  carlos.servers.send(sid, gen, 'no debería pasar')
  await sleep(100)
  assert.match(lastErr(wc), /silenciado/)
  assert.ok(!ana.servers.messages(sid, gen).some((m) => m.text === 'no debería pasar'))
  assert.ok(carlos.servers.get(sid).members.find((m) => m.key === carlos.code).muted)
  beto.servers.admin(sid, 'mute', { key: carlos.code, minutes: 0 })
  await sleep(100)
  carlos.servers.send(sid, gen, 'ya puedo hablar')
  await sleep(100)
  assert.ok(ana.servers.messages(sid, gen).some((m) => m.text === 'ya puedo hablar'))

  // ---------- Editar y borrar ----------
  const mine = ana.servers.messages(sid, gen).find((m) => m.text === 'ya puedo hablar')
  carlos.servers.edit(sid, gen, mine.id, 'ya puedo hablar (editado)')
  await sleep(100)
  assert.ok(beto.servers.messages(sid, gen).some((m) => m.text === 'ya puedo hablar (editado)' && m.edited))
  beto.servers.edit(sid, gen, mine.id, 'robado')
  await sleep(100)
  assert.match(lastErr(wb), /propios/, 'solo el autor edita')
  const betoMsg = ana.servers.messages(sid, gen).find((m) => m.text === 'hola grupo')
  carlos.servers.del(sid, gen, betoMsg.id)
  await sleep(100)
  assert.match(lastErr(wc), /permiso/, 'un miembro no borra mensajes ajenos')
  beto.servers.del(sid, gen, mine.id) // un admin sí
  await sleep(100)
  assert.ok(!ana.servers.messages(sid, gen).some((m) => m.id === mine.id))
  assert.ok(!carlos.servers.messages(sid, gen).some((m) => m.id === mine.id))

  // ---------- Expulsar, banear y volver ----------
  beto.servers.admin(sid, 'kick', { key: carlos.code })
  await sleep(150)
  assert.deepStrictEqual(wc.gone.at(-1), 'kicked')
  assert.strictEqual(carlos.servers.list().length, 0)
  assert.strictEqual(ana.servers.get(sid).members.length, 2)
  assert.throws(() => carlos.servers.send(sid, gen, 'hola'), /no encontrado/)

  const inv2 = ana.servers.admin(sid, 'invite', { hours: 1, max: 5 })
  carlos.servers.join(inv2.code) // expulsado no es baneado: puede volver
  await sleep(250)
  assert.strictEqual(carlos.servers.get(sid).members.length, 3)

  ana.servers.admin(sid, 'ban', { key: carlos.code })
  await sleep(150)
  assert.deepStrictEqual(wc.gone.at(-1), 'banned')
  carlos.servers.join(inv2.code)
  await sleep(250)
  assert.match(lastErr(wc), /No puedes unirte/)
  ana.servers.admin(sid, 'unban', { key: carlos.code })
  carlos.servers.join(inv2.code)
  await sleep(250)
  assert.strictEqual(carlos.servers.get(sid).members.length, 3, 'tras desbanear puede volver')

  // ---------- Invitaciones falsas o vencidas ----------
  const [, hostKey, , ] = inv2.code.split('.')
  const fake = `psrv1.${hostKey}.${sid}.${'ab'.repeat(8)}`
  dana.servers.join(fake)
  const [lad, ld] = connect(ana, dana)
  await sleep(250)
  assert.match(lastErr(wd), /invitación/)
  const exp = ana.servers.admin(sid, 'invite', { hours: 1, max: 5 })
  const token = exp.code.split('.')[3]
  ana.servers.all[sid].invites[token].exp = 1 // vencida
  dana.servers.join(exp.code)
  await sleep(250)
  assert.match(lastErr(wd), /venció/)
  lad.destroy()

  // ---------- Quien no es miembro no puede hacer nada ----------
  const [lad2, ld2] = connect(ana, dana)
  await sleep(100)
  const raw = (stream, o) => stream.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(o))))
  const before = ana.servers.messages(sid, gen).length
  raw(ld2, { t: 'srv-send', sid, cid: gen, text: 'soy un intruso' })
  raw(ld2, { t: 'srv-admin', sid, op: 'ban', a: { key: beto.code } })
  raw(ld2, { t: 'srv-admin', sid, op: 'close', a: {} })
  raw(ld2, { t: 'srv-del', sid, cid: gen, id: betoMsg.id })
  await sleep(150)
  assert.strictEqual(ana.servers.messages(sid, gen).length, before)
  assert.ok(ana.servers.get(sid).members.find((m) => m.key === beto.code), 'no pudo banear a nadie')

  // ---------- Datos mal formados de un miembro ----------
  const bad = [
    { t: 'srv-send', sid, cid: 5, text: 'x' }, { t: 'srv-send', sid, cid: 'zz', text: 'x' }, { t: 'srv-send', sid: {}, cid: gen, text: 'x' },
    { t: 'srv-send', sid, cid: gen, text: { a: 1 } }, { t: 'srv-send', sid, cid: gen, text: '   ' },
    { t: 'srv-admin', sid, op: 'inventada', a: {} }, { t: 'srv-admin', sid, op: 'kick', a: [] }, { t: 'srv-admin', sid, op: 'mute', a: { key: 'x', minutes: 'mucho' } },
    { t: 'srv-admin', sid, op: 'channel-add', a: { name: { x: 1 } } }, { t: 'srv-admin', sid, op: 'role', a: { key: carlos.code, role: 'owner' } },
    { t: 'srv-admin', sid, op: '__proto__', a: {} }, { t: 'srv-edit', sid, cid: gen, id: {}, text: 'x' }, { t: 'srv-join', sid, token: ['x'] }, { t: 'srv-hello', sid: 7 }
  ]
  for (const b of bad) raw(lb, b)
  raw(lb, { t: 'srv-send', sid, cid: gen, text: 'a'.repeat(5000) })
  await sleep(200)
  const long = ana.servers.messages(sid, gen).at(-1)
  assert.strictEqual(long.text.length, 2000, 'los mensajes largos se recortan')
  assert.ok(ana.servers.get(sid).members.find((m) => m.key === carlos.code).role === 'member')

  // ---------- Límite de velocidad por miembro ----------
  const n0 = ana.servers.messages(sid, gen).length
  for (let i = 0; i < 25; i++) carlos.servers.send(sid, gen, 'spam ' + i)
  await sleep(300)
  const accepted = ana.servers.messages(sid, gen).length - n0
  assert.ok(accepted <= 13 && accepted >= 8, 'solo pasa una ráfaga (' + accepted + ')')
  assert.match(lastErr(wc), /demasiado rápido/)

  // ---------- Quien no es el anfitrión no puede alterar mi servidor ----------
  const stateOf = () => ({ t: 'srv-state', s: { id: sid, name: 'HACKEADO', channels: [{ id: gen, name: 'x' }], members: [{ key: carlos.code, name: 'x', role: 'owner' }], you: { role: 'owner' } } })
  raw(lc2, stateOf()) // Carlos intenta cambiar el estado en el PC de Ana (que es la anfitriona)
  await sleep(100)
  assert.strictEqual(ana.servers.get(sid).name, 'Mi servidor')
  // Carlos (que no es el anfitrión) escribe directamente a Beto haciéndose pasar por el servidor
  const [lbc, lcb] = connect(beto, carlos)
  await sleep(100)
  raw(lcb, stateOf())
  raw(lcb, { t: 'srv-msg', sid, cid: gen, m: { id: 'a'.repeat(12), from: ana.code, name: 'Ana', ts: Date.now(), text: 'falso' } })
  raw(lcb, { t: 'srv-hist', sid, cid: gen, msgs: [{ id: 'b'.repeat(12), from: ana.code, name: 'Ana', ts: Date.now(), text: 'falso2' }] })
  raw(lcb, { t: 'srv-invite', sid, code: inv2.code })
  raw(lcb, { t: 'srv-gone', sid, reason: 'closed' })
  raw(lcb, { t: 'srv-err', sid, msg: 'mentira' })
  await sleep(150)
  assert.strictEqual(beto.servers.list().length, 1, 'el servidor sigue ahí')
  assert.strictEqual(beto.servers.get(sid).name, 'Mi servidor')
  assert.ok(!beto.servers.messages(sid, gen).some((m) => m.text.startsWith('falso')))
  assert.ok(!wb.errors.includes('mentira'))
  lbc.destroy()
  beto.data.requests = []

  // ---------- Reconexión: recupera lo que se perdió ----------
  lb.destroy()
  await sleep(100)
  assert.ok(!ana.servers.get(sid).members.find((m) => m.key === beto.code).online)
  assert.strictEqual(beto.servers.get(sid).hostOnline, false)
  assert.throws(() => beto.servers.send(sid, gen, 'sin conexión'), /desconectado/)
  const have = beto.servers.messages(sid, gen).length
  for (let i = 0; i < 3; i++) { ana.servers.send(sid, gen, 'mientras no estabas ' + i); await sleep(5) }
  connect(ana, beto)
  await sleep(300)
  const texts = beto.servers.messages(sid, gen).map((m) => m.text)
  assert.ok(texts.includes('mientras no estabas 0') && texts.includes('mientras no estabas 2'))
  assert.strictEqual(new Set(beto.servers.messages(sid, gen).map((m) => m.id)).size, beto.servers.messages(sid, gen).length, 'sin duplicados')
  assert.ok(beto.servers.messages(sid, gen).length >= have + 3)
  assert.ok(ana.servers.get(sid).members.find((m) => m.key === beto.code).online)

  // ---------- Conexión de un desconocido que no se une ----------
  ana.data.requests = [] // (Dana, que ya no intentaba unirse, sí quedó como solicitud de chat normal)
  NET.helloTimeoutMs = 80
  const stranger = await makeNode('sin-rumbo')
  stranger.servers.pending.set('f'.repeat(16), { hostKey: ana.code, token: 'a'.repeat(16), timer: setTimeout(() => {}, 1) })
  const [ls] = connect(ana, stranger)
  await sleep(250)
  assert.ok(ls.destroyed, 'quien dice venir por un servidor y no se une, se corta')
  assert.strictEqual(ana.data.requests.length, 0)
  NET.helloTimeoutMs = 10000

  // ---------- Salir, y eliminar el servidor ----------
  carlos.servers.leave(sid)
  await sleep(150)
  assert.strictEqual(ana.servers.get(sid).members.length, 2)
  assert.throws(() => ana.servers.leave(sid), /dueño/)
  ana.servers.admin(sid, 'close')
  await sleep(150)
  assert.deepStrictEqual(wb.gone.at(-1), 'closed')
  assert.strictEqual(beto.servers.list().length, 0)
  assert.strictEqual(ana.servers.list().length, 0)

  // ---------- Los datos del servidor se guardan cifrados ----------
  const vault = require('fs').readFileSync(ana.vault.file, 'utf8')
  assert.ok(!vault.includes('Mi servidor') && !vault.includes('mientras no estabas'))

  await finish('servers.js: todo bien')
})().catch((err) => { console.error(err); process.exit(1) })
