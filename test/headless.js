'use strict'
// Anfitrión sin pantalla (Raspberry Pi): sirve un servidor cuyo dueño es otra persona, y sobrevive a reinicios.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { makeNode, connect, sleep, finish } = require('./helpers') // instala la red falsa
const { createHost } = require('../headless/host')

;(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-host-'))
  let host = createHost({ dataDir, name: 'pi' })
  await host.node.start()
  const hostCode = host.node.code

  const owner = await makeNode('dueño')
  const beto = await makeNode('beto')
  const carlos = await makeNode('carlos')

  // El dueño es otra persona: el anfitrión no es miembro
  const view = host.node.servers.create('Comunidad', owner.code, { e2ee: false })
  const sid = view.id
  assert.strictEqual(Object.keys(host.vault.data.servers[sid].members).length, 1)
  assert.strictEqual(host.vault.data.servers[sid].members[owner.code].role, 'owner')
  const other = host.node.servers.create('Otra', 'no-es-una-clave', { e2ee: false }) // clave inválida: el dueño pasa a ser el propio anfitrión
  assert.strictEqual(host.vault.data.servers[other.id].members[hostCode].role, 'owner')
  assert.strictEqual(fs.statSync(path.join(dataDir, 'host.key')).mode & 0o077, 0, 'la clave solo la lee su usuario')

  // El dueño entra con el código que imprime "create" (token cualquiera: ya es miembro)
  owner.servers.join(`psrv1.${hostCode}.${sid}.${'0'.repeat(16)}`)
  connect(host.node, owner)
  await sleep(250)
  assert.strictEqual(owner.servers.get(sid).myRole, 'owner')

  // Administra desde su app: invitación remota y canal
  owner.servers.admin(sid, 'invite', { hours: 1, max: 5 })
  let code = null
  owner.on('server-invite', (i) => { code = i.code })
  owner.servers.admin(sid, 'invite', { hours: 1, max: 5 })
  await sleep(150)
  assert.ok(code, 'el anfitrión devuelve la invitación')
  owner.servers.admin(sid, 'channel-add', { name: 'charla' })
  await sleep(150)
  assert.strictEqual(owner.servers.get(sid).channels.length, 2)

  // Los miembros se unen y hablan mientras el DUEÑO está desconectado: el anfitrión 24/7 sigue sirviendo
  beto.servers.join(code); connect(host.node, beto)
  carlos.servers.join(code); connect(host.node, carlos)
  await sleep(300)
  const gen = beto.servers.get(sid).channels[0].id
  const ownerLink = [...owner.peers.values()][0]
  ownerLink.conn.destroy()
  await sleep(100)
  beto.servers.send(sid, gen, 'estamos sin el dueño')
  await sleep(150)
  assert.ok(carlos.servers.messages(sid, gen).some((m) => m.text === 'estamos sin el dueño'))
  assert.strictEqual(host.vault.data.servers[sid].msgs[gen].length, 1)

  // Un extraño que quiere chatear con el anfitrión no genera solicitudes ni ocupa espacio
  const stranger = await makeNode('extraño')
  const [ls] = connect(host.node, stranger)
  await sleep(150)
  assert.strictEqual(host.vault.data.requests.length, 0)
  assert.ok(ls.destroyed, 'el anfitrión no atiende chats')

  // El dueño no puede ser reemplazado: un miembro no puede administrar
  beto.servers.admin(sid, 'close')
  await sleep(100)
  assert.ok(host.vault.data.servers[sid], 'solo el dueño elimina el servidor')

  // Reinicio del anfitrión: misma identidad, mismos servidores, mismos mensajes
  host.vault.saveNow()
  await host.node.stop()
  host = createHost({ dataDir, name: 'pi' })
  assert.strictEqual(host.node.code, hostCode, 'conserva su identidad')
  assert.strictEqual(Object.keys(host.vault.data.servers).length, 2)
  assert.strictEqual(host.vault.data.servers[sid].msgs[gen][0].text, 'estamos sin el dueño')
  await host.node.start()
  connect(host.node, beto) // vuelve a conectar y recupera el estado
  await sleep(300)
  assert.strictEqual(beto.servers.get(sid).hostOnline, true)

  // Los datos del anfitrión están cifrados en disco
  assert.ok(!fs.readFileSync(path.join(dataDir, 'vault.json'), 'utf8').includes('estamos sin el dueño'))

  // La clave también puede venir de fuera (sin guardarla junto a los datos)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-host-'))
  const h2 = createHost({ dataDir: dir2, hostKey: 'ab'.repeat(32) })
  h2.vault.saveNow()
  assert.ok(!fs.existsSync(path.join(dir2, 'host.key')), 'con clave externa no se crea host.key')
  assert.throws(() => createHost({ dataDir: dir2, hostKey: 'corta' }), /64 caracteres/)

  await host.node.stop()
  await finish('headless.js: todo bien')
})().catch((err) => { console.error(err); process.exit(1) })
