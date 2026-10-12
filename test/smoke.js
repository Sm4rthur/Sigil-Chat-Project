'use strict'
// Pruebas rápidas de cuentas, cifrado, almacenamiento y paquetes. No necesitan instalar nada.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const accounts = require('../src/accounts')
const { Vault } = require('../src/storage')
const { encodeFrame, FrameParser, T_JSON, T_AUDIO } = require('../src/frames')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-test-'))
accounts.init(tmp)

// --- Crear cuenta y validaciones ---
assert.throws(() => accounts.createAccount({ email: 'x@yahoo.com', username: 'ana', password: '12345678' }), /Gmail/)
assert.throws(() => accounts.createAccount({ email: 'ana@gmail.com', username: 'a', password: '12345678' }), /Usuario/)
assert.throws(() => accounts.createAccount({ email: 'ana@gmail.com', username: 'ana', password: '123' }), /10 caracteres/)
// Contraseñas débiles
assert.throws(() => accounts.createAccount({ email: 'ana@gmail.com', username: 'ana', password: 'password123' }), /común/)
assert.throws(() => accounts.createAccount({ email: 'ana@gmail.com', username: 'ana', password: 'aaaaaaaaaaaa' }), /común/)
assert.throws(() => accounts.createAccount({ email: 'ana@gmail.com', username: 'anabella', password: 'xx-anabella-99' }), /usuario/)
assert.throws(() => accounts.createAccount({ email: 'carlos.perez@gmail.com', username: 'carlosp', password: 'xx-carlos.perez-1' }), /correo/)
const { account, dataKey } = accounts.createAccount({ email: 'Ana@Gmail.com', username: 'ana', password: 'clave-segura-1' })
assert.strictEqual(account.email, 'ana@gmail.com')
assert.throws(() => accounts.createAccount({ email: 'otra@gmail.com', username: 'ANA', password: 'clave-segura-1' }), /ya está en uso/)
assert.throws(() => accounts.createAccount({ email: 'otra@gmail.com', username: 'an.a', password: 'clave-segura-1' }), /ya está en uso/)
assert.throws(() => accounts.createAccount({ email: 'otra@gmail.com', username: 'AnA', password: 'clave-segura-1' }), /ya está en uso/)
// el mismo Gmail escrito de otra forma sigue siendo el mismo correo
for (const alias of ['a.na@gmail.com', 'ana+trucos@gmail.com', 'A.N.A@googlemail.com', 'ANA@GMAIL.COM']) {
  assert.throws(() => accounts.createAccount({ email: alias, username: 'otro-usuario', password: 'clave-segura-1' }), /correo ya tiene/, alias)
}
// letras de otro alfabeto que parecen latinas (a cirílica) no se aceptan
assert.throws(() => accounts.createAccount({ email: 'otra@gmail.com', username: 'an\u0430x', password: 'clave-segura-1' }), /Usuario/)

// --- Entrar con contraseña (por usuario o por correo) ---
assert.ok(accounts.unlockWithPassword('ana', 'clave-segura-1').dataKey.equals(dataKey))
assert.ok(accounts.unlockWithPassword('ana@gmail.com', 'clave-segura-1').dataKey.equals(dataKey))
assert.throws(() => accounts.unlockWithPassword('ana', 'mala-clave-123'), /incorrectos/)
assert.throws(() => accounts.unlockWithPassword('nadie', 'clave-segura-1'), /incorrectos/)

// --- Datos cifrados ---
const vault = new Vault(accounts.dirOf(account.id), dataKey)
vault.load()
vault.data.contacts.push({ key: 'abc', name: 'Beto' })
vault.saveNow()
const raw = fs.readFileSync(path.join(accounts.dirOf(account.id), 'vault.json'), 'utf8')
assert.ok(!raw.includes('Beto'), 'el archivo de datos NO debe contener texto legible')
const vault2 = new Vault(accounts.dirOf(account.id), dataKey)
vault2.load()
assert.strictEqual(vault2.data.contacts[0].name, 'Beto')
assert.strictEqual(vault2.data.identitySeed, vault.data.identitySeed)
assert.throws(() => new Vault(accounts.dirOf(account.id), Buffer.alloc(32)).load()) // clave incorrecta

// --- Clave de acceso en "pendrive" ---
const usb = fs.mkdtempSync(path.join(tmp, 'usb-'))
assert.throws(() => accounts.unlockWithKeyfile(path.join(usb, 'no-existe.privchat-key')))
const keyfile = accounts.createKeyfile(account, dataKey, usb)
assert.ok(path.basename(keyfile).startsWith('PrivChat-'), 'el archivo no debe llamarse solo con el usuario (CON, NUL...)')
assert.ok(accounts.unlockWithKeyfile(keyfile).dataKey.equals(dataKey))
const keyfile2 = accounts.createKeyfile(account, dataKey, fs.mkdtempSync(path.join(tmp, 'usb-')))
assert.throws(() => accounts.unlockWithKeyfile(keyfile), /reemplazada/) // la nueva clave invalida la anterior
assert.ok(accounts.unlockWithKeyfile(keyfile2).dataKey.equals(dataKey))
accounts.removeKeyfile(account)
assert.throws(() => accounts.unlockWithKeyfile(keyfile2), /ninguna cuenta/)

