'use strict'
// Prueba el registro de nombres: reclamos, duplicados, prueba de trabajo, límites y certificados.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createServer } = require('../server/app')
const shared = require('../src/shared')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-reg-'))
const DIFF = 8 // dificultad baja solo para que las pruebas sean rápidas

async function start(dir = tmp, extra = {}) {
  const app = createServer({ dataDir: dir, difficulty: DIFF, limits: { claimsPerIpDay: 1000 }, ...extra })
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r))
  app.base = 'http://127.0.0.1:' + app.server.address().port
  return app
}
const post = async (app, route, body, headers = {}) => {
  const res = await fetch(app.base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}
const pub = (n) => String(n).padStart(2, '0').repeat(32).slice(0, 64)
// Reclama un nombre resolviendo la prueba de trabajo, como lo hace la app
async function claim(app, username, p, overrides = {}) {
  const nonce = await shared.solvePow(username, p, DIFF)
  return post(app, '/v1/claim', { username, pub: p, nonce, ...overrides })
}

;(async () => {
  let app = await start()

  // --- Información y rutas ---
  assert.deepStrictEqual(await (await fetch(app.base + '/v1/info')).json(), { difficulty: DIFF })
  assert.strictEqual((await fetch(app.base + '/v1/nada')).status, 404)

  // --- Validación de la petición ---
  assert.strictEqual((await post(app, '/v1/claim', 'no es json')).status, 400)
  assert.strictEqual((await post(app, '/v1/claim', { username: 'x'.repeat(3000), pub: pub(1), nonce: '1' })).status, 413)
  const wrongType = await fetch(app.base + '/v1/claim', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
  assert.strictEqual(wrongType.status, 415)
  assert.strictEqual((await claim(app, 'ana', 'zz')).status, 400, 'código público no válido')
  assert.strictEqual((await claim(app, 'a', pub(1))).status, 400, 'nombre muy corto')
  assert.strictEqual((await claim(app, 'an\u0430x', pub(1))).status, 400, 'letras de otro alfabeto')
  assert.strictEqual((await post(app, '/v1/claim', { username: 'ana', pub: pub(1), nonce: 'zzzz' })).body.error, 'bad_pow')
  assert.strictEqual(Object.keys(app.registry.users).length, 0)

  // --- Prueba de trabajo: ligada al nombre y al código ---
  const nonce = await shared.solvePow('ana', pub(1), DIFF)
  assert.strictEqual((await post(app, '/v1/claim', { username: 'beto', pub: pub(1), nonce })).body.error, 'bad_pow', 'no se reutiliza en otro nombre')
  assert.strictEqual((await post(app, '/v1/claim', { username: 'ana', pub: pub(2), nonce })).body.error, 'bad_pow', 'ni en otro código')

  // --- Reclamo correcto ---
  let r = await claim(app, 'ana', pub(1))
  assert.strictEqual(r.status, 200)
  assert.deepStrictEqual(shared.verifyCert(r.body.cert, pub(1), app.publicHex), { username: 'ana' })
  assert.strictEqual(JSON.stringify(app.registry).includes('@'), false, 'no hay correos ni datos personales')

  // --- Nombres repetidos o parecidos ---
  for (const name of ['ana', 'ANA', 'An.a', 'an_a', 'AnA']) {
    r = await claim(app, name, pub(10 + name.length))
    assert.strictEqual(r.status, 409, 'repetido: ' + name)
    assert.strictEqual(r.body.error, 'username_taken')
  }
  assert.strictEqual((await claim(app, '1uis', pub(20))).status, 200)
  assert.strictEqual((await claim(app, 'luis', pub(21))).status, 409, 'luis ≈ 1uis')
  assert.strictEqual((await claim(app, 'iuis', pub(22))).status, 409)

  // --- Un mismo código solo puede tener un nombre; pedir el suyo de nuevo re-emite el certificado ---
  r = await claim(app, 'otro-nombre', pub(1))
  assert.strictEqual(r.status, 409)
  assert.strictEqual(r.body.error, 'key_taken')
  r = await claim(app, 'ana', pub(1))
  assert.strictEqual(r.status, 200, 'misma persona repite el reclamo (por ejemplo, falló la red)')
  assert.deepStrictEqual(shared.verifyCert(r.body.cert, pub(1), app.publicHex), { username: 'ana' })

  // --- Persistencia: tras reiniciar, todo sigue registrado y la clave es la misma ---
  const keyBefore = app.publicHex
  await new Promise((r2) => app.server.close(r2))
  app = await start()
  assert.strictEqual(app.publicHex, keyBefore)
  assert.strictEqual((await claim(app, 'ANA', pub(30))).status, 409)

  // --- Límite por IP (frena a quien quiera acaparar nombres) ---
  await new Promise((r2) => app.server.close(r2))
  const app2 = await start(fs.mkdtempSync(path.join(tmp, 'ip-')), { limits: { claimsPerIpDay: 4 } })
  let last
  for (let i = 0; i < 5; i++) last = await claim(app2, 'nombre' + i, pub(40 + i))
  assert.strictEqual(last.status, 429)
  await new Promise((r2) => app2.server.close(r2))

  // --- Cliente de la app (src/registry.js) contra el servicio, de punta a punta ---
  {
    const config = require('../src/config')
    const registry = require('../src/registry')
    const accounts = require('../src/accounts')
    const app3 = await start(fs.mkdtempSync(path.join(tmp, 'e2e-')))
    config.REGISTRY_URL = app3.base // http://127.0.0.1 está permitido solo para pruebas locales
    config.REGISTRY_PUBKEY = app3.publicHex
    assert.strictEqual(registry.enabled(), true)

    const cert = await registry.claim('luzmarina', pub(50))
    assert.deepStrictEqual(shared.verifyCert(cert, pub(50), app3.publicHex), { username: 'luzmarina' })

    const dir = fs.mkdtempSync(path.join(tmp, 'acc-'))
    accounts.init(dir)
    const made = accounts.createAccount({ email: 'luz@gmail.com', username: 'luzmarina', password: 'una-frase-larga-y-propia' }, { cert })
    assert.deepStrictEqual(accounts.unlockWithPassword('luzmarina', 'una-frase-larga-y-propia').account.cert, cert)
    assert.deepStrictEqual(made.account.cert, cert)

    await assert.rejects(registry.claim('LuzMarina', pub(51)), /ya está registrado/)

    // Si el servidor entrega un certificado firmado por otro, la app lo rechaza
    config.REGISTRY_PUBKEY = '11'.repeat(32)
    await assert.rejects(registry.claim('nuevo', pub(52)), /certificado no válido/)

    // Configuración insegura o caída: se rechaza con un mensaje claro
    config.REGISTRY_PUBKEY = app3.publicHex
    config.REGISTRY_URL = 'http://ejemplo.com'
    await assert.rejects(registry.claim('abc', pub(53)), /https/)
    config.REGISTRY_URL = 'https://localhost:1'
    await assert.rejects(registry.claim('abc', pub(53)), /No se pudo conectar/)
    config.REGISTRY_URL = ''
    config.REGISTRY_PUBKEY = ''
    assert.strictEqual(registry.enabled(), false)
    await new Promise((r2) => app3.server.close(r2))
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('server.js: todo bien')
  process.exit(0)
})().catch((err) => { console.error(err); process.exit(1) })
