'use strict'
// Cuentas LOCALES: viven en este computador, no en un servidor.
//
// Idea clave: cada cuenta tiene una "clave de datos" aleatoria que cifra el archivo
// de datos (vault). Esa clave de datos se guarda "envuelta" de varias formas:
//   - envuelta con tu contraseña            -> entras escribiendo la contraseña
//   - envuelta con el archivo del pendrive  -> entras con la clave de acceso (opcional)
//   - guardada con el llavero del sistema   -> "recordar en este dispositivo" (opcional)
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')
const { encrypt, decrypt, randomKey, sha256, kdfPassword } = require('./crypto')
const { normalizeEmail, isGmail, usernameKey, checkUsername } = require('./shared')

const ID_RE = /^[0-9a-f]{32}$/
const DUMMY_SALT = Buffer.alloc(16, 7)
let ACCOUNTS_DIR = null
let REMEMBER_FILE = null

function init(baseDir) {
  ACCOUNTS_DIR = path.join(baseDir, 'accounts')
  REMEMBER_FILE = path.join(baseDir, 'remember.bin')
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 })
}

const dirOf = (id) => path.join(ACCOUNTS_DIR, id)

function readAccount(id) {
  if (!ID_RE.test(id)) return null // evita rutas maliciosas
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'account.json'), 'utf8'))
  } catch {
    return null
  }
}

function writeAccount(acc) {
  fs.mkdirSync(dirOf(acc.id), { recursive: true, mode: 0o700 })
  const file = path.join(dirOf(acc.id), 'account.json')
  fs.writeFileSync(file + '.tmp', JSON.stringify(acc, null, 2), { mode: 0o600 })
  fs.renameSync(file + '.tmp', file)
}

function listAccounts() {
  return fs.readdirSync(ACCOUNTS_DIR).map((id) => readAccount(id)).filter(Boolean)
}

// ---------- Crear cuenta ----------

// Contraseñas demasiado comunes (se comparan en minúsculas). Es una lista corta, no un diccionario completo.
const COMMON_PASSWORDS = new Set([
  'password12', 'password123', 'password1234', '1234567890', '12345678910', '0123456789', '9876543210',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t', '1qaz2wsx3edc', 'abcdefghij', 'abcd123456',
  'iloveyou12', 'iloveyou123', 'contraseña', 'contraseña1', 'contraseña12', 'contraseña123', 'contrasena123',
  'passw0rd123', 'administrator', 'letmein1234', 'welcome1234', 'chilenito12', 'santiago123'
])

function checkPassword(password, username, email) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('La contraseña debe tener al menos 10 caracteres')
  }
  if (password.length > 200) throw new Error('La contraseña es demasiado larga')
  const low = password.toLowerCase()
  if (COMMON_PASSWORDS.has(low) || new Set(low).size < 5) {
    throw new Error('Esa contraseña es demasiado común o repetitiva. Usa una frase larga que sea solo tuya')
  }
  const local = email.split('@')[0]
  if ((username.length >= 4 && low.includes(username.toLowerCase())) || (local.length >= 4 && low.includes(local))) {
    throw new Error('La contraseña no debe contener tu usuario ni tu correo')
  }
}

function validate({ email, username, password }) {
  const emailRe = config.REQUIRE_GMAIL ? /^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/ : /^[^@\s]+@[^@\s]+\.[^@\s]+$/
  if (!emailRe.test(email) || email.length > 120 || (config.REQUIRE_GMAIL && !isGmail(email))) {
    throw new Error(config.REQUIRE_GMAIL ? 'Escribe un Gmail válido (nombre@gmail.com)' : 'Correo no válido')
  }
  checkUsername(username)
  checkPassword(password, username, email)
}

// Valida los datos y comprueba que el correo y el usuario no estén ya en este equipo.
// Se llama ANTES de contactar al servidor de verificación.
function prepareSignup({ email, username, password }) {
  email = String(email || '').trim().toLowerCase()
  username = String(username || '').trim()
  validate({ email, username, password })
  for (const a of listAccounts()) {
    if (usernameKey(a.username) === usernameKey(username)) throw new Error('Ese nombre de usuario ya está en uso (o es demasiado parecido a uno existente)')
    if (normalizeEmail(a.email) === normalizeEmail(email)) throw new Error('Ese correo ya tiene una cuenta')
  }
  return { email, username }
}

function createAccount({ email, username, password }, extra = {}) {
  ;({ email, username } = prepareSignup({ email, username, password }))

  const dataKey = randomKey()
  const salt = crypto.randomBytes(16)
  const account = {
    id: crypto.randomBytes(16).toString('hex'),
    email,
    username,
    createdAt: Date.now(),
    kdfSalt: salt.toString('base64'),
    passwordWrap: encrypt(kdfPassword(password, salt), dataKey),
    keyfileWrap: null,
    cert: extra.cert || null // certificado firmado por el servidor de verificación (si lo hay)
  }
  writeAccount(account)
  return { account, dataKey }
}

