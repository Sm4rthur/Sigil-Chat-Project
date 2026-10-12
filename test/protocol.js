'use strict'
// Prueba la lógica de chat, solicitudes, mensajes pendientes y llamadas entre dos "computadores".
// Reemplaza la red real (Hyperswarm) por conexiones en memoria, así que no necesita internet.
const assert = require('assert')
const crypto = require('crypto')
const EventEmitter = require('events')
const { Duplex } = require('stream')
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')

// --- Red falsa ---
class FakeDHT {
  constructor(opts) { this.ephemeral = !!opts.ephemeral }
  static keyPair(seed) { return { publicKey: crypto.createHash('sha256').update(seed).digest(), secretKey: seed } }
  async destroy() {}
}
class FakeSwarm extends EventEmitter {
  constructor({ keyPair }) { super(); this.keyPair = keyPair; this.wanted = new Set() }
  async listen() {}
  joinPeer(pk) { this.wanted.add(pk.toString('hex')) }
  leavePeer(pk) { this.wanted.delete(pk.toString('hex')) }
  async destroy() {}
}
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'hyperswarm') return FakeSwarm
  if (request === 'hyperdht') return FakeDHT
  return realLoad.call(this, request, ...rest)
}

const { P2PNode, LIMITS } = require('../src/network')
const { encodeFrame, T_JSON, T_AUDIO } = require('../src/frames')
const config = require('../src/config')
const shared = require('../src/shared')
const { Vault } = require('../src/storage')
const { randomKey } = require('../src/crypto')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-net-'))
const sleep = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const allNodes = []
async function makeNode(name) {
  const dir = path.join(tmp, name)
  const vault = new Vault(dir, randomKey())
  vault.load()
  const node = new P2PNode({ seed: Buffer.from(vault.data.identitySeed, 'base64'), name, vault, nodeMode: true })
  await node.start()
  allNodes.push(node)
  return node
}

// Conecta dos nodos como lo haría Hyperswarm
function connect(a, b) {
  const sa = new Duplex({ read() {}, write(chunk, _e, cb) { sb.push(chunk); cb() } })
  const sb = new Duplex({ read() {}, write(chunk, _e, cb) { sa.push(chunk); cb() } })
  sa.on('close', () => sb.destroy())
  sb.on('close', () => sa.destroy())
  sa.remotePublicKey = b.keyPair.publicKey
  sb.remotePublicKey = a.keyPair.publicKey
  a.swarm.emit('connection', sa, {})
  b.swarm.emit('connection', sb, {})
  return [sa, sb]
}