// Un archivo de clave con id malicioso no debe salir de la carpeta de cuentas
const evil = path.join(usb, 'evil.privchat-key')
fs.writeFileSync(evil, JSON.stringify({ app: 'privchat', accountId: '../../etc/passwd', secret: 'x' }))
assert.throws(() => accounts.unlockWithKeyfile(evil), /no válido/)

// --- Paquetes de red (incluye pedazos partidos y varios juntos) ---
const got = []
const parser = new FrameParser((type, payload) => got.push([type, payload.toString()]))
const f1 = encodeFrame(T_JSON, Buffer.from('{"a":1}'))
const f2 = encodeFrame(T_AUDIO, Buffer.from('audio'))
const all = Buffer.concat([f1, f2])
parser.push(all.subarray(0, 3))
parser.push(all.subarray(3, f1.length + 2))
parser.push(all.subarray(f1.length + 2))
assert.deepStrictEqual(got, [[T_JSON, '{"a":1}'], [T_AUDIO, 'audio']])
assert.throws(() => new FrameParser(() => {}).push(Buffer.from([0xff, 0xff, 0xff, 0xff, 0])))

// --- Reglas compartidas ---
{
  const shared = require('../src/shared')
  const crypto = require('crypto')
  assert.strictEqual(shared.normalizeEmail('A.b.C+x@GoogleMail.com'), 'abc@gmail.com')
  assert.strictEqual(shared.normalizeEmail('Pedro.Perez@empresa.cl'), 'pedro.perez@empresa.cl') // solo Gmail ignora los puntos
  assert.strictEqual(shared.usernameKey('Ana'), shared.usernameKey('an.a'))
  assert.strictEqual(shared.usernameKey('luis'), shared.usernameKey('1uis'))
  assert.notStrictEqual(shared.usernameKey('ana'), shared.usernameKey('anb'))

  // Certificados: válido solo para su clave, y solo con la firma del servidor correcto
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  const nodePub = 'ab'.repeat(32)
  const cert = shared.signCert(privateKey, { username: 'ana', pub: nodePub, iat: 1760000000 })
  assert.deepStrictEqual(shared.verifyCert(cert, nodePub, pubHex), { username: 'ana' })
  assert.strictEqual(shared.verifyCert(cert, 'cd'.repeat(32), pubHex), null, 'el certificado no se puede usar con otra clave')
  assert.strictEqual(shared.verifyCert({ ...cert, u: 'root' }, nodePub, pubHex), null, 'cambiar el nombre invalida la firma')
  assert.strictEqual(shared.verifyCert({ ...cert, s: 'AAAA' }, nodePub, pubHex), null)
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  assert.strictEqual(shared.verifyCert(cert, nodePub, other), null, 'firma de otro servidor')
  assert.strictEqual(shared.verifyCert(cert, nodePub, ''), null)
  assert.strictEqual(shared.verifyCert(null, nodePub, pubHex), null)
}

// Lector de paquetes: un paquete grande que llega de a 1 byte no debe congelar la app
{
  const big = encodeFrame(T_JSON, Buffer.alloc(60000, 97))
  let seen = 0
  const slow = new FrameParser((t, p) => { seen += p.length })
  const t0 = Date.now()
  for (let i = 0; i < big.length; i++) slow.push(big.subarray(i, i + 1))
  assert.strictEqual(seen, 60000)
  assert.ok(Date.now() - t0 < 1500, 'el lector es demasiado lento con datos fragmentados')
  // largo del encabezado partido entre pedazos
  const split = []
  const p2 = new FrameParser((t, p) => split.push(p.toString()))
  const f = encodeFrame(T_JSON, Buffer.from('hola'))
  p2.push(f.subarray(0, 1)); p2.push(f.subarray(1, 3)); p2.push(f.subarray(3))
  assert.deepStrictEqual(split, ['hola'])
  // un largo declarado mayor al máximo se rechaza de inmediato, sin esperar los datos
  assert.throws(() => new FrameParser(() => {}).push(Buffer.from([0, 1, 0, 1, 0])), /inválido/) // 65537 > 64 KB
}

;(async () => {
  const found = await accounts.findKeyfiles()
  assert.ok(Array.isArray(found))
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('smoke.js: todo bien')
})().catch((e) => { console.error(e); process.exit(1) })
