'use strict'
// Piezas criptográficas del cifrado de extremo a extremo.
const assert = require('assert')
const crypto = require('crypto')
const e2 = require('../src/e2ee')

const seed = crypto.randomBytes(32)
const signer = e2.signerFromSeed(seed)
const pub = signer.publicKey.toString('hex')

// Firmas
const sig = signer.sign('hola')
assert.ok(e2.verify(pub, 'hola', sig))
assert.ok(!e2.verify(pub, 'hola!', sig), 'datos alterados')
assert.ok(!e2.verify('00'.repeat(32), 'hola', sig), 'otra clave')
for (const bad of [null, '', 'AAAA', 5, {}, 'x'.repeat(200)]) assert.ok(!e2.verify(pub, 'hola', bad))
assert.ok(!e2.verify('zz', 'hola', sig))
assert.strictEqual(e2.signerFromSeed(seed).publicKey.toString('hex'), pub, 'la semilla fija la identidad')

// Clave X25519 ligada a la identidad
const xk = e2.newXKeyPair()
const bound = e2.bindXKey(signer, xk.pub.toString('hex'))
assert.ok(e2.validXk(pub, bound))
assert.ok(!e2.validXk(pub, { ...bound, xpub: e2.newXKeyPair().pub.toString('hex') }), 'clave sustituida')
assert.ok(!e2.validXk(e2.signerFromSeed(crypto.randomBytes(32)).publicKey.toString('hex'), bound), 'firmada por otro')
assert.ok(!e2.validXk(pub, null) && !e2.validXk(pub, { xpub: 5 }))

// Sellado: solo el destinatario abre; el contexto (aad) cuenta
const secret = e2.newGroupKey()
const aad = e2.keyAad('s'.repeat(16), 1, pub)
const sealed = e2.seal(xk.pub, secret, aad)
assert.ok(e2.open(xk.priv, xk.pub, sealed, aad).equals(secret))
const other = e2.newXKeyPair()
assert.throws(() => e2.open(other.priv, other.pub, sealed, aad), 'otro destinatario no abre')
assert.throws(() => e2.open(xk.priv, xk.pub, sealed, e2.keyAad('s'.repeat(16), 2, pub)), 'otra época')
assert.throws(() => e2.open(xk.priv, xk.pub, { ...sealed, c: Buffer.alloc(48).toString('base64') }, aad), 'datos alterados')
const again = e2.seal(xk.pub, secret, aad)
assert.notStrictEqual(again.epk, sealed.epk, 'cada sellado usa una clave efímera nueva')

// Mensajes con clave de grupo
const gk = e2.newGroupKey()
const env = { id: 'a'.repeat(12), from: pub, ts: Date.now(), ep: 1 }
const a1 = e2.msgAad('S'.repeat(16), 'c'.repeat(8), env)
const enc = e2.encryptGroup(gk, Buffer.from('hola grupo'), a1)
assert.strictEqual(e2.decryptGroup(gk, enc, a1).toString(), 'hola grupo')
assert.throws(() => e2.decryptGroup(e2.newGroupKey(), enc, a1), 'otra clave')
assert.throws(() => e2.decryptGroup(gk, enc, e2.msgAad('S'.repeat(16), 'd'.repeat(8), env)), 'otro canal: el mensaje no se puede mover')
assert.throws(() => e2.decryptGroup(gk, enc, e2.msgAad('S'.repeat(16), 'c'.repeat(8), { ...env, from: 'b'.repeat(64) })), 'otro autor')
assert.throws(() => e2.decryptGroup(gk, enc, e2.msgAad('S'.repeat(16), 'c'.repeat(8), { ...env, ts: env.ts + 1 })), 'otra hora')
const tampered = Buffer.from(enc.c, 'base64'); tampered[0] ^= 1
assert.throws(() => e2.decryptGroup(gk, { n: enc.n, c: tampered.toString('base64') }, a1), 'texto cifrado alterado')
assert.notStrictEqual(e2.encryptGroup(gk, Buffer.from('x'), a1).n, e2.encryptGroup(gk, Buffer.from('x'), a1).n, 'nonce distinto cada vez')

// Sobres y cajas de la red: validación estricta
const full = { id: 'a'.repeat(12), from: pub, ts: 1, ep: 1, n: enc.n, c: enc.c, sig }
assert.ok(e2.okEnv(full))
for (const bad of [null, 5, [], {}, { ...full, id: 'x' }, { ...full, from: 'z' }, { ...full, ts: 1.5 }, { ...full, ts: -1 }, { ...full, ep: 0 }, { ...full, ep: 2e6 },
  { ...full, n: 'AAAA' }, { ...full, c: 'x'.repeat(13000) }, { ...full, c: '<script>' }, { ...full, sig: 'corta' }, { ...full, id: ['a'.repeat(12)] }]) {
  assert.strictEqual(e2.okEnv(bad), null, JSON.stringify(bad).slice(0, 60))
}
assert.ok(!('extra' in e2.okEnv({ ...full, extra: 'x' })), 'campos desconocidos se descartan')
const box = { to: pub, ep: 1, ...sealed, sig }
assert.ok(e2.okBox(box))
for (const bad of [null, {}, { ...box, to: 'x' }, { ...box, ep: 0 }, { ...box, epk: 'AAAA' }, { ...box, c: 'A'.repeat(500) }]) assert.strictEqual(e2.okBox(bad), null)

// Prueba de invitación
const secretHex = crypto.randomBytes(16).toString('hex')
const proof = e2.joinProof(secretHex, 's'.repeat(16), pub, 'x'.repeat(64))
assert.ok(e2.proofOk(proof, e2.joinProof(secretHex, 's'.repeat(16), pub, 'x'.repeat(64))))
assert.ok(!e2.proofOk(proof, e2.joinProof(crypto.randomBytes(16).toString('hex'), 's'.repeat(16), pub, 'x'.repeat(64))), 'sin el secreto no se puede fabricar')
assert.ok(!e2.proofOk(proof, e2.joinProof(secretHex, 's'.repeat(16), 'b'.repeat(64), 'x'.repeat(64))), 'ligada a la clave de quien entra')
assert.ok(!e2.proofOk(proof, 'corta') && !e2.proofOk(null, proof))

console.log('e2ee.js: todo bien')
