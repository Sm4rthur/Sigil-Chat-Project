'use strict'
// Servidores con cifrado de extremo a extremo: claves, aprobación del dueño, renovación, anfitrión malicioso y repetidor ciego.
const assert = require('assert')
const { makeNode, connect, sleep, finish } = require('./helpers')
const { encodeFrame, T_JSON } = require('../src/frames')
const e2 = require('../src/e2ee')
const { createHost } = require('../headless/host')
const fs = require('fs')
const os = require('os')
const path = require('path')

const sendRaw = (conn, o) => conn.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(o))))
const watch = (n) => { const w = { errors: [], gone: [], invites: [] }; n.on('servers', (i) => { if (i.error) w.errors.push(i.error); if (i.gone) w.gone.push(i.gone) }); return w }
const last = (w) => w.errors[w.errors.length - 1] || ''
const texts = (n, sid, cid) => n.servers.messages(sid, cid).map((m) => m.text)
const SECRETS = (s) => JSON.stringify(s)

// Sobre válido armado a mano (para probar lo que haría un atacante con claves reales)
function craft(node, sid, cid, groupKeyB64, text, over = {}) {
  const env = { id: require('crypto').randomBytes(6).toString('hex'), from: node.code, ts: Date.now(), ep: 1, ...over }
  Object.assign(env, e2.encryptGroup(Buffer.from(groupKeyB64, 'base64'), Buffer.from(text), e2.msgAad(sid, cid, env)))
  env.sig = node.signer.sign(e2.msgSigData(sid, cid, env))
  return env
}

