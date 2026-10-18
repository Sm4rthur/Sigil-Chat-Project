'use strict'
// Compartir archivos: ofertas, descarga aceptada, límites, integridad, ataques y vista previa segura.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { makeNode, connect, sleep, finish } = require('./helpers')
const { encodeFrame, T_JSON, T_FILE } = require('../src/frames')
const { FILES, sanitizeName, isDangerous, mimeFor, previewOf } = require('../src/files')

// PNG de prueba con estructura válida
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, data, Buffer.alloc(4)]) }
const png = (w, h, size) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(Math.max(8, size - 57), 9)), chunk('IEND', Buffer.alloc(0))])
}

;(async () => {
  // ================= Nombres, tipos y vista previa =================
  assert.strictEqual(sanitizeName('C:\\Users\\ana\\fotos\\vacaciones.png'), 'vacaciones.png')
  assert.strictEqual(sanitizeName('../../etc/passwd'), 'passwd')
  assert.strictEqual(sanitizeName('..\\..\\Windows\\system32\\cmd.exe'), 'cmd.exe')
  assert.strictEqual(sanitizeName('CON.txt'), '_CON.txt')
  assert.strictEqual(sanitizeName('nul'), '_nul')
  assert.strictEqual(sanitizeName('foto\u202egpj.exe'), 'foto_gpj.exe', 'sin caracteres de inversión que disfracen la extensión')
  assert.strictEqual(sanitizeName('   ...  '), 'archivo')
  assert.strictEqual(sanitizeName(null), 'archivo')
  assert.ok(sanitizeName('x'.repeat(300) + '.pdf').length <= 120)
  for (const bad of ['setup.exe', 'script.PS1', 'a.bat', 'macro.docm', 'foto.jpg.exe', 'lector.pdf.scr', 'x.js', 'acceso.lnk', 'app.msi']) assert.ok(isDangerous(bad), bad)
  for (const ok of ['foto.png', 'informe.pdf', 'notas.txt', 'cancion.mp3', 'sin-extension']) assert.ok(!isDangerous(ok), ok)
  assert.strictEqual(mimeFor('a.PNG'), 'image/png')
  assert.strictEqual(mimeFor('a.desconocido'), 'application/octet-stream')

  assert.strictEqual(previewOf('a.png', png(300, 200, 5000)).kind, 'image')
  assert.strictEqual(previewOf('a.png', Buffer.from('<svg onload=alert(1)></svg>')).kind, 'none', 'un SVG disfrazado de .png no se muestra')
  assert.strictEqual(previewOf('a.png', png(100000, 100000, 5000)).kind, 'none', 'bomba de píxeles')
  assert.strictEqual(previewOf('a.jpg', png(300, 200, 5000)).kind, 'none', 'dice JPG pero es PNG')
  assert.strictEqual(previewOf('a.svg', Buffer.from('<svg/>')).kind, 'none')
  assert.strictEqual(previewOf('a.pdf', Buffer.from('%PDF-1.4')).kind, 'none')
  assert.strictEqual(previewOf('a.exe', Buffer.from('MZ')).kind, 'none')
  const t = previewOf('a.txt', Buffer.from('hola\u202e\u0000 mundo\n' + 'x'.repeat(5000)))
  assert.strictEqual(t.kind, 'text')
  assert.ok(t.truncated && !/[\u202e\u0000]/.test(t.text))

  // ================= Transferencia =================
  const ana = await makeNode('ana')
  const beto = await makeNode('beto')
  ana.addContact(beto.code, 'Beto'); beto.addContact(ana.code, 'Ana')
  const [la, lb] = connect(ana, beto)
  await sleep()
  const raw = (stream, o) => stream.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(o))))
  const offered = () => beto.getChat(ana.code).filter((m) => m.kind === 'file')
  const bytes = png(800, 600, 200 * 1024)
  const sha = require('crypto').createHash('sha256').update(bytes).digest('hex')

  const sent = ana.offerFile(beto.code, 'C:\\fotos\\vacaciones.png', bytes)
  await sleep(100)
  assert.strictEqual(sent.file.name, 'vacaciones.png')
  assert.strictEqual(ana.getChat(beto.code).find((m) => m.id === sent.id).status, 'delivered')
  assert.deepStrictEqual([offered().length, offered()[0].file.state, offered()[0].file.sha, offered()[0].file.size], [1, 'offered', sha, bytes.length])
  assert.throws(() => beto.getFile(ana.code, sent.id), /no está disponible/, 'sin aceptar no hay archivo')
  assert.ok(!beto.fileStore.has(sha), 'nada se descarga sin aceptar')

  beto.downloadFile(ana.code, sent.id)
  assert.strictEqual(offered()[0].file.state, 'downloading')
  await sleep(500)
  assert.strictEqual(offered()[0].file.state, 'ready')
  assert.ok(beto.getFile(ana.code, sent.id).bytes.equals(bytes), 'llegó idéntico')
  assert.ok(ana.getFile(beto.code, sent.id).bytes.equals(bytes), 'el remitente conserva el suyo')
  assert.strictEqual(previewOf(offered()[0].file.name, bytes).kind, 'image')
  const blob = fs.readFileSync(path.join(beto.fileStore.dir, sha + '.bin'))
  assert.ok(!blob.includes(Buffer.from('\u0009\u0009\u0009\u0009\u0009\u0009\u0009\u0009')), 'se guarda cifrado')

  // ================= Límites del emisor =================
  assert.throws(() => ana.offerFile(beto.code, 'grande.bin', Buffer.alloc(FILES.maxBytes + 1)), /máximo/)
  assert.throws(() => ana.offerFile(beto.code, 'vacio.txt', Buffer.alloc(0)), /vacío/)
  assert.throws(() => ana.offerFile('f'.repeat(64), 'x.txt', Buffer.from('x')), /desconocido/)

  // ================= Ofertas hostiles hacia Beto =================
  const before = beto.getChat(ana.code).length
  const good = { t: 'file-offer', id: 'a'.repeat(16), name: 'ok.txt', size: 10, mime: 'text/plain', sha: 'b'.repeat(64) }
  for (const bad of [
    { ...good, size: FILES.maxBytes + 1 }, { ...good, size: 0 }, { ...good, size: 1.5 }, { ...good, size: '10' },
    { ...good, id: 'zz' }, { ...good, id: 5 }, { ...good, sha: 'corto' }, { ...good, name: { a: 1 } }
  ]) raw(la, bad)
  await sleep(100)
  assert.strictEqual(beto.getChat(ana.code).length, before, 'ofertas inválidas se ignoran')
  raw(la, { ...good, name: '..\\..\\Windows\\cmd.exe', mime: '<script>' })
  await sleep(100)
  const hostile = offered().at(-1).file
  assert.deepStrictEqual([hostile.name, hostile.mime], ['cmd.exe', 'application/octet-stream'], 'nombre y tipo se limpian')

  // Demasiadas ofertas sin responder
  for (let i = 0; i < 30; i++) raw(la, { ...good, id: i.toString(16).padStart(16, '0'), sha: i.toString(16).padStart(64, '0') })
  await sleep(200)
  assert.ok(offered().filter((m) => m.file.state === 'offered').length <= FILES.maxOffered, 'tope de ofertas pendientes')
  beto.data.chats[ana.code] = beto.data.chats[ana.code].filter((m) => !(m.kind === 'file' && m.file.state === 'offered')) // el usuario las descarta

  // ================= Datos que nadie pidió =================
  const head = Buffer.alloc(12); Buffer.from(sent.id, 'hex').copy(head, 0)
  la.write(encodeFrame(T_FILE, Buffer.concat([head, Buffer.from('datos que nadie pidió')])))
  raw(la, { t: 'file-end', id: sent.id })
  await sleep(100)
  assert.strictEqual(offered()[0].file.state, 'ready', 'datos no pedidos se ignoran')

  // ================= Descarga defectuosa: se rechaza y no se guarda =================
  const evilBytes = png(300, 200, 100 * 1024)
  const evilSha = require('crypto').createHash('sha256').update(evilBytes).digest('hex')
  const real = ana.offerFile(beto.code, 'real.png', evilBytes)
  await sleep(100)
  const entry = () => beto.getChat(ana.code).find((m) => m.id === real.id)
  entry().file.sha = 'c'.repeat(64) // la oferta que recibió Beto no coincide con el contenido que se enviará
  beto.downloadFile(ana.code, real.id)
  await sleep(400)
  assert.strictEqual(entry().file.state, 'failed', 'el contenido no coincide con lo ofrecido')
  assert.ok(!beto.fileStore.has('c'.repeat(64)))
  entry().file.sha = evilSha

  // El emisor ya no tiene el archivo
  const savedHandler = ana._onFileReq
  ana._onFileReq = () => {} // Ana deja de responder para inyectar paquetes como si fuera ella
  const inject = async (steps) => {
    entry().file.state = 'failed'
    beto.downloadFile(ana.code, real.id)
    await sleep(30)
    for (const s of steps) s()
    await sleep(60)
  }
  const chunkFrame = (id, index, data) => { const h = Buffer.alloc(12); Buffer.from(id, 'hex').copy(h, 0); h.writeUInt32BE(index, 8); return encodeFrame(T_FILE, Buffer.concat([h, data])) }
  await inject([() => la.write(chunkFrame('1'.repeat(16), 0, Buffer.from('x')))])           // id equivocado
  assert.strictEqual(entry().file.state, 'failed')
  await inject([() => la.write(chunkFrame(real.id, 5, Buffer.from('x')))])                    // número fuera de orden
  assert.strictEqual(entry().file.state, 'failed')
  await inject([() => la.write(chunkFrame(real.id, 0, Buffer.alloc(FILES.chunk, 1))), () => la.write(chunkFrame(real.id, 1, Buffer.alloc(FILES.chunk, 1))), () => la.write(chunkFrame(real.id, 2, Buffer.alloc(FILES.chunk, 1))), () => la.write(chunkFrame(real.id, 3, Buffer.alloc(FILES.chunk, 1)))]) // más de lo ofrecido
  assert.strictEqual(entry().file.state, 'failed')
  await inject([() => la.write(chunkFrame(real.id, 0, Buffer.from('poco'))), () => raw(la, { t: 'file-end', id: real.id })]) // termina antes de tiempo
  assert.strictEqual(entry().file.state, 'failed')
  await inject([() => raw(la, { t: 'file-gone', id: real.id })])
  assert.strictEqual(entry().file.state, 'failed')
  assert.ok(!beto.fileStore.has(evilSha), 'ninguna descarga defectuosa deja datos guardados')
  ana._onFileReq = savedHandler

  // Una descarga correcta tras los fallos
  entry().file.state = 'failed'
  beto.downloadFile(ana.code, real.id)
  await sleep(400)
  assert.strictEqual(entry().file.state, 'ready')

  // Pedir un archivo que no existe: el emisor avisa
  raw(lb, { t: 'file-req', id: 'e'.repeat(16) })
  await sleep(60)
  assert.ok(ana.peers.get(beto.code) && !ana.peers.get(beto.code).sendingFile, 'sin archivo no se envía nada')

  // ================= Espacio máximo =================
  const quota = FILES.maxStorage
  const big = ana.offerFile(beto.code, 'extra.png', png(100, 100, 60 * 1024))
  await sleep(100)
  FILES.maxStorage = beto.fileStore.total() + 10
  assert.throws(() => beto.downloadFile(ana.code, big.id), /espacio máximo/)
  FILES.maxStorage = quota

  // ================= Un desconocido no puede ofrecer archivos =================
  const stranger = await makeNode('extraño')
  const [, ss] = connect(beto, stranger)
  await sleep(100)
  const n0 = beto.getChat(stranger.code).length
  raw(ss, { ...good, id: 'd'.repeat(16) })
  await sleep(100)
  assert.strictEqual(beto.getChat(stranger.code).length, n0)
  assert.ok(!beto.data.chats[stranger.code])

  // ================= Sin conexión: la oferta queda pendiente y se entrega al reconectar =================
  lb.destroy()
  await sleep(100)
  const late = ana.offerFile(beto.code, 'nota.txt', Buffer.from('hola desde antes'))
  assert.strictEqual(ana.getChat(beto.code).find((m) => m.id === late.id).status, 'pending')
  connect(ana, beto)
  await sleep(250)
  assert.ok(offered().some((m) => m.id === late.id), 'la oferta llegó al reconectar')
  assert.strictEqual(ana.getChat(beto.code).find((m) => m.id === late.id).status, 'delivered')

  // ================= Al eliminar un contacto se borran sus archivos =================
  assert.ok(beto.fileStore.has(sha))
  beto.removeContact(ana.code)
  assert.ok(!beto.fileStore.has(sha), 'sin chat, no quedan archivos huérfanos')
  assert.strictEqual(beto.fileStore.total(), 0)

  await finish('files.js: todo bien')
})().catch((err) => { console.error(err); process.exit(1) })
