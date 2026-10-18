'use strict'
// Cifrado de extremo a extremo para servidores. Solo usa el módulo `crypto` de Node (nada casero):
//   - Ed25519 (firmas): cada mensaje lo firma su autor, así nadie (ni el anfitrión) puede falsificarlo.
//   - X25519 + HKDF-SHA256 + AES-256-GCM ("sellado"): entrega la clave de grupo a UN miembro, solo él puede abrirla.
//   - AES-256-GCM con la clave de grupo: cifra los mensajes; los datos de contexto (servidor, canal, autor...) van autenticados.
//
// Diseño y límites (ver SECURITY.md): una clave de grupo por "época"; la reparte el DUEÑO; se renueva al expulsar o banear.
// No hay renovación por mensaje (sin secreto posterior al compromiso): para eso haría falta un protocolo como MLS.
const crypto = require('crypto')

const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex')

const HEX64 = /^[0-9a-f]{64}$/
const b64 = (buf) => buf.toString('base64')
const unb64 = (s) => Buffer.from(s, 'base64')
const isB64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s)

// ---------- Firmas (identidad) ----------

// La semilla es la misma que origina el código del usuario (su clave pública Ed25519).
function signerFromSeed(seed) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([ED_PKCS8, seed]), format: 'der', type: 'pkcs8' })
  const publicKey = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32)
  return { publicKey, sign: (data) => b64(crypto.sign(null, Buffer.from(data), priv)) }
}

function verify(pubHex, data, sigB64) {
  try {
    if (!HEX64.test(pubHex) || !isB64(sigB64, 80, 100)) return false
    const key = crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(data), key, unb64(sigB64))
  } catch { return false }
}

// ---------- Clave de cifrado (X25519) ligada a la identidad ----------

function newXKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32),
    pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  }
}
const xPrivate = (raw) => crypto.createPrivateKey({ key: Buffer.concat([X_PKCS8, raw]), format: 'der', type: 'pkcs8' })
const xPublic = (raw) => crypto.createPublicKey({ key: Buffer.concat([X_SPKI, raw]), format: 'der', type: 'spki' })

// La identidad (Ed25519) firma su clave X25519: así se sabe que esa clave de cifrado es de esa persona.
const xkData = (xpubHex) => 'privchat-xkey-v1|' + xpubHex
const bindXKey = (signer, xpubHex) => ({ xpub: xpubHex, sig: signer.sign(xkData(xpubHex)) })
const validXk = (pubHex, xk) =>
  !!xk && typeof xk === 'object' && typeof xk.xpub === 'string' && HEX64.test(xk.xpub) && verify(pubHex, xkData(xk.xpub), xk.sig)

// ---------- Sellado (entregar la clave de grupo a un miembro) ----------

function deriveSealKey(shared, epkRaw, xpubRaw) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([epkRaw, xpubRaw]), 'privchat-seal-v1', 32))
}

function seal(xpubRaw, plaintext, aad) {
  const eph = crypto.generateKeyPairSync('x25519')
  const epkRaw = eph.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: xPublic(xpubRaw) })
  const key = deriveSealKey(shared, epkRaw, xpubRaw)
  const n = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, n)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])
  return { epk: b64(epkRaw), n: b64(n), c: b64(ct) }
}

function open(xprivRaw, xpubRaw, sealed, aad) {
  const epkRaw = unb64(sealed.epk)
  const shared = crypto.diffieHellman({ privateKey: xPrivate(xprivRaw), publicKey: xPublic(epkRaw) })
  const key = deriveSealKey(shared, epkRaw, xpubRaw)
  const raw = unb64(sealed.c)
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(sealed.n))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()])
}

// ---------- Mensajes cifrados con la clave de grupo ----------

const newGroupKey = () => crypto.randomBytes(32)

function encryptGroup(key, plaintext, aad) {
  const n = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, n)
  c.setAAD(Buffer.from(aad))
  return { n: b64(n), c: b64(Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])) }
}

function decryptGroup(key, env, aad) {
  const raw = unb64(env.c)
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(env.n))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()])
}

// Datos que firma el autor y datos autenticados del cifrado (incluyen servidor, canal, id, autor, hora y época)
const msgSigData = (sid, cid, e) => ['privchat-msg-v1', sid, cid, e.id, e.from, e.ts, e.ep, e.n, e.c].join('|')
const msgAad = (sid, cid, e) => ['privchat-aad-v1', sid, cid, e.id, e.from, e.ts, e.ep].join('|')

// Sobre de mensaje recibido de la red -> sobre limpio, o null
function okEnv(e) {
  if (!e || typeof e !== 'object') return null
  if (typeof e.id !== 'string' || !/^[0-9a-f]{12}$/.test(e.id) || typeof e.from !== 'string' || !HEX64.test(e.from)) return null
  if (!Number.isSafeInteger(e.ts) || e.ts < 0 || !Number.isInteger(e.ep) || e.ep < 1 || e.ep > 1e6) return null
  if (!isB64(e.n, 16, 16) || !isB64(e.c, 24, 12000) || !isB64(e.sig, 80, 100)) return null
  return { id: e.id, from: e.from, ts: e.ts, ep: e.ep, n: e.n, c: e.c, sig: e.sig }
}

// ---------- Entrega de claves (del dueño a cada miembro) ----------

const keyAad = (sid, ep, to) => ['privchat-key-v1', sid, ep, to].join('|')
const keySigData = (sid, b) => ['privchat-keysig-v1', sid, b.ep, b.to, b.epk, b.n, b.c].join('|')

function okBox(b) {
  if (!b || typeof b !== 'object') return null
  if (typeof b.to !== 'string' || !HEX64.test(b.to) || !Number.isInteger(b.ep) || b.ep < 1 || b.ep > 1e6) return null
  if (!isB64(b.epk, 44, 44) || !isB64(b.n, 16, 16) || !isB64(b.c, 60, 120) || !isB64(b.sig, 80, 100)) return null
  return { to: b.to, ep: b.ep, epk: b.epk, n: b.n, c: b.c, sig: b.sig }
}

// Prueba de invitación: solo quien conoce el secreto de la invitación puede producirla (el anfitrión no lo conoce)
const joinProof = (secretHex, sid, memberKey, xpub) =>
  crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(['privchat-join-v1', sid, memberKey, xpub].join('|')).digest('hex')
const proofOk = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === 64 && b.length === 64 &&
  crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

module.exports = {
  signerFromSeed, verify, newXKeyPair, bindXKey, validXk, seal, open, newGroupKey, encryptGroup, decryptGroup,
  msgSigData, msgAad, okEnv, okBox, keyAad, keySigData, joinProof, proofOk, isB64, b64, unb64
}