;(async () => {
  assert.ok((await makeNode('prueba')).e2eeReady, 'la identidad de prueba es compatible con la firma')

  // ================= A. Dueño y anfitrión en el mismo PC =================
  const ana = await makeNode('ana')
  const beto = await makeNode('beto')
  const carlos = await makeNode('carlos')
  const [wa, wb, wc] = [ana, beto, carlos].map(watch)

  const view = ana.servers.create('Cripto')
  const sid = view.id
  const gen = view.channels[0].id
  assert.deepStrictEqual([view.e2ee, view.hasKey, view.ownerKey], [true, true, ana.code])
  assert.strictEqual(ana.servers.all[sid].epoch, 1)

  const inv = ana.servers.admin(sid, 'invite', { hours: 1, max: 5 })
  assert.match(inv.code, /^psrv2\.[0-9a-f]{64}\.[0-9a-f]{16}\.[0-9a-f]{16}\.[0-9a-f]{64}\.[0-9a-f]{32}$/)
  beto.servers.join(inv.code); connect(ana, beto)
  await sleep(500)
  let vb = beto.servers.get(sid)
  assert.deepStrictEqual([vb.e2ee, vb.hasKey, vb.ownerKey, vb.members.length], [true, true, ana.code, 2], 'beto recibió su clave tras ser aprobado')
  carlos.servers.join(inv.code); connect(ana, carlos)
  await sleep(500)
  assert.ok(carlos.servers.get(sid).hasKey)

  beto.servers.send(sid, gen, 'hola, esto va cifrado')
  await sleep(200)
  ana.servers.send(sid, gen, 'bienvenidos')
  await sleep(200)
  for (const n of [ana, beto, carlos]) assert.deepStrictEqual(texts(n, sid, gen), ['hola, esto va cifrado', 'bienvenidos'])
  assert.strictEqual(ana.servers.messages(sid, gen)[0].name, 'beto')

  // El repetidor guarda solo sobres cifrados y firmados
  const relay = ana.servers.all[sid].relay[gen]
  assert.strictEqual(relay.length, 2)
  assert.ok(!SECRETS(relay).includes('cifrado') && !SECRETS(relay).includes('bienvenidos'), 'ningún texto en claro en el repetidor')
  assert.ok(relay.every((e) => e2.verify(e.from, e2.msgSigData(sid, gen, e), e.sig)), 'cada mensaje lleva la firma de su autor')

  // Edición no disponible; borrar sí
  assert.throws(() => beto.servers.edit(sid, gen, relay[0].id, 'x'), /cifrados/)
  beto.servers.del(sid, gen, relay[0].id)
  await sleep(200)
  assert.strictEqual(ana.servers.all[sid].relay[gen].length, 1)
  assert.deepStrictEqual(texts(carlos, sid, gen), ['bienvenidos'])

  // Un miembro sin clave no puede escribir; en servidores cifrados solo el dueño invita
  ana.servers.admin(sid, 'role', { key: beto.code, role: 'admin' })
  await sleep(150)
  assert.throws(() => beto.servers.admin(sid, 'invite', {}), /solo el dueño/)

  // ================= B. Repetidor "ciego" (Raspberry Pi) con el dueño en otro equipo =================
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-pi-'))
  const host = createHost({ dataDir: dir, name: 'pi' })
  await host.node.start()
  const owner = await makeNode('dueño')
  const m1 = await makeNode('miembro1')
  const m2 = await makeNode('miembro2')
  const m3 = await makeNode('miembro3')
  const [wo, w1, w2, w3] = [owner, m1, m2, m3].map(watch)

  const pv = host.node.servers.create('Comunidad Pi', owner.code) // cifrado por defecto
  const psid = pv.id
  const S0 = host.vault.data.servers[psid]
  assert.ok(S0.e2ee && S0.ownerKey === owner.code && !S0.keys.length, 'el anfitrión no tiene ninguna clave')

  owner.servers.join(`psrv2.${host.node.code}.${psid}.${'0'.repeat(16)}.${owner.code}.${'0'.repeat(32)}`)
  connect(host.node, owner)
  await sleep(400)
  assert.deepStrictEqual([owner.servers.get(psid).myRole, owner.servers.get(psid).hasKey], ['owner', true], 'el dueño inicia la época 1 desde su equipo')
  const pgen = owner.servers.get(psid).channels[0].id

  let invCode = null
  owner.on('server-invite', (i) => { invCode = i.code })
  const pinv = owner.servers.admin(psid, 'invite', { hours: 1, max: 5 })
  assert.match(pinv.code, /^psrv2\./)
  await sleep(150)
  for (const [n] of [[m1], [m2]]) { n.servers.join(pinv.code); connect(host.node, n) }
  await sleep(700)
  assert.ok(m1.servers.get(psid).hasKey && m2.servers.get(psid).hasKey, 'el dueño (remoto) aprobó y entregó las claves a través del anfitrión')
  assert.strictEqual(S0.keyBox[m1.code] && Object.keys(S0.keyBox[m1.code]).length, 1)

  // El dueño se desconecta: el anfitrión sigue repitiendo
  ;[...owner.peers.values()].forEach((p) => p.conn.destroy())
  await sleep(150)
  m1.servers.send(psid, pgen, 'secreto del grupo Pi')
  await sleep(200)
  assert.deepStrictEqual(texts(m2, psid, pgen), ['secreto del grupo Pi'])
  const piDump = JSON.stringify(host.vault.data)
  assert.ok(!piDump.includes('secreto del grupo Pi'), 'el anfitrión no tiene el texto en claro')
  assert.strictEqual(host.vault.data.servers[psid].relay[pgen].length, 1)
  assert.deepStrictEqual(Object.keys(S0.keys), [], 'ni una sola clave de grupo')

  // ---- Anfitrión malicioso: intenta falsificar, degradar y colarse ----
  const toM1 = host.node.peers.get(m1.code).conn
  const keyM2 = m2.servers.all[psid].keys[1]
  const before = texts(m1, psid, pgen).length
  const stateOf = (extra) => ({ t: 'srv-state', s: { id: psid, name: 'X', channels: [{ id: pgen, name: 'x' }], members: [{ key: m2.code, name: 'm2', role: 'member' }], you: { role: 'member' }, ...extra } })

  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, m: { id: 'a'.repeat(12), from: m2.code, name: 'miembro2', ts: Date.now(), text: 'texto plano inyectado' } })
  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, e: { id: 'b'.repeat(12), from: m2.code, ts: Date.now(), ep: 1, n: Buffer.alloc(12).toString('base64'), c: Buffer.alloc(40).toString('base64'), sig: Buffer.alloc(64).toString('base64') } })
  // sobre perfecto (clave correcta) pero firmado por el anfitrión haciéndose pasar por miembro2
  const forged = craft(host.node, psid, pgen, keyM2, 'falsificado', { from: m2.code })
  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, e: forged })
  // sobre auténtico de miembro2 pero con el texto cifrado alterado
  const real = craft(m2, psid, pgen, keyM2, 'auténtico')
  const bad = Buffer.from(real.c, 'base64'); bad[0] ^= 1
  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, e: { ...real, c: bad.toString('base64') } })
  // degradar: "este servidor no está cifrado"
  sendRaw(toM1, stateOf({ e2ee: false }))
  // caja de clave falsa, firmada por el anfitrión (no por el dueño), sellada a la clave real de m1
  const x1 = m1.servers._xkeys()
  const sealed = e2.seal(x1.pub, Buffer.alloc(32, 7), e2.keyAad(psid, 9, m1.code))
  const fakeBox = { to: m1.code, ep: 9, ...sealed }
  fakeBox.sig = host.node.signer.sign(e2.keySigData(psid, fakeBox))
  sendRaw(toM1, { t: 'srv-keys', sid: psid, boxes: [fakeBox] })
  await sleep(250)
  assert.strictEqual(texts(m1, psid, pgen).length, before, 'ningún mensaje falso entró')
  assert.ok(!m1.servers.all[psid].keys[9], 'la caja de clave falsa no se acepta: el dueño está fijado en la invitación')
  assert.strictEqual(m1.servers.all[psid].e2ee, true, 'no se puede degradar el cifrado')
  const frames = []
  const origSend = m1._send.bind(m1)
  m1._send = (peer, obj) => { frames.push(obj); return origSend(peer, obj) }
  m1.servers.send(psid, pgen, 'sigo cifrando')
  m1._send = origSend
  const sent = frames.find((f) => f.t === 'srv-send')
  assert.ok(sent.e && !('text' in sent), 'después del intento de degradación sigue enviando sobres cifrados')

  // Repetir un mensaje auténtico no lo duplica
  const onWire = host.vault.data.servers[psid].relay[pgen][0]
  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, e: onWire })
  sendRaw(toM1, { t: 'srv-msg', sid: psid, cid: pgen, e: onWire })
  await sleep(200)
  assert.strictEqual(texts(m1, psid, pgen).filter((t) => t === 'secreto del grupo Pi').length, 1)

  // Colarse: el anfitrión inventa un miembro con una prueba de invitación falsa
  const fakeId = require('crypto').randomBytes(32)
  const fakeSigner = e2.signerFromSeed(fakeId)
  const fakeKeys = e2.newXKeyPair()
  const fakePub = fakeSigner.publicKey.toString('hex')
  const token = Object.keys(S0.invites)[0]
  S0.members[fakePub] = { name: 'Falso', role: 'member', verified: false, joined: Date.now(), xk: e2.bindXKey(fakeSigner, fakeKeys.pub.toString('hex')), proof: '0'.repeat(64), tok: token }
  connect(host.node, owner) // el dueño vuelve a conectarse (ya es miembro: reanuda con srv-hello)
  await sleep(500)
  assert.ok(!owner.servers.all[psid].approved[fakePub], 'sin la prueba de invitación, el dueño no lo aprueba')
  assert.ok(!S0.keyBox[fakePub], 'el anfitrión no consigue ninguna clave')
  delete S0.members[fakePub]

  // ---- Quien entra con un secreto equivocado queda sin clave ----
  const sec = pinv.code.split('.')
  const wrong = [...sec.slice(0, 5), 'f'.repeat(32)].join('.')
  m3.servers.join(wrong); connect(host.node, m3)
  await sleep(500)
  assert.strictEqual(m3.servers.get(psid).hasKey, false, 'entró a la lista pero no recibe clave')
  assert.throws(() => m3.servers.send(psid, pgen, 'hola'), /Aún no tienes la clave/)
  // v1 en un servidor cifrado: rechazado
  const m4 = await makeNode('miembro4'); const w4 = watch(m4)
  m4.servers.join(`psrv1.${host.node.code}.${psid}.${sec[3]}`); connect(host.node, m4)
  await sleep(400)
  assert.match(last(w4), /cifrado/)

  // ---- Renovación de claves con el dueño desconectado ----
  owner.servers.admin(psid, 'role', { key: m1.code, role: 'admin' })
  await sleep(200)
  ;[...owner.peers.values()].forEach((p) => p.conn.destroy())
  await sleep(150)
  m1.servers.admin(psid, 'kick', { key: m2.code }) // un admin expulsa mientras el dueño no está
  await sleep(250)
  assert.strictEqual(S0.needsRotation, true, 'el anfitrión avisa que falta renovar la clave')
  assert.strictEqual(m1.servers.get(psid).needsRotation, true)
  const staleKeys = { ...m2.servers.all[psid]?.keys }
  connect(host.node, owner) // el dueño vuelve
  await sleep(600)
  assert.strictEqual(owner.servers.all[psid].epoch, 2, 'el dueño renovó la clave al ver que alguien salió')
  assert.strictEqual(S0.needsRotation, false)
  assert.ok(m1.servers.all[psid].keys[2], 'los miembros restantes recibieron la época 2')
  m1.servers.send(psid, pgen, 'mensaje de la época 2')
  await sleep(200)
  const env2 = S0.relay[pgen].find((e) => e.ep === 2)
  assert.ok(env2, 'los mensajes nuevos usan la clave nueva')
  assert.throws(() => e2.decryptGroup(Buffer.from(keyM2, 'base64'), env2, e2.msgAad(psid, pgen, env2)), 'quien fue expulsado no puede leer lo nuevo')
  assert.ok(!staleKeys[2])

  // ---- Datos mal formados hacia el anfitrión ----
  const toHost = m1.peers.get(host.node.code).conn
  const k1 = m1.servers.all[psid].keys[2]
  const relayLen = () => S0.relay[pgen].length
  const n0 = relayLen()
  for (const badEnv of [
    null, 5, {}, { ...craft(m1, psid, pgen, k1, 'a', { ep: 2 }), from: m3.code },        // autor distinto
    craft(m1, psid, pgen, k1, 'a', { ep: 2, ts: Date.now() - 3600 * 1000 }),            // hora fuera de rango
    { ...craft(m1, psid, pgen, k1, 'a', { ep: 2 }), sig: Buffer.alloc(64).toString('base64') }, // firma falsa
    { ...craft(m1, psid, pgen, k1, 'a', { ep: 2 }), c: 'A'.repeat(13000) },
    { ...craft(m1, psid, pgen, k1, 'a', { ep: 2 }), id: '../x' }
  ]) sendRaw(toHost, { t: 'srv-send', sid: psid, cid: pgen, e: badEnv })
  sendRaw(toHost, { t: 'srv-send', sid: psid, cid: 'zz', e: craft(m1, psid, pgen, k1, 'a', { ep: 2 }) })
  sendRaw(toHost, { t: 'srv-send', sid: psid, cid: pgen, text: 'texto plano a un servidor cifrado' })
  // alguien que no es el dueño intenta repartir claves
  const sealedSelf = e2.seal(x1.pub, Buffer.alloc(32, 1), e2.keyAad(psid, 5, m1.code))
  const selfBox = { to: m1.code, ep: 5, ...sealedSelf }
  selfBox.sig = m1.signer.sign(e2.keySigData(psid, selfBox))
  sendRaw(toHost, { t: 'srv-keys', sid: psid, boxes: [selfBox] })
  await sleep(300)
  assert.strictEqual(relayLen(), n0, 'ningún sobre inválido se guardó')
  assert.ok(!S0.keyBox[m1.code][5], 'solo el dueño reparte claves')
  assert.ok(Object.keys(S0.keyBox[m1.code]).every((e) => Number(e) <= 2))

  // Un mensaje de otro canal o servidor no sirve: el contexto va autenticado
  const moved = { ...onWire }
  assert.throws(() => e2.decryptGroup(Buffer.from(keyM2, 'base64'), moved, e2.msgAad(psid, 'cccccccc', moved)), 'un sobre no se puede cambiar de canal')

  // Sin conexión con el anfitrión no se puede enviar; el error es claro
  ;[...m1.peers.values()].forEach((p) => p.conn.destroy())
  await sleep(100)
  assert.throws(() => m1.servers.send(psid, pgen, 'x'), /desconectado/)

  // El anfitrión reinicia: conserva solo sobres
  host.vault.saveNow()
  await host.node.stop()
  const host2 = createHost({ dataDir: dir, name: 'pi' })
  assert.ok(host2.vault.data.servers[psid].relay[pgen].length >= 2)
  assert.ok(!JSON.stringify(host2.vault.data).includes('mensaje de la época 2'))
  assert.ok(!fs.readFileSync(path.join(dir, 'vault.json'), 'utf8').includes('envelope'))

  // ================= C. Servidores antiguos (sin cifrado) siguen funcionando =================
  const legacy = ana.servers.create('Antiguo', null, { e2ee: false })
  assert.strictEqual(legacy.e2ee, false)
  assert.match(ana.servers.admin(legacy.id, 'invite', {}).code, /^psrv1\./)

  // Búsqueda: los mensajes descifrados se pueden buscar en tu equipo
  const { searchAll } = require('../src/search')
  assert.strictEqual(searchAll(beto.vault.data, 'bienvenidos').length, 1)

  await host2.node.stop()
  await finish('e2ee-servers.js: todo bien')
})().catch((err) => { console.error(err); process.exit(1) })
