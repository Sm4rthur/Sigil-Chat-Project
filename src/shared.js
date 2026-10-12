'use strict'
// Reglas compartidas entre la app y el servidor de verificación (deben ser idénticas en ambos lados).
const crypto = require('crypto')

// Nombre de usuario: solo ASCII. Así nadie puede copiar un nombre usando letras de otro alfabeto
// que se ven iguales (por ejemplo la "а" cirílica por la "a" latina).
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/

// Dos correos de Gmail son la MISMA cuenta aunque se escriban distinto:
//   a.na@gmail.com = ana@gmail.com = ana+lo-que-sea@gmail.com = ana@googlemail.com
// Sin esta normalización, alguien podría crear infinitas cuentas con un solo Gmail.
function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return e
  let local = e.slice(0, at)
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '')
  return local + '@' + domain
}

const isGmail = (email) => /@(gmail|googlemail)\.com$/i.test(String(email || '').trim())

// "Huella" del nombre para detectar nombres parecidos: ignora mayúsculas y . _ - ,
// y trata 0=o y 1=i=l como iguales. Así "Ana", "an.a" y "AnA" son el mismo nombre,
// y "luis" no puede copiarse como "1uis" ni "iuis".
function usernameKey(username) {
  return String(username || '').toLowerCase().replace(/[._-]/g, '').replace(/0/g, 'o').replace(/[1i]/g, 'l')
}

function checkUsername(username) {
  if (!USERNAME_RE.test(username) || usernameKey(username).length < 3) {
    throw new Error('Usuario: de 3 a 24 caracteres, solo letras sin tilde, números y . _ -')
  }
}

// ---------- Certificado de usuario verificado ----------
// El servidor firma "este usuario es dueño de este código" con su clave Ed25519.
// Los contactos comprueban la firma SIN contactar al servidor (se conserva el modo P2P).
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

const certMessage = (c) => Buffer.from(['privchat-cert-v1', c.u, c.p, String(c.i)].join('\n'), 'utf8')

function signCert(privateKey, { username, pub, iat }) {
  const cert = { u: username, p: pub, i: iat }
  cert.s = crypto.sign(null, certMessage(cert), privateKey).toString('base64')
  return cert
}

// Devuelve { username } si el certificado es válido para ESA clave pública; si no, null.
function verifyCert(cert, expectedPub, serverPubHex) {
  try {
    if (!serverPubHex || !/^[0-9a-f]{64}$/.test(serverPubHex) || !cert || typeof cert !== 'object') return null
    if (typeof cert.u !== 'string' || !USERNAME_RE.test(cert.u)) return null
    if (typeof cert.p !== 'string' || cert.p !== expectedPub || !/^[0-9a-f]{64}$/.test(cert.p)) return null
    if (!Number.isSafeInteger(cert.i) || typeof cert.s !== 'string' || cert.s.length > 200) return null
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(serverPubHex, 'hex')]),
      format: 'der',
      type: 'spki'
    })
    return crypto.verify(null, certMessage(cert), key, Buffer.from(cert.s, 'base64')) ? { username: cert.u } : null
  } catch {
    return null
  }
}

// ---------- Prueba de trabajo para reclamar un nombre ----------
// Sin correo, lo único que frena a quien quiera acaparar miles de nombres es que cada reclamo cueste
// un poco de cálculo (unos segundos). El resultado va ligado al nombre y al código: no se puede reutilizar.
function leadingZeroBits(buf) {
  let n = 0
  for (const b of buf) {
    if (b === 0) { n += 8; continue }
    n += Math.clz32(b) - 24
    break
  }
  return n
}
const powInput = (username, pub, nonce) => `privchat-claim|${username}|${pub}|${nonce}`
const powHash = (username, pub, nonce) => crypto.createHash('sha256').update(powInput(username, pub, nonce)).digest()

function checkPow(username, pub, nonce, difficulty) {
  return typeof nonce === 'string' && /^[0-9a-f]{1,16}$/.test(nonce) && leadingZeroBits(powHash(username, pub, nonce)) >= difficulty
}

async function solvePow(username, pub, difficulty) {
  let n = crypto.randomInt(0, 2 ** 31)
  for (;;) {
    for (let i = 0; i < 20000; i++, n++) {
      const nonce = n.toString(16)
      if (leadingZeroBits(powHash(username, pub, nonce)) >= difficulty) return nonce
    }
    await new Promise((resolve) => setImmediate(resolve)) // deja respirar a la app mientras calcula
  }
}

module.exports = { checkPow, solvePow, USERNAME_RE, normalizeEmail, isGmail, usernameKey, checkUsername, signCert, verifyCert }
