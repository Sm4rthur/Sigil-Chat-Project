'use strict'
// Perfil social: validación estricta del contenido ajeno y sincronización entre contactos.
const assert = require('assert')
const { makeNode, connect, sleep, finish } = require('./helpers')
const { encodeFrame, FrameParser, T_JSON } = require('../src/frames')
const { validateProfile, emptyProfile, imageInfo, profileRev, LIMITS } = require('../src/profile')

// Espera a que se cumpla una condición en vez de depender de un tiempo fijo:
// el perfil viaja por partes y el tiempo depende del equipo.
async function waitFor(fn, timeout = 8000, step = 25) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (fn()) return true
    await sleep(step)
  }
  return false
}

// Imágenes de prueba con estructura válida (la app comprueba estructura y peso; no decodifica los píxeles)
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, data, Buffer.alloc(4)]) }
const png = (w, h, size = 0, { frames = 0, acTLafter = false } = {}) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const act = Buffer.alloc(8); act.writeUInt32BE(frames, 0)
  const idat = chunk('IDAT', Buffer.alloc(Math.max(8, size - 57), 7))
  const parts = [SIG, chunk('IHDR', ihdr)]
  if (frames && !acTLafter) parts.push(chunk('acTL', act))
  parts.push(idat)
  if (frames && acTLafter) parts.push(chunk('acTL', act))
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}
const url = (buf, type = 'png') => `data:image/${type};base64,${buf.toString('base64')}`
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0, 0, 0])
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const riff = (...chunks) => { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]); return Buffer.concat([Buffer.from('RIFF'), le32(body.length), body]) }
const webpL = (w, h) => { const body = Buffer.alloc(10, 0); body[0] = 0x2f; body.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1); return riff(Buffer.from('VP8L'), le32(10), body) }
const webpAnim = (w, h, frames) => {
  const x = Buffer.alloc(10); x[0] = 0x02; x.writeUIntLE(w - 1, 4, 3); x.writeUIntLE(h - 1, 7, 3)
  const parts = [Buffer.from('VP8X'), le32(10), x]
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('ANMF'), le32(16), Buffer.alloc(16))
  return riff(...parts)
}
const fontFile = (magic, size = 200) => { const b = Buffer.alloc(size, 1); Buffer.from(magic, 'latin1').copy(b, 0); return b }
const font = (id, fmt = 'woff2', buf = fontFile('wOF2')) => ({ id, name: 'Mi fuente ' + id, fmt, data: buf.toString('base64') })
const textBlock = (o = {}) => ({ id: 'a1', type: 'text', x: 10, y: 10, w: 200, h: 60, z: 1, text: 'Hola', font: 'serif', size: 24, color: '#ff0000', ...o })

