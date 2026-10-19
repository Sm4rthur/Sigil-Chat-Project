'use strict'
// Guarda todo (contactos, chats, identidad) en UN archivo cifrado en tu equipo.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { encrypt, decrypt, encryptBin, decryptBin } = require('./crypto')
const { validateProfile, emptyProfile, isEmptyProfile, profileRev } = require('./profile')

function defaults() {
  return {
    identitySeed: crypto.randomBytes(32).toString('base64'), // de aquí sale tu código único
    contacts: [],  // { key, name, remoteName, addedAt }
    requests: [],  // { key, name, ts }  gente que quiere agregarte
    blocked: [],   // claves rechazadas
    chats: {},     // { [key]: [ { id, from: 'me'|'them', text, ts, status } ] }
    servers: {},       // servidores: los que alojo y a los que pertenezco (ver servers.js)
    e2eeKeys: null,    // clave X25519 para recibir claves de grupo (la identidad firma que es tuya)
    fontConsent: {},   // contactos cuyas fuentes personalizadas acepté cargar: { [clave]: true|false }
    settings: {
      nodeMode: true, acceptRequests: true, runInBackground: false, autoStart: false,
      notifications: true, notificationSound: true, mutedContacts: [], mutedServers: []
    }
  }
}

class Vault {
  constructor(dir, dataKey) {
    this.file = path.join(dir, 'vault.json')
    this.key = dataKey
    this.data = null
    this.timer = null
  }

  // 'initial' solo se usa si el archivo aún no existe (por ejemplo, la identidad elegida al registrarse).
  load(initial = {}) {
    const d = defaults()
    if (fs.existsSync(this.file)) {
      const box = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      const stored = JSON.parse(decrypt(this.key, box).toString('utf8')) // falla si la clave no sirve
      this.data = { ...d, ...stored, settings: { ...d.settings, ...stored.settings } }
    } else {
      this.data = { ...d, ...initial }
      this.saveNow()
    }
  }

  // Guarda en un instante (agrupa varios cambios seguidos)
  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), 300)
  }

  saveNow() {
    clearTimeout(this.timer)
    if (!this.data) return
    const box = encrypt(this.key, Buffer.from(JSON.stringify(this.data), 'utf8'))
    const tmp = this.file + '.tmp'
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(tmp, JSON.stringify(box), { mode: 0o600 }) // solo tu usuario (Linux/macOS)
    fs.renameSync(tmp, this.file)
  }
}

// Perfiles: el tuyo y los de tus contactos, cada uno en su propio archivo cifrado
// (las imágenes pesan; no conviene mezclarlas con el archivo de chats).
class ProfileStore {
  constructor(dir, dataKey) {
    this.dir = path.join(dir, 'profiles')
    this.key = dataKey
    this.cache = new Map()
  }

  _file(name) {
    if (!/^(mine|[0-9a-f]{64})$/.test(name)) throw new Error('Nombre de perfil no válido')
    return path.join(this.dir, name + '.json')
  }

  _read(name) {
    if (this.cache.has(name)) return this.cache.get(name)
    let entry = null
    try {
      const raw = JSON.parse(decrypt(this.key, JSON.parse(fs.readFileSync(this._file(name), 'utf8'))).toString('utf8'))
      entry = { rev: profileRev(raw), profile: validateProfile(raw) } // se vuelve a validar al leer
    } catch { /* no existe o está dañado */ }
    this.cache.set(name, entry)
    return entry
  }

  _write(name, profile) {
    const box = encrypt(this.key, Buffer.from(JSON.stringify(profile), 'utf8'))
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const file = this._file(name)
    fs.writeFileSync(file + '.tmp', JSON.stringify(box), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
    this.cache.set(name, { rev: profileRev(profile), profile })
  }

  getMine() { return this._read('mine')?.profile || emptyProfile() }
  mineRev() { const e = this._read('mine'); return e && !isEmptyProfile(e.profile) ? e.rev : null }
  setMine(profile) { this._write('mine', profile) }

  get(key) { return this._read(key)?.profile || null }
  rev(key) { return this._read(key)?.rev || '' }
  set(key, profile) { this._write(key, profile) }
  delete(key) {
    this.cache.delete(key)
    try { fs.unlinkSync(this._file(key)) } catch {}
  }
}

// Archivos recibidos y enviados: cada uno cifrado en su propio archivo, con el SHA-256 de su contenido como nombre.
class FileStore {
  constructor(dir, dataKey) {
    this.dir = path.join(dir, 'files')
    this.key = dataKey
    this._total = null
  }

  _file(sha) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) throw new Error('Archivo no válido')
    return path.join(this.dir, sha + '.bin')
  }

  has(sha) { return fs.existsSync(this._file(sha)) }

  put(sha, buf) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const file = this._file(sha)
    fs.writeFileSync(file + '.tmp', encryptBin(this.key, buf), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
    this._total = null
  }

  get(sha) {
    try { return decryptBin(this.key, fs.readFileSync(this._file(sha))) } catch { return null }
  }

  delete(sha) {
    try { fs.unlinkSync(this._file(sha)) } catch { /* ya no estaba */ }
    this._total = null
  }

  total() {
    if (this._total === null) {
      let n = 0
      try { for (const f of fs.readdirSync(this.dir)) n += fs.statSync(path.join(this.dir, f)).size } catch { /* sin archivos */ }
      this._total = n
    }
    return this._total
  }
}

module.exports = { Vault, ProfileStore, FileStore }