// ---------- Entrar con contraseña ----------

function unlockWithPassword(userOrEmail, password) {
  const who = String(userOrEmail || '').trim().toLowerCase()
  const account = listAccounts().find((a) => a.username.toLowerCase() === who || a.email === who)
  const fail = new Error('Usuario o contraseña incorrectos')
  if (!account) {
    kdfPassword(String(password || ''), DUMMY_SALT) // mismo tiempo que con un usuario real
    throw fail
  }
  try {
    const dataKey = decrypt(kdfPassword(password, Buffer.from(account.kdfSalt, 'base64')), account.passwordWrap)
    return { account, dataKey }
  } catch {
    throw fail
  }
}

// ---------- Clave de acceso en pendrive ----------

function createKeyfile(account, dataKey, dir) {
  const secret = crypto.randomBytes(32)
  account.keyfileWrap = encrypt(sha256(secret), dataKey) // reemplaza cualquier clave anterior
  writeAccount(account)
  const file = path.join(dir, 'PrivChat-' + account.username + config.KEYFILE_EXT)
  fs.writeFileSync(
    file,
    JSON.stringify({ app: 'privchat', v: 1, accountId: account.id, secret: secret.toString('base64') }, null, 2),
    { mode: 0o600 }
  )
  return file
}

function removeKeyfile(account) {
  account.keyfileWrap = null // las claves de acceso que existan dejan de servir
  writeAccount(account)
}

function readKeyfile(file) {
  const st = fs.statSync(file)
  if (!st.isFile() || st.size > 4096) throw new Error('Archivo de clave no válido')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (raw.app !== 'privchat' || !ID_RE.test(raw.accountId) || typeof raw.secret !== 'string') {
    throw new Error('Archivo de clave no válido')
  }
  return raw
}

function unlockWithKeyfile(file) {
  const raw = readKeyfile(file)
  const account = readAccount(raw.accountId)
  if (!account || !account.keyfileWrap) throw new Error('Esta clave no corresponde a ninguna cuenta de este equipo')
  try {
    const dataKey = decrypt(sha256(Buffer.from(raw.secret, 'base64')), account.keyfileWrap)
    return { account, dataKey }
  } catch {
    throw new Error('La clave de acceso no es válida o fue reemplazada')
  }
}

function listDirs(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(base, d.name))
  } catch {
    return []
  }
}

// Dónde suelen montarse los pendrives en cada sistema
function candidateRoots() {
  if (process.platform === 'win32') {
    const roots = []
    for (let c = 68; c <= 90; c++) roots.push(String.fromCharCode(c) + ':\\') // D: a Z:
    return roots
  }
  if (process.platform === 'darwin') return listDirs('/Volumes')
  const user = os.userInfo().username
  return [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt'].flatMap(listDirs)
}

// Busca archivos de clave en los pendrives conectados.
// Cada unidad tiene 1,5 s para responder: una unidad de red caída no congela la app.
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve([]), ms))])

async function scanRoot(root) {
  try {
    const names = await fs.promises.readdir(root)
    return names.filter((n) => n.endsWith(config.KEYFILE_EXT)).map((n) => path.join(root, n))
  } catch {
    return []
  }
}

async function findKeyfiles() {
  const results = await Promise.all(candidateRoots().map((root) => withTimeout(scanRoot(root), 1500)))
  return results.flat()
}

// ---------- Recordar en este dispositivo ----------
// Usa el llavero del sistema (Windows DPAPI, macOS Keychain, Linux libsecret).

function safe() {
  const { safeStorage } = require('electron') // se carga aquí para poder probar el resto sin Electron
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Este sistema no tiene llavero para guardar la sesión')
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend &&
      safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Tu Linux no tiene un llavero (gnome-keyring o kwallet): no se puede recordar la sesión de forma segura')
  }
  return safeStorage
}

function rememberDevice(account, dataKey) {
  const enc = safe().encryptString(JSON.stringify({ id: account.id, key: dataKey.toString('base64') }))
  fs.writeFileSync(REMEMBER_FILE, enc, { mode: 0o600 })
}

function loadRemembered() {
  try {
    const raw = JSON.parse(safe().decryptString(fs.readFileSync(REMEMBER_FILE)))
    const account = readAccount(raw.id)
    return account ? { account, dataKey: Buffer.from(raw.key, 'base64') } : null
  } catch {
    return null
  }
}

function rememberedId() {
  const r = loadRemembered()
  return r ? r.account.id : null
}

function forgetDevice() {
  try { fs.unlinkSync(REMEMBER_FILE) } catch {}
}

module.exports = {
  init, dirOf, listAccounts, prepareSignup, createAccount, unlockWithPassword,
  createKeyfile, removeKeyfile, unlockWithKeyfile, findKeyfiles,
  rememberDevice, loadRemembered, rememberedId, forgetDevice
}
