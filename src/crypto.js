'use strict'
// Cifrado básico con las funciones que ya trae Node (nada casero).
const crypto = require('crypto')

// Parámetros de scrypt: hacen que adivinar una clave por fuerza bruta sea lento.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

const randomKey = () => crypto.randomBytes(32)
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest()
const kdfPassword = (password, salt) =>
  crypto.scryptSync(String(password).normalize('NFKC'), salt, 32, SCRYPT)

// AES-256-GCM: cifra y además detecta si alguien modificó los datos.
function encrypt(key, plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain), c.final()])
  return {
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    ct: ct.toString('base64')
  }
}

// Lanza un error si la clave es incorrecta o los datos fueron alterados.
function decrypt(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'))
  d.setAuthTag(Buffer.from(box.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()])
}

module.exports = { randomKey, sha256, kdfPassword, encrypt, decrypt }
