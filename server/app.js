'use strict'
// Registro de nombres de PrivChat (OPCIONAL). Su única función: que un nombre de usuario sea de UNA sola persona.
//   POST /v1/claim   recibe nombre + código público (+ prueba de trabajo) y, si el nombre está libre,
//                    lo reserva para siempre y devuelve un certificado firmado
//   GET  /v1/info    dice cuánta prueba de trabajo se exige
//
// NO pide correo ni ningún dato personal. Guarda: nombre de usuario y código público. Nunca ve chats,
// contactos ni llamadas (eso es P2P). Los contactos comprueban el certificado sin contactar a este servicio.
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const shared = require('../src/shared')

function loadKey(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const file = path.join(dataDir, 'secrets.json')
  if (!fs.existsSync(file)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(file, JSON.stringify({ privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') }), { mode: 0o600 })
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(raw.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  const publicHex = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  return { privateKey, publicHex }
}

class RateLimit {
  constructor(max, windowMs, now) { this.max = max; this.windowMs = windowMs; this.now = now; this.hits = new Map() }
  allow(key) {
    const t = this.now()
    const list = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs)
    if (list.length >= this.max) { this.hits.set(key, list); return false }
    list.push(t)
    this.hits.set(key, list)
    return true
  }
  sweep() {
    const t = this.now()
    for (const [k, list] of this.hits) {
      const kept = list.filter((x) => t - x < this.windowMs)
      if (kept.length) this.hits.set(k, kept)
      else this.hits.delete(k)
    }
  }
}

function createServer({ dataDir, trustProxy = false, now = Date.now, difficulty = 20, limits = {} }) {
  const L = { claimsPerIpDay: 10, claimsPerDay: 3000, ...limits }
  const DAY = 24 * 3600 * 1000
  const key = loadKey(dataDir)
  const regFile = path.join(dataDir, 'registry.json')
  const registry = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : { users: {}, pubs: {} }
  const rlIp = new RateLimit(L.claimsPerIpDay, DAY, now)
  const rlAll = new RateLimit(L.claimsPerDay, DAY, now)

  const save = () => {
    fs.writeFileSync(regFile + '.tmp', JSON.stringify(registry), { mode: 0o600 })
    fs.renameSync(regFile + '.tmp', regFile)
  }

  function clientIp(req) {
    if (trustProxy) {
      const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length) return parts[parts.length - 1] // el que agregó nuestro proxy de confianza
    }
    return req.socket.remoteAddress || 'unknown'
  }

  function reply(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(obj))
  }

  function readJson(req, max = 1024) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject({ status: 415, error: 'unsupported_media_type' })
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > max) { req.removeAllListeners('data'); req.pause(); reject({ status: 413, error: 'too_large' }); return }
        chunks.push(c)
      })
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
          resolve(body)
        } catch { reject({ status: 400, error: 'bad_json' }) }
      })
      req.on('error', () => reject({ status: 400, error: 'bad_request' }))
    })
  }

  const issue = (username, pub) => shared.signCert(key.privateKey, { username, pub, iat: Math.floor(now() / 1000) })

  async function claim(req, res) {
    const body = await readJson(req)
    if (!rlIp.allow(clientIp(req))) return reply(res, 429, { error: 'rate_limited' })
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const pub = typeof body.pub === 'string' ? body.pub : ''
    if (!/^[0-9a-f]{64}$/.test(pub)) return reply(res, 400, { error: 'bad_request' })
    try { shared.checkUsername(username) } catch { return reply(res, 400, { error: 'bad_username' }) }
    if (!shared.checkPow(username, pub, body.nonce, difficulty)) return reply(res, 400, { error: 'bad_pow' })
    if (!rlAll.allow('all')) return reply(res, 503, { error: 'try_later' })

    const ukey = shared.usernameKey(username)
    const own = registry.pubs[pub]
    if (own) { // mismo código: solo se re-emite el certificado si pide exactamente el mismo nombre
      if (own === ukey && registry.users[ukey].username === username) return reply(res, 200, { ok: true, cert: issue(username, pub) })
      return reply(res, 409, { error: 'key_taken' })
    }
    if (registry.users[ukey]) return reply(res, 409, { error: 'username_taken' })
    registry.users[ukey] = { username, pub, createdAt: now() }
    registry.pubs[pub] = ukey
    save()
    reply(res, 200, { ok: true, cert: issue(username, pub) })
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = (req.url || '').split('?')[0]
      if (req.method === 'GET' && url === '/v1/info') return reply(res, 200, { difficulty })
      if (req.method === 'GET' && url === '/v1/health') return reply(res, 200, { ok: true })
      if (req.method === 'POST' && url === '/v1/claim') return await claim(req, res)
      reply(res, 404, { error: 'not_found' })
    } catch (err) {
      if (err && err.status) {
        if (err.status === 413) { res.setHeader('Connection', 'close'); res.on('finish', () => req.socket.destroy()) }
        return reply(res, err.status, { error: err.error })
      }
      console.error('Error interno:', err && err.message)
      reply(res, 500, { error: 'internal' })
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 8000
  server.maxHeadersCount = 50
  const sweeper = setInterval(() => { rlIp.sweep(); rlAll.sweep() }, 5 * 60 * 1000)
  sweeper.unref()
  server.on('close', () => clearInterval(sweeper))

  return { server, registry, publicHex: key.publicHex }
}

module.exports = { createServer }