;(async () => {
  const ana = await makeNode('ana')
  const beto = await makeNode('beto')
  assert.match(ana.code, /^[0-9a-f]{64}$/)

  // Beto agrega el código de Ana y se conectan
  beto.addContact(ana.code, 'Ana')
  assert.ok(beto.swarm.wanted.has(ana.code), 'debe intentar conectarse al contacto')
  const [link] = connect(ana, beto)
  await sleep()

  // Ana ve una solicitud (no conoce a Beto todavía)
  assert.strictEqual(ana.data.requests.length, 1)
  assert.strictEqual(ana.data.requests[0].name, 'beto')

  // Mientras no lo acepte, sus mensajes no se guardan y quedan pendientes en Beto
  beto.sendMessage(ana.code, 'hola Ana')
  await sleep()
  assert.strictEqual(ana.getChat(beto.code).length, 0)
  assert.strictEqual(beto.getChat(ana.code)[0].status, 'pending')

  // Ana acepta -> Beto reenvía lo pendiente -> llega y se confirma
  ana.acceptRequest(beto.code)
  await sleep()
  assert.strictEqual(ana.data.requests.length, 0)
  assert.strictEqual(ana.getChat(beto.code)[0].text, 'hola Ana')
  assert.strictEqual(beto.getChat(ana.code)[0].status, 'delivered')

  // Ana responde y Beto la recibe
  ana.sendMessage(beto.code, 'hola Beto')
  await sleep()
  assert.strictEqual(beto.getChat(ana.code)[1].text, 'hola Beto')
  assert.ok(ana.listContacts()[0].online)

  // Desconexión: el mensaje queda pendiente y se entrega al reconectar
  link.destroy()
  await sleep()
  assert.ok(!ana.listContacts()[0].online)
  beto.sendMessage(ana.code, 'mensaje sin conexión')
  assert.strictEqual(beto.getChat(ana.code)[2].status, 'pending')
  connect(ana, beto)
  await sleep()
  assert.strictEqual(ana.getChat(beto.code)[2].text, 'mensaje sin conexión')
  assert.strictEqual(beto.getChat(ana.code)[2].status, 'delivered')

  // Llamada: Beto llama, Ana contesta, se envía audio, Ana cuelga
  const audioReceived = []
  ana.on('audio', (b) => audioReceived.push(b.length))
  const states = []
  beto.on('call', (c) => states.push(c.state + (c.reason ? ':' + c.reason : '')))
  beto.startCall(ana.code)
  await sleep()
  assert.strictEqual(ana.call.state, 'ringing')
  ana.acceptCall()
  await sleep()
  assert.strictEqual(beto.call.state, 'active')
  beto.sendAudio(Buffer.alloc(640))
  await sleep()
  assert.deepStrictEqual(audioReceived, [640])
  ana.sendAudio(Buffer.alloc(640)) // el audio sin llamada activa se ignora en el otro lado
  ana.endCall()
  await sleep()
  assert.strictEqual(beto.call, null)
  assert.deepStrictEqual(states, ['calling', 'active', 'idle:remote'])

  // Registro de llamadas en el chat de cada lado
  {
    const logs = (n, k) => n.getChat(k).filter((m) => m.kind === 'call')
    const b = logs(beto, ana.code)
    const a = logs(ana, beto.code)
    assert.strictEqual(b.length, 1)
    assert.strictEqual(a.length, 1)
    assert.deepStrictEqual([b[0].call.dir, b[0].call.result], ['out', 'ended'])
    assert.deepStrictEqual([a[0].call.dir, a[0].call.result], ['in', 'ended'])
    assert.ok(Number.isInteger(b[0].call.duration) && b[0].call.duration >= 0)
    assert.strictEqual(b[0].from, 'me')
    assert.strictEqual(a[0].from, 'them')
    assert.ok(!beto.getChat(ana.code).some((m) => m.kind === 'call' && m.status), 'los registros no se reenvían como mensajes pendientes')

    // Llamada rechazada: el que llama ve "declined", el que rechaza también
    await sleep(3100) // separación mínima entre invitaciones del mismo contacto
    beto.startCall(ana.code)
    await sleep()
    ana.endCall() // rechaza
    await sleep()
    assert.strictEqual(logs(beto, ana.code).at(-1).call.result, 'declined')
    assert.strictEqual(logs(ana, beto.code).at(-1).call.result, 'declined')

    // Cancelada antes de que contesten: quien llama "cancelled", quien recibe "missed"
    await sleep(3100) // separación mínima entre invitaciones
    beto.startCall(ana.code)
    await sleep()
    beto.endCall()
    await sleep()
    assert.strictEqual(logs(beto, ana.code).at(-1).call.result, 'cancelled')
    assert.strictEqual(logs(ana, beto.code).at(-1).call.result, 'missed')

    // Llamada en sentido contrario (Ana llama, Beto contesta)
    await sleep(3100)
    ana.startCall(beto.code)
    await sleep()
    beto.acceptCall()
    await sleep()
    assert.strictEqual(beto.call.state, 'active')
    beto.endCall()
    await sleep()
    assert.strictEqual(logs(ana, beto.code).at(-1).call.result, 'ended')
    assert.strictEqual(logs(ana, beto.code).at(-1).call.dir, 'out')
  }

  // Audio sin llamada activa se descarta
  beto.sendAudio(Buffer.alloc(640))
  await sleep()
  assert.deepStrictEqual(audioReceived, [640])

  // Rechazar y bloquear: el desconocido es desconectado y no vuelve a aparecer
  const carlos = await makeNode('carlos')
  const [linkC] = connect(ana, carlos)
  await sleep()
  assert.strictEqual(ana.data.requests.length, 1)
  ana.rejectRequest(carlos.code)
  await sleep()
  assert.strictEqual(ana.data.requests.length, 0)
  assert.ok(linkC.destroyed)
  connect(ana, carlos)
  await sleep()
  assert.strictEqual(ana.data.requests.length, 0)

  // Validaciones
  assert.throws(() => ana.addContact('xyz', ''), /no válido/)
  assert.throws(() => ana.addContact(ana.code, ''), /propio/)
  assert.throws(() => ana.addContact(beto.code, ''), /Ya está/)

  // ================= SEGURIDAD =================
  const raw = (obj) => encodeFrame(T_JSON, Buffer.from(JSON.stringify(obj)))
  const chatCount = () => ana.getChat(beto.code).length

  // 1) Nombres con caracteres invisibles o de inversión de texto se limpian
  const spoof = await makeNode('\u202eevil\u200b-name')
  const [sp] = connect(ana, spoof)
  await sleep()
  assert.strictEqual(ana.data.requests.find((r) => r.key === spoof.code).name, 'evil-name')
  ana.rejectRequest(spoof.code)

  // 2) Un contacto que envía un paquete JSON demasiado grande es desconectado
  let [ab, bb] = connect(ana, beto) // conexión nueva entre contactos
  await sleep()
  bb.write(encodeFrame(T_JSON, Buffer.alloc(25000, 32)))
  await sleep()
  assert.ok(ab.destroyed, 'paquete gigante: debe cortarse la conexión')

  // 3) Inundación de paquetes: se corta la conexión y no se guardan más mensajes de la cuenta
  ;[ab, bb] = connect(ana, beto)
  await sleep()
  const before = chatCount()
  for (let i = 0; i < 400; i++) bb.write(raw({ t: 'msg', id: 'flood' + i, text: 'spam' }))
  await sleep(60)
  assert.ok(ab.destroyed, 'inundación: debe cortarse la conexión')
  assert.ok(chatCount() - before <= LIMITS.jsonBurst + LIMITS.jsonPerSec, 'no debe guardar sin límite (se enviaron 400)')

  // 4) Mensajes mal formados no rompen la app
  ;[ab, bb] = connect(ana, beto)
  await sleep()
  for (const bad of [null, [], 5, { t: 5 }, { t: 'msg' }, { t: 'msg', id: '../x', text: 'hola' }, { t: 'msg', id: 'ok1', text: { a: 1 } }]) {
    bb.write(raw(bad))
  }
  bb.write(encodeFrame(T_JSON, Buffer.from('esto no es json')))
  await sleep()
  assert.ok(ab.destroyed, 'JSON inválido: debe cortarse')
  assert.strictEqual(ana.getChat(beto.code).some((m) => m.id === '../x'), false)

  // 5) Un desconocido NO puede escribirte ni llamarte
  const stranger = await makeNode('extraño')
  const [ss, sb2] = connect(ana, stranger)
  await sleep()
  const calls = []
  ana.on('call', (c) => calls.push(c.state))
  sb2.write(raw({ t: 'msg', id: 'x1', text: 'hola, soy tu banco' }))
  sb2.write(raw({ t: 'call-invite', id: 'inv1' }))
  await sleep()
  assert.strictEqual(ana.getChat(stranger.code).length, 0)
  assert.deepStrictEqual(calls, [])
  ss.destroy()
  ana.rejectRequest(stranger.code)

  // 6) Audio fuera de llamada o demasiado grande se ignora
  const heard = []
  ana.on('audio', (b) => heard.push(b.length))
  ;[ab, bb] = connect(ana, beto)
  await sleep()
  bb.write(encodeFrame(T_AUDIO, Buffer.alloc(640)))
  await sleep()
  assert.deepStrictEqual(heard, [])

  // 7) Un contacto no puede acosar con invitaciones de llamada seguidas
  const rings = []
  ana.on('call', (c) => rings.push(c.state))
  bb.write(raw({ t: 'call-invite', id: 'a1' }))
  bb.write(raw({ t: 'call-invite', id: 'a2' }))
  await sleep()
  assert.deepStrictEqual(rings, ['ringing'])
  ana.endCall()
  await sleep()

  // 8) Una conexión que no se presenta (hello) se corta
  const oldTimeout = LIMITS.helloTimeoutMs
  LIMITS.helloTimeoutMs = 80
  const silent = await makeNode('silencioso')
  silent._send = () => false // no envía hello
  const [sl] = connect(ana, silent)
  await sleep(200)
  assert.ok(sl.destroyed, 'sin presentación: debe cortarse')
  LIMITS.helloTimeoutMs = oldTimeout

  // 9) Tope de conexiones de desconocidos y de solicitudes guardadas
  ana.data.requests = []
  const links = []
  for (let i = 0; i < LIMITS.maxUnknownConnections + 3; i++) {
    const n = await makeNode('u' + i)
    links.push(connect(ana, n)[0])
  }
  await sleep()
  assert.ok(ana.data.requests.length <= LIMITS.maxUnknownConnections, 'tope de conexiones simultáneas de desconocidos')
  links.forEach((l) => l.destroy())
  await sleep()
  for (let round = 0; round < 4; round++) {
    const batch = []
    for (let i = 0; i < 8; i++) batch.push(connect(ana, await makeNode('r' + round + '-' + i))[0])
    await sleep()
    batch.forEach((l) => l.destroy())
    await sleep()
  }
  assert.ok(ana.data.requests.length <= LIMITS.maxRequests, 'tope de solicitudes guardadas')

  // 10) Modo "solo contactos": los desconocidos se rechazan de inmediato
  ana.data.requests = []
  ana.setAcceptRequests(false)
  const late = await makeNode('tardío')
  const [lt] = connect(ana, late)
  await sleep()
  assert.ok(lt.destroyed)
  assert.strictEqual(ana.data.requests.length, 0)
  assert.ok(ana._rejects(late.code))
  assert.ok(!ana._rejects(beto.code), 'los contactos siguen pudiendo conectarse')
  ana.setAcceptRequests(true)

  // 11) Certificados de usuario verificado
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  config.REGISTRY_PUBKEY = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  ana.data.requests = []
  ana.data.blocked = []
  const issue = (node, username) => shared.signCert(privateKey, { username, pub: node.code, iat: 1760000000 })

  // a) con certificado válido: se muestra el nombre REGISTRADO, aunque el nodo diga otro
  const honest = await makeNode('nombre-falso')
  honest.cert = issue(honest, 'maria-real')
  const [h1] = connect(ana, honest)
  await sleep()
  let req = ana.data.requests.find((r) => r.key === honest.code)
  assert.strictEqual(req.verified, true)
  assert.strictEqual(req.name, 'maria-real')
  h1.destroy()
  ana.acceptRequest(honest.code)
  assert.strictEqual(ana.listContacts().find((c) => c.key === honest.code).verified, true)

  // b) copiar el certificado de otra persona no sirve (va ligado a su clave)
  const thief = await makeNode('impostor')
  thief.cert = honest.cert
  const [t1] = connect(ana, thief)
  await sleep()
  req = ana.data.requests.find((r) => r.key === thief.code)
  assert.strictEqual(req.verified, false)
  assert.strictEqual(req.name, 'impostor', 'conserva su nombre, pero sin marca de verificado')
  t1.destroy()

  // c) firma de otro servidor o certificado alterado: no verificado
  const forged = await makeNode('falsificador')
  const other = crypto.generateKeyPairSync('ed25519').privateKey
  forged.cert = shared.signCert(other, { username: 'maria-real', pub: forged.code, iat: 1760000000 })
  const [f1] = connect(ana, forged)
  await sleep()
  assert.strictEqual(ana.data.requests.find((r) => r.key === forged.code).verified, false)
  f1.destroy()

  // d) sin servicio de verificación configurado nadie figura como verificado
  config.REGISTRY_PUBKEY = ''
  const [h2] = connect(ana, honest)
  await sleep()
  assert.strictEqual(ana.listContacts().find((c) => c.key === honest.code).verified, false)
  h2.destroy()

  for (const n of allNodes) await n.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('protocol.js: todo bien')
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