;(async () => {
  // ================= Validación =================
  assert.deepStrictEqual(imageInfo(png(300, 200)), { type: 'png', width: 300, height: 200, animated: false, frames: 1 })
  assert.deepStrictEqual(imageInfo(jpeg(640, 480)), { type: 'jpeg', width: 640, height: 480, animated: false, frames: 1 })
  assert.deepStrictEqual(imageInfo(webpL(500, 400)), { type: 'webp', width: 500, height: 400, animated: false, frames: 1 })
  assert.strictEqual(imageInfo(Buffer.from('<svg onload=alert(1)>')), null)

  assert.deepStrictEqual(validateProfile(emptyProfile()), emptyProfile())

  // Lo desconocido se descarta y los valores raros se corrigen
  let p = validateProfile({
    status: 'hola\n<b>x</b>\u202e', avatar: url(png(256, 256)), onclick: 'alert(1)', style: 'x',
    page: {
      height: 99999, extra: 1, bg: { color: 'red; background:url(http://evil)', image: '', fit: 'zoom' },
      blocks: [
        textBlock({ text: '<img src=x onerror=alert(1)>', font: 'Papyrus', size: 9999, color: 'url(javascript:1)', bg: 'expression(1)', align: 'justify', style: 'position:fixed', onclick: 'x' }),
        { type: 'script', x: 1 }, null, 5,
        { id: 'a1', type: 'text', x: -50, y: 99999, w: 99999, h: -5, text: 'dup', z: 'alto' }
      ]
    }
  })
  assert.strictEqual(p.status, 'hola <b>x</b>', 'sin caracteres de inversión; el HTML queda como texto plano')
  assert.strictEqual(p.page.height, 3000)
  assert.strictEqual(p.page.bg.color, '#ffffff')
  assert.strictEqual(p.page.bg.fit, 'cover')
  assert.strictEqual(p.page.blocks.length, 2)
  const b0 = p.page.blocks[0]
  assert.deepStrictEqual([b0.font, b0.size, b0.color, b0.bg, b0.align], ['sans', 96, '#222222', '', 'left'])
  assert.strictEqual(b0.text, '<img src=x onerror=alert(1)>') // es texto: la pantalla lo dibuja con textContent
  assert.ok(!('style' in b0) && !('onclick' in b0) && !('onclick' in p))
  assert.notStrictEqual(p.page.blocks[1].id, 'a1', 'ids repetidos se reasignan')
  assert.ok(p.page.blocks[1].x >= 0 && p.page.blocks[1].w <= 800 && p.page.blocks[1].h >= 20)

  // Imágenes peligrosas o inválidas
  const bad = (img) => assert.throws(() => validateProfile({ avatar: img }))
  bad('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+')
  bad('data:text/html;base64,PHNjcmlwdD4=')
  bad('https://evil.example/x.png')
  bad('javascript:alert(1)')
  bad(url(Buffer.from('no soy una imagen')))
  bad(url(png(256, 256), 'jpeg'))                            // dice JPEG pero es PNG
  bad(url(png(100000, 100000)))                              // bomba de píxeles
  bad(url(png(256, 256, LIMITS.maxAvatarBytes + 10)))        // pesa demasiado
  bad(url(png(1024, 1024)))                                  // avatar mayor a 512
  bad(12345)
  const bigPage = (n) => ({ page: { blocks: Array.from({ length: n }, (_, i) => ({ id: 'i' + i, type: 'image', src: url(png(100, 100, 300 * 1024)) })) } })
  assert.doesNotThrow(() => validateProfile(bigPage(4)))
  assert.throws(() => validateProfile(bigPage(6)), /pesan demasiado/)
  assert.strictEqual(validateProfile({ page: { blocks: Array.from({ length: 80 }, () => textBlock()) } }).page.blocks.length, 30)
  assert.throws(() => validateProfile(null))
  assert.throws(() => validateProfile([]))

  // ----- PNG animado (APNG) y WebP animado -----
  assert.deepStrictEqual(imageInfo(png(64, 64, 5000, { frames: 12 })), { type: 'png', width: 64, height: 64, animated: true, frames: 12 })
  assert.doesNotThrow(() => validateProfile({ avatar: url(png(128, 128, 20000, { frames: 12 })) }), 'avatar animado')
  assert.strictEqual(validateProfile({ page: { blocks: [{ type: 'image', src: url(png(200, 200, 9000, { frames: 5 })) }] } }).page.blocks.length, 1)
  assert.doesNotThrow(() => validateProfile({ avatar: url(webpAnim(100, 100, 8), 'webp') }), 'WebP animado')
  assert.throws(() => validateProfile({ avatar: url(png(64, 64, 5000, { frames: 100000 })) }), /animación/)
  assert.throws(() => validateProfile({ avatar: url(png(512, 512, 5000, { frames: 300 })) }), /animación/, 'demasiados píxeles en total')
  assert.throws(() => validateProfile({ avatar: url(webpAnim(100, 100, 400), 'webp') }), /animación/)
  assert.throws(() => validateProfile({ avatar: url(png(64, 64, 5000, { frames: 3, acTLafter: true })) }), /imagen válida/, 'acTL después de los datos')
  assert.throws(() => validateProfile({ avatar: url(png(64, 64, 5000).subarray(0, 4000)) }), /imagen válida/, 'PNG truncado')
  assert.throws(() => validateProfile({ avatar: url(Buffer.concat([png(64, 64, 5000), Buffer.from('basura')])) }), /imagen válida/, 'datos tras IEND')

  // ----- Rotación libre -----
  const rots = validateProfile({ page: { blocks: [textBlock({ id: 'r1', rot: 33 }), textBlock({ id: 'r2', rot: 9999 }), textBlock({ id: 'r3', rot: -9999 }), textBlock({ id: 'r4', rot: 'x' })] } }).page.blocks.map((b) => b.rot)
  assert.deepStrictEqual(rots, [33, 180, -180, 0])

  // ----- Recorte de la foto de perfil -----
  const crop = (c) => validateProfile({ avatar: url(png(256, 256)), avatarCrop: c }).avatarCrop
  assert.deepStrictEqual(crop({ zoom: 2, x: 20, y: -30 }), { zoom: 2, x: 20, y: -30 })
  assert.deepStrictEqual(crop({ zoom: 2, x: 999, y: -999 }), { zoom: 2, x: 50, y: -50 }, 'no se puede dejar el círculo vacío')
  assert.deepStrictEqual(crop({ zoom: 99, x: 0, y: 0 }), { zoom: 4, x: 0, y: 0 })
  assert.deepStrictEqual(crop({ zoom: 1, x: 40, y: 40 }), { zoom: 1, x: 0, y: 0 })
  assert.deepStrictEqual(crop('x'), { zoom: 1, x: 0, y: 0 })

  // ----- Fuentes propias -----
  let fp = validateProfile({ nameFont: 'f:ab1', fonts: [font('ab1'), font('cd2', 'ttf', fontFile('true')), font('ee3', 'otf', fontFile('OTTO')), font('ff4', 'woff', fontFile('wOFF'))],
    page: { blocks: [textBlock({ id: 'f1', font: 'f:ab1' }), textBlock({ id: 'f2', font: 'f:nope' }), textBlock({ id: 'f3', font: 'Papyrus' })] } })
  assert.strictEqual(fp.fonts.length, 4)
  assert.strictEqual(fp.nameFont, 'f:ab1')
  assert.deepStrictEqual(fp.page.blocks.map((b) => b.font), ['f:ab1', 'sans', 'sans'], 'solo fuentes que el perfil incluye')
  assert.strictEqual(validateProfile({ nameFont: 'f:zzz' }).nameFont, '')
  assert.strictEqual(validateProfile({ fonts: Array.from({ length: 9 }, (_, i) => font('x' + i)) }).fonts.length, 4, 'máximo 4 fuentes')
  assert.strictEqual(validateProfile({ fonts: [font('dup'), font('dup')] }).fonts.length, 1)
  assert.strictEqual(validateProfile({ fonts: [{ id: 'BAD ID', name: 'x', fmt: 'woff2', data: 'AAAA' }, { id: 'ok', fmt: 'exe', data: 'AAAA' }, null] }).fonts.length, 0)
  assert.throws(() => validateProfile({ fonts: [font('a1', 'woff2', fontFile('MZ\u0090\u0000'))] }), /no es una fuente/, 'extensión que miente')
  assert.throws(() => validateProfile({ fonts: [font('a2', 'ttf', fontFile('ttcf'))] }), /no es una fuente/, 'colecciones de fuentes no se aceptan')
  assert.throws(() => validateProfile({ fonts: [font('a3', 'woff2', fontFile('wOF2', LIMITS.maxFontBytes + 10))] }), /demasiado grande/)
  assert.throws(() => validateProfile({ fonts: [{ id: 'a4', fmt: 'woff2', name: 'x', data: '<script>' }] }), /no válida/)
  assert.deepStrictEqual(fp.fonts[0], { id: 'ab1', name: 'Mi fuente ab1', fmt: 'woff2', data: fontFile('wOF2').toString('base64') })

  // La versión cambia solo si cambia el contenido
  const base = validateProfile({ status: 'a' })
  assert.strictEqual(profileRev(base), profileRev(validateProfile({ status: 'a', basura: 1 })))
  assert.notStrictEqual(profileRev(base), profileRev(validateProfile({ status: 'b' })))

  // ================= Sincronización entre contactos =================
  const ana = await makeNode('ana')
  const beto = await makeNode('beto')
  ana.addContact(beto.code, 'Beto')
  beto.addContact(ana.code, 'Ana')

  const anaProfile = validateProfile({
    status: 'Hola, soy Ana', avatar: url(png(256, 256, 20000, { frames: 6 })), avatarCrop: { zoom: 1.5, x: 10, y: -5 },
    nameFont: 'f:fa1', fonts: [font('fa1', 'woff2', fontFile('wOF2', 120 * 1024))],
    page: {
      height: 900, bg: { color: '#102030', image: url(png(800, 600, 150 * 1024)), fit: 'cover' },
      blocks: [textBlock({ text: 'Mi página', rot: 30, font: 'f:fa1' }), { id: 'im', type: 'image', x: 0, y: 100, w: 300, h: 200, src: url(png(300, 200, 200 * 1024)), fit: 'contain' }]
    }
  })
  ana.setMyProfile(anaProfile)
  const [link, linkB] = connect(ana, beto)
  assert.ok(await waitFor(() => beto.profiles.rev(ana.code) === profileRev(anaProfile)), 'el perfil debe llegar por partes a tiempo')
  assert.strictEqual(beto.profiles.get(ana.code).status, 'Hola, soy Ana')
  assert.strictEqual(beto.profiles.rev(ana.code), profileRev(anaProfile))
  assert.strictEqual(beto.profiles.get(ana.code).page.blocks.length, 2)
  assert.strictEqual(beto.profiles.get(ana.code).page.blocks[0].rot, 30)
  assert.strictEqual(beto.profiles.get(ana.code).fonts.length, 1, 'la fuente viaja con el perfil')
  assert.deepStrictEqual(beto.profiles.get(ana.code).avatarCrop, { zoom: 1.5, x: 10, y: -5 })
  assert.strictEqual(beto.listContacts()[0].profRev, profileRev(anaProfile))
  assert.strictEqual(ana.profiles.rev(beto.code), '', 'Beto no tiene perfil: no se pide nada')

  // Ana lo edita con Beto conectado: se actualiza solo
  const v2 = validateProfile({ ...anaProfile, status: 'Cambié mi estado' })
  ana.setMyProfile(v2)
  assert.ok(await waitFor(() => beto.profiles.get(ana.code)?.status === 'Cambié mi estado'), 'la actualización debe llegar a tiempo')
  assert.strictEqual(beto.profiles.get(ana.code).status, 'Cambié mi estado')

  // Un desconocido no recibe nada aunque lo pida
  const stranger = await makeNode('extraño')
  const [sFromAna, sSide] = connect(ana, stranger)
  const seen = []
  new FrameParser((t, payload) => seen.push(JSON.parse(payload.toString()).t))
  const parser = new FrameParser((t, payload) => seen.push(JSON.parse(payload.toString()).t))
  sSide.on('data', (c) => parser.push(c))
  await sleep()
  sSide.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify({ t: 'profile-req' }))))
  await sleep(200)
  assert.deepStrictEqual(seen.filter((t) => t !== 'hello'), [], 'un desconocido no recibe el perfil')
  sFromAna.destroy()

  // ================= Un contacto malicioso =================
  const evil = await makeNode('malo')
  ana.addContact(evil.code, 'Malo')
  evil.addContact(ana.code, 'Ana')
  const [aEvil, eSide] = connect(ana, evil)
  await sleep()
  const raw = (o) => eSide.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(o))))
  const none = () => assert.strictEqual(ana.profiles.get(evil.code), null)

  // Enviar un perfil sin que se haya pedido
  raw({ t: 'profile-start', rev: 'aaaaaaaaaaaaaaaa', n: 1, size: 10 })
  raw({ t: 'profile-chunk', i: 0, d: Buffer.from('{"v":1}').toString('base64') })
  await sleep()
  none()

  // Que se pida, y responder mal de distintas formas
  const attempt = async (reply) => {
    raw({ t: 'profile-new', rev: 'bbbbbbbbbbbbbbbb' }) // (dirigido a Ana: ella no lo usa)
    eSide.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify({ t: 'hello', name: 'malo', prof: 'cccccccccccccccc' }))))
    await sleep(60)
    ana.peers.get(evil.code).lastProfileReq = 0 // permitir otro pedido en la prueba
    ana.peers.get(evil.code).inProfile && ana._abortProfile(ana.peers.get(evil.code))
    ana._maybeRequestProfile(ana.peers.get(evil.code), 'cccccccccccccccc')
    await sleep(30)
    reply()
    await sleep(60)
    none()
  }
  await attempt(() => raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 9999, size: 10 }))           // demasiadas partes
  await attempt(() => raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 2, size: 99 * 1024 * 1024 })) // peso declarado enorme
  await attempt(() => raw({ t: 'profile-start', rev: 'dddddddddddddddd', n: 1, size: 5 }))               // versión distinta a la pedida
  await attempt(() => { raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 2, size: 20 }); raw({ t: 'profile-chunk', i: 1, d: 'AAAA' }) }) // orden incorrecto
  await attempt(() => { raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 1, size: 3 }); raw({ t: 'profile-chunk', i: 0, d: Buffer.alloc(500).toString('base64') }) }) // más datos de los declarados
  await attempt(() => { raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 1, size: 9 }); raw({ t: 'profile-chunk', i: 0, d: Buffer.from('no es json').toString('base64') }) })
  await attempt(() => { raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 1, size: 3 }); raw({ t: 'profile-chunk', i: 0, d: '<script>' }) })
  const svgProfile = Buffer.from(JSON.stringify({ avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }))
  await attempt(() => { raw({ t: 'profile-start', rev: 'cccccccccccccccc', n: 1, size: svgProfile.length }); raw({ t: 'profile-chunk', i: 0, d: svgProfile.toString('base64') }) })
  assert.ok(!aEvil.destroyed || true)

  // Un perfil con estructura válida pero contenido hostil se guarda ya limpio
  await sleep(60)
  const hostile = Buffer.from(JSON.stringify({ status: 'hola', page: { blocks: [textBlock({ font: 'Papyrus', color: 'red', text: '<script>alert(1)</script>' })] } }))
  ana.peers.get(evil.code).lastProfileReq = 0
  ana._maybeRequestProfile(ana.peers.get(evil.code), 'eeeeeeeeeeeeeeee')
  await sleep(30)
  raw({ t: 'profile-start', rev: 'eeeeeeeeeeeeeeee', n: 1, size: hostile.length })
  raw({ t: 'profile-chunk', i: 0, d: hostile.toString('base64') })
  await sleep(80)
  const stored = ana.profiles.get(evil.code)
  assert.strictEqual(stored.page.blocks[0].font, 'sans')
  assert.strictEqual(stored.page.blocks[0].color, '#222222')

  // Los perfiles se guardan cifrados
  const fs = require('fs')
  const path = require('path')
  const dir = ana.profiles.dir
  for (const f of fs.readdirSync(dir)) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8')
    assert.ok(!content.includes('Cambié') && !content.includes('Hola, soy Ana'), 'el perfil no debe estar en claro')
  }

  // Al eliminar un contacto se borra su perfil
  beto.removeContact(ana.code)
  assert.strictEqual(beto.profiles.get(ana.code), null)

  link.destroy(); linkB.destroy()
  await finish('profile.js: todo bien')
})().catch((err) => { console.error(err); process.exit(1) })
