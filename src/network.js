'use strict'
// Red P2P: conecta tu computador directamente con el de tus contactos.
//
// Usa Hyperswarm (la misma tecnología de Keet/Holepunch):
//  - Tu "código único" es tu clave pública. Con ella otro PC te encuentra en la red.
//  - La conexión entre dos PCs va cifrada de extremo a extremo y autenticada
//    (sabes con certeza que quien conectó tiene la clave pública que dice tener).
//  - "Modo nodo": tu PC se une a la red DHT pública y ayuda a otros a encontrarse.
//    No guarda ni retransmite chats ajenos.
//
// SEGURIDAD: cualquiera que conozca tu código puede intentar conectarse. Por eso:
//  - solo los CONTACTOS pueden escribirte o llamarte; los desconocidos quedan como "solicitud"
//  - hay límites de conexiones, de solicitudes, de tamaño y de velocidad por conexión
//  - todo dato que llega se valida antes de usarse
const EventEmitter = require('events')
const crypto = require('crypto')
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const config = require('./config')
const { verifyCert } = require('./shared')
const { validateProfile, LIMITS: PROFILE_LIMITS } = require('./profile')
const { Servers } = require('./servers')
const { FILES, sanitizeName, mimeFor } = require('./files')
const e2 = require('./e2ee')
const { T_JSON, T_AUDIO, T_FILE, MAX_JSON_FRAME, MAX_AUDIO_FRAME, encodeFrame, FrameParser } = require('./frames')

// Límites de seguridad (ajustables)
const LIMITS = {
  helloTimeoutMs: 10000,   // una conexión que no se presenta en este tiempo se corta
  maxUnknownConnections: 8, // conexiones simultáneas de desconocidos
  maxRequests: 20,          // solicitudes pendientes guardadas
  maxBlocked: 500,          // lista de bloqueados
  jsonBurst: 300,           // paquetes de chat/control permitidos de golpe...
  jsonPerSec: 50,           // ...y por segundo sostenido. Si se excede, se corta la conexión
  audioBurst: 64 * 1024,    // bytes de audio de golpe...
  audioBytesPerSec: 96 * 1024, // ...y por segundo (lo normal son ~32 KB/s)
  inviteMinGapMs: 3000,     // separación mínima entre invitaciones de llamada
  flushBatch: 100,          // mensajes pendientes reenviados por vez
  profileChunk: 12288,      // bytes de perfil por paquete (viajan en base64)
  profileMaxChunks: 450,
  profilePaceMs: 30         // pausa entre paquetes de perfil (para no saturar)
}

// Cubeta de fichas: permite ráfagas cortas pero limita la velocidad sostenida.
class Bucket {
  constructor(capacity, perSec) {
    this.capacity = capacity
    this.perSec = perSec
    this.tokens = capacity
    this.last = Date.now()
  }

  take(n = 1) {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec)
    this.last = now
    if (this.tokens < n) return false
    this.tokens -= n
    return true
  }
}

// Quita caracteres de control e invisibles (incluidos los que invierten el sentido del texto,
// usados para suplantar nombres) de lo que elige otra persona, como su nombre.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g
const clean = (s, max) => (typeof s === 'string' ? s : '').replace(INVISIBLE, '').trim().slice(0, max)
const randomId = () => crypto.randomBytes(8).toString('hex')
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

class P2PNode extends EventEmitter {
  constructor({ seed, name, vault, nodeMode, cert, profiles, fileStore }) {
    super()
    this.fileStore = fileStore || null // archivos compartidos (ver storage.js)
    this.profiles = profiles || null // almacén de perfiles (ver storage.js)
    this.cert = cert || null // certificado firmado por el servicio de verificación (si la cuenta lo tiene)
    this.keyPair = DHT.keyPair(seed)
    this.code = this.keyPair.publicKey.toString('hex') // tu código único (64 caracteres)
    // Firma de mensajes: se deriva de la MISMA semilla. Si no coincide con tu código, el cifrado se desactiva (nunca falla en silencio).
    this.signer = null
    this.e2eeReady = false
    try {
      this.signer = e2.signerFromSeed(seed)
      this.e2eeReady = this.signer.publicKey.equals(this.keyPair.publicKey)
    } catch { this.e2eeReady = false }
    this.name = name
    this.vault = vault
    this.nodeMode = nodeMode
    this.peers = new Map() // clave -> { key, conn, ready, remoteName, json, audio, ... }
    this.call = null       // { id, peer, state: 'calling'|'ringing'|'active', startedAt }
    this._callTimer = null
    this._tick = null
    this.started = false // true cuando ya está escuchando en la red
    this.servers = new Servers(this) // servidores (grupos) alojados por el creador
  }

  get data() { return this.vault.data }

  // ---------- Arranque y cierre ----------

  async start() {
    const opts = { keyPair: this.keyPair }
    if (config.BOOTSTRAP) opts.bootstrap = config.BOOTSTRAP
    // Modo nodo activado: la red te agrega como nodo cuando tu conexión es estable y accesible.
    // Desactivado: solo usas la red, sin ayudar a otros.
    if (!this.nodeMode) opts.ephemeral = true
    this.dht = new DHT(opts)
    // 'firewall' rechaza conexiones antes de gastar recursos en ellas (true = rechazar).
    this.swarm = new Hyperswarm({
      keyPair: this.keyPair,
      dht: this.dht,
      maxPeers: 120, // un servidor de 50 miembros más tus contactos
      firewall: (remotePublicKey) => this._rejects(remotePublicKey.toString('hex'))
    })
    this.swarm.on('connection', (conn) => this._onConnection(conn))
    this._tick = setInterval(() => {
      this.emit('node', this.nodeInfo())
      for (const p of this.peers.values()) if (p.ready) this._flushOutbox(p) // reintenta pendientes
    }, 30000)

    await this.swarm.listen() // quedar disponible para que tus contactos te encuentren
    this.started = true
    for (const c of this.data.contacts) this.swarm.joinPeer(Buffer.from(c.key, 'hex'))
    for (const hostKey of this.servers.hostKeys()) this.swarm.joinPeer(Buffer.from(hostKey, 'hex')) // anfitriones de mis servidores
    this.emit('node', this.nodeInfo())
  }

  async stop() {
    clearInterval(this._tick)
    clearTimeout(this._callTimer)
    for (const p of this.servers.pending.values()) clearTimeout(p.timer)
    const peers = [...this.peers.values()]
    this.peers.clear()
    for (const p of peers) { clearTimeout(p.helloTimer); p.conn.destroy() }
    try { await this.swarm?.destroy() } catch {}
    try { await this.dht?.destroy() } catch {}
  }

  nodeInfo() {
    const connected = [...this.peers.values()].filter((p) => p.ready).length
    const acting = this.dht && typeof this.dht.ephemeral === 'boolean' ? !this.dht.ephemeral : null
    return { ready: this.started, nodeMode: this.nodeMode, acting, connected, acceptRequests: this.data.settings.acceptRequests !== false }
  }

  // ¿Se debe rechazar a esta clave? Bloqueados, y desconocidos si no se aceptan solicitudes.
  _rejects(key) {
    if (this.data.blocked.includes(key)) return true
    if (!this._contact(key) && this.data.settings.acceptRequests === false && !this.servers.hostsAny() && !this.servers.isHostOf(key)) return true
    return false
  }

  setAcceptRequests(value) {
    this.data.settings.acceptRequests = !!value
    this.vault.save()
    if (!value) {
      for (const p of [...this.peers.values()]) if (!this._contact(p.key)) p.conn.destroy()
    }
    this._presence()
  }

  // ---------- Conexiones ----------

  _unknownCount() {
    let n = 0
    for (const p of this.peers.values()) if (!this._contact(p.key) && !this._serverPeer(p.key)) n++
    return n
  }

  // ¿Es miembro de un servidor mío, o el anfitrión de un servidor al que pertenezco?
  _serverPeer(key) { return this.servers.isMemberOfMine(key) || this.servers.isHostOf(key) }

  _onConnection(conn) {
    conn.on('error', () => {})
    const key = conn.remotePublicKey.toString('hex')
    if (this._rejects(key)) return conn.destroy()
    if (!this._contact(key) && !this._serverPeer(key) && this._unknownCount() >= LIMITS.maxUnknownConnections && !this.peers.has(key)) {
      return conn.destroy()
    }

    const old = this.peers.get(key)
    const peer = {
      key, conn, ready: false, remoteName: '', lastInvite: 0,
      json: new Bucket(LIMITS.jsonBurst, LIMITS.jsonPerSec),
      audio: new Bucket(LIMITS.audioBurst, LIMITS.audioBytesPerSec),
      helloTimer: null
    }
    this.peers.set(key, peer)
    if (old) { clearTimeout(old.helloTimer); old.conn.destroy() }

    // Quien no se presenta a tiempo, se corta.
    peer.helloTimer = setTimeout(() => { if (!peer.ready) conn.destroy() }, LIMITS.helloTimeoutMs)

    const parser = new FrameParser((type, payload) => this._onFrame(peer, type, payload))
    conn.on('data', (chunk) => {
      try { parser.push(chunk) } catch { conn.destroy() } // paquete corrupto, hostil o demasiado rápido: cortar
    })
    conn.on('close', () => {
      clearTimeout(peer.helloTimer)
      clearTimeout(peer.srvTimer)
      if (peer.inProfile) clearTimeout(peer.inProfile.timer)
      if (peer.inFile) this._failFile(peer)
      if (this.peers.get(key) !== peer) return
      this.peers.delete(key)
      this.servers.onPeerClosed(peer)
      if (this.call && this.call.peer === key) this._finishCall('peer-left')
      this._presence()
    })

    this._send(peer, { t: 'hello', name: this.name, cert: this.cert || undefined, prof: this._myRev() || undefined, srv: this.servers.hostsAny() || this.servers.joinsAny() || undefined })
  }

  _send(peer, obj) {
    if (!peer || peer.conn.destroyed) return false
    peer.conn.write(encodeFrame(T_JSON, Buffer.from(JSON.stringify(obj), 'utf8')))
    return true
  }

  _presence() {
    this.emit('presence')
    this.emit('node', this.nodeInfo())
  }

  _onFrame(peer, type, payload) {
    if (type === T_FILE) return this._onFileChunk(peer, payload)
    if (type === T_AUDIO) {
      if (payload.length > MAX_AUDIO_FRAME || !peer.audio.take(payload.length)) return // se descarta
      return this._onAudio(peer, payload)
    }
    if (type !== T_JSON) return
    if (payload.length > MAX_JSON_FRAME) throw new Error('Paquete demasiado grande')
    if (!peer.json.take()) throw new Error('Demasiados paquetes por segundo')

    const m = JSON.parse(payload.toString('utf8'))
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') throw new Error('Mensaje inválido')
    if (m.t === 'hello') return this._onHello(peer, m)
    if (m.t.startsWith('srv-')) { // servidores: pueden participar quienes no son contactos; cada acción se valida allí
      if (peer.ready) this.servers.handle(peer, m)
      return
    }
    if (!peer.ready || !this._contact(peer.key)) return // solo contactos pueden escribir o llamar
    switch (m.t) {
      case 'msg': return this._onMessage(peer, m)
      case 'ack': return this._onAck(peer, m)
      case 'call-invite': return this._onCallInvite(peer, m)
      case 'call-accept': return this._onCallAccept(peer, m)
      case 'call-end': return this._onCallEnd(peer, m)
      case 'file-offer': return this._onFileOffer(peer, m)
      case 'file-req': return this._onFileReq(peer, m)
      case 'file-end': return this._onFileEnd(peer, m)
      case 'file-gone': return this._onFileGone(peer)
      case 'profile-new': return this._maybeRequestProfile(peer, m.rev)
      case 'profile-req': return this._onProfileReq(peer)
      case 'profile-start': return this._onProfileStart(peer, m)
      case 'profile-chunk': return this._onProfileChunk(peer, m)
    }
  }

  _onHello(peer, m) {
    // Si trae un certificado válido para SU clave, el nombre es el registrado (no puede elegir otro).
    const proven = verifyCert(m.cert, peer.key, config.REGISTRY_PUBKEY)
    peer.verified = !!proven
    peer.prof = typeof m.prof === 'string' ? m.prof : '' // versión de su perfil (para pedirlo cuando sea contacto)
    peer.remoteName = proven ? proven.username : clean(m.name, 40)
    const contact = this._contact(peer.key)
    if (contact) {
      peer.ready = true
      contact.remoteName = peer.remoteName
      contact.verified = peer.verified
      this.vault.save()
      this._flushOutbox(peer)
      this._maybeRequestProfile(peer, m.prof)
    } else if (m.srv === true && (this.servers.hostsAny() || this._serverPeer(peer.key))) {
      // Viene por un servidor (no por un chat): no genera solicitud. Si no se une pronto, se corta.
      peer.ready = true
      if (!this._serverPeer(peer.key)) {
        peer.srvTimer = setTimeout(() => { if (!this._serverPeer(peer.key)) peer.conn.destroy() }, LIMITS.helloTimeoutMs)
        peer.srvTimer.unref?.()
      }
    } else {
      // Un desconocido con tu código quiere conectarse: queda como solicitud (con tope).
      if (this.data.settings.acceptRequests === false) return peer.conn.destroy()
      const req = this.data.requests.find((r) => r.key === peer.key)
      if (req) {
        req.name = peer.remoteName
        req.verified = peer.verified
      } else if (this.data.requests.length >= LIMITS.maxRequests) {
        return peer.conn.destroy()
      } else {
        this.data.requests.push({ key: peer.key, name: peer.remoteName, verified: peer.verified, ts: Date.now() })
      }
      peer.ready = true
      this.vault.save()
    }
    this.servers.onPeerReady(peer)
    this._presence()
  }

  // ---------- Archivos ----------
  // Primero llega una OFERTA; el receptor decide si descargarla. El contenido va en paquetes binarios,
  // se verifica su tamaño y su SHA-256 y se guarda cifrado. Nada se abre ni se ejecuta jamás.

  _fileMsg(key, id, from) {
    return (this.data.chats[key] || []).find((x) => x.id === id && x.kind === 'file' && x.from === from)
  }

  // Borra del disco los archivos que ya no usa ningún mensaje
  _cleanFiles(shas) {
    if (!this.fileStore) return
    const used = new Set()
    for (const list of Object.values(this.data.chats)) for (const m of list) if (m.kind === 'file') used.add(m.file.sha)
    for (const sha of new Set(shas)) if (!used.has(sha)) this.fileStore.delete(sha)
  }

  offerFile(key, rawName, bytes) {
    if (!this._contact(key)) throw new Error('Contacto desconocido')
    if (!this.fileStore) throw new Error('Los archivos no están disponibles')
    if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new Error('El archivo está vacío')
    if (bytes.length > FILES.maxBytes) throw new Error('El archivo supera el máximo de ' + Math.round(FILES.maxBytes / 1048576) + ' MB')
    if (this.fileStore.total() + bytes.length > FILES.maxStorage) throw new Error('Se alcanzó el espacio máximo para archivos')
    const name = sanitizeName(rawName)
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    this.fileStore.put(sha, bytes)
    const msg = { id: randomId(), from: 'me', kind: 'file', ts: Date.now(), status: 'pending', file: { name, size: bytes.length, mime: mimeFor(name), sha, state: 'sent' } }
    this._pushMessage(key, msg)
    const peer = this.peers.get(key)
    if (peer && peer.ready) this._sendOffer(peer, msg)
    return msg
  }

  _sendOffer(peer, msg) {
    this._send(peer, { t: 'file-offer', id: msg.id, name: msg.file.name, size: msg.file.size, mime: msg.file.mime, sha: msg.file.sha })
  }

  _onFileOffer(peer, m) {
    if (!this.fileStore || typeof m.id !== 'string' || !/^[0-9a-f]{16}$/.test(m.id)) return
    if (!Number.isInteger(m.size) || m.size < 1 || m.size > FILES.maxBytes) return
    if (typeof m.sha !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha) || typeof m.name !== 'string') return
    const chat = this.data.chats[peer.key] || []
    if (chat.some((x) => x.id === m.id)) return this._send(peer, { t: 'ack', id: m.id })
    if (chat.filter((x) => x.kind === 'file' && x.from === 'them' && x.file.state === 'offered').length >= FILES.maxOffered) return
    const mime = typeof m.mime === 'string' && /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,40}$/.test(m.mime) ? m.mime : 'application/octet-stream'
    this._send(peer, { t: 'ack', id: m.id })
    this._pushMessage(peer.key, { id: m.id, from: 'them', kind: 'file', ts: Date.now(), file: { name: sanitizeName(m.name), size: m.size, mime, sha: m.sha, state: 'offered' } })
  }

  // El usuario acepta una oferta: se pide el archivo al contacto.
  downloadFile(key, id) {
    const msg = this._fileMsg(key, id, 'them')
    if (!msg || !['offered', 'failed'].includes(msg.file.state)) throw new Error('Ese archivo no se puede descargar')
    const peer = this.peers.get(key)
    if (!peer || !peer.ready) throw new Error('El contacto no está conectado')
    if (peer.inFile) throw new Error('Ya hay una descarga en curso con este contacto')
    if (this.fileStore.has(msg.file.sha)) { // mismo contenido ya guardado
      msg.file.state = 'ready'
      this.vault.save()
      return this.emit('chat', { key, incoming: false })
    }
    if (this.fileStore.total() + msg.file.size > FILES.maxStorage) throw new Error('Se alcanzó el espacio máximo para archivos')
    msg.file.state = 'downloading'
    peer.inFile = {
      id, size: msg.file.size, sha: msg.file.sha, hash: crypto.createHash('sha256'), parts: [], got: 0, bytes: 0,
      bucket: new Bucket(FILES.recvBurst, FILES.recvPerSec), timer: setTimeout(() => this._failFile(peer), FILES.timeoutMs)
    }
    peer.inFile.timer.unref?.()
    this.vault.save()
    this.emit('chat', { key, incoming: false })
    this._send(peer, { t: 'file-req', id })
  }

  _failFile(peer) {
    const f = peer.inFile
    if (!f) return
    clearTimeout(f.timer)
    peer.inFile = null
    const msg = this._fileMsg(peer.key, f.id, 'them')
    if (msg && msg.file.state === 'downloading') {
      msg.file.state = 'failed'
      this.vault.save()
      this.emit('chat', { key: peer.key, incoming: false })
    }
  }

  // Un contacto pide un archivo que le ofrecí: se le envía en paquetes pequeños, con pausas.
  _onFileReq(peer, m) {
    if (!this.fileStore || peer.sendingFile || typeof m.id !== 'string') return
    const msg = this._fileMsg(peer.key, m.id, 'me')
    const bytes = msg ? this.fileStore.get(msg.file.sha) : null
    if (!bytes) return this._send(peer, { t: 'file-gone', id: m.id.slice(0, 16) })
    peer.sendingFile = true
    const idBuf = Buffer.from(msg.id, 'hex')
    let i = 0
    let off = 0
    const step = () => {
      if (peer.conn.destroyed || this.peers.get(peer.key) !== peer) { peer.sendingFile = false; return }
      if (off >= bytes.length) { this._send(peer, { t: 'file-end', id: msg.id }); peer.sendingFile = false; return }
      if (peer.conn.writableLength < 512 * 1024) { // si la red va lenta, se espera
        const head = Buffer.alloc(12)
        idBuf.copy(head, 0)
        head.writeUInt32BE(i++, 8)
        const part = bytes.subarray(off, off + FILES.chunk)
        peer.conn.write(encodeFrame(T_FILE, Buffer.concat([head, part])))
        off += part.length
      }
      setTimeout(step, FILES.paceMs).unref?.()
    }
    step()
  }

  _onFileChunk(peer, payload) {
    const f = peer.inFile
    if (!f || !peer.ready || !this._contact(peer.key) || payload.length < 13 || payload.length > FILES.chunk + 12) return
    if (payload.subarray(0, 8).toString('hex') !== f.id || payload.readUInt32BE(8) !== f.got) return this._failFile(peer)
    const data = payload.subarray(12)
    f.bytes += data.length
    if (f.bytes > f.size || !f.bucket.take(data.length)) return this._failFile(peer) // más de lo ofrecido, o demasiado rápido
    f.hash.update(data)
    f.parts.push(Buffer.from(data))
    f.got++
  }

  _onFileEnd(peer, m) {
    const f = peer.inFile
    if (!f || m.id !== f.id) return
    clearTimeout(f.timer)
    peer.inFile = null
    const msg = this._fileMsg(peer.key, f.id, 'them')
    if (!msg) return
    if (f.bytes === f.size && f.hash.digest('hex') === f.sha) { // coincide con lo ofrecido: se guarda cifrado
      this.fileStore.put(f.sha, Buffer.concat(f.parts))
      msg.file.state = 'ready'
    } else {
      msg.file.state = 'failed'
    }
    this.vault.save()
    this.emit('chat', { key: peer.key, incoming: false })
  }

  _onFileGone(peer) { this._failFile(peer) }

  // Datos de un archivo disponible (recibido o enviado por mí), para vista previa o para guardarlo
  getFile(key, id) {
    const msg = (this.data.chats[key] || []).find((x) => x.id === id && x.kind === 'file')
    if (!msg || !['ready', 'sent'].includes(msg.file.state)) throw new Error('El archivo no está disponible')
    const bytes = this.fileStore ? this.fileStore.get(msg.file.sha) : null
    if (!bytes) throw new Error('El archivo ya no está guardado')
    return { file: msg.file, bytes }
  }

  // ---------- Perfiles ----------
  // Tu perfil solo se entrega a tus CONTACTOS, y solo cuando lo piden. Tú solo aceptas un perfil que pediste,
  // con tamaño declarado acotado, y lo pasas por validateProfile() antes de guardarlo.

  _myRev() { return this.profiles ? this.profiles.mineRev() : null }

  // Guarda tu perfil (ya validado) y avisa a tus contactos conectados para que lo actualicen.
  setMyProfile(profile) {
    this.profiles.setMine(profile)
    const rev = this._myRev()
    for (const p of this.peers.values()) if (p.ready && this._contact(p.key)) this._send(p, { t: 'profile-new', rev: rev || undefined })
  }

  _maybeRequestProfile(peer, rev) {
    if (!this.profiles || !this._contact(peer.key) || typeof rev !== 'string' || !/^[0-9a-f]{16}$/.test(rev)) return
    if (rev === this.profiles.rev(peer.key)) return
    if (peer.inProfile) { peer.pendingRev = rev; return } // llegó una versión más nueva mientras se descarga otra
    const now = Date.now()
    // Solo se frena pedir REPETIDAMENTE la misma versión; una versión nueva se pide al instante.
    if (rev === peer.lastReqRev && now - (peer.lastProfileReq || 0) < 5000) return
    peer.lastProfileReq = now
    peer.lastReqRev = rev
    peer.wantRev = rev
    this._send(peer, { t: 'profile-req' })
  }

  _onProfileReq(peer) {
    const rev = this._myRev()
    const now = Date.now()
    if (!rev) return
    if (peer.sendingProfile) { peer.serveAgain = true; return } // ya se está enviando: se repite al terminar
    // Un contacto no puede obligarte a reenviar lo mismo sin parar: misma versión, máximo cada 10 s.
    if (rev === peer.lastServedRev && now - (peer.lastProfileServe || 0) < 10000) return
    peer.lastProfileServe = now
    peer.lastServedRev = rev
    const raw = Buffer.from(JSON.stringify(this.profiles.getMine()), 'utf8')
    const n = Math.ceil(raw.length / LIMITS.profileChunk)
    peer.sendingProfile = true
    this._send(peer, { t: 'profile-start', rev, n, size: raw.length })
    let i = 0
    const step = () => {
      if (i >= n || peer.conn.destroyed || this.peers.get(peer.key) !== peer) {
        peer.sendingProfile = false
        if (peer.serveAgain && !peer.conn.destroyed) { peer.serveAgain = false; this._onProfileReq(peer) }
        return
      }
      this._send(peer, { t: 'profile-chunk', i, d: raw.subarray(i * LIMITS.profileChunk, (i + 1) * LIMITS.profileChunk).toString('base64') })
      i++
      setTimeout(step, LIMITS.profilePaceMs).unref?.()
    }
    step()
  }

  _abortProfile(peer) {
    if (peer.inProfile) clearTimeout(peer.inProfile.timer)
    peer.inProfile = null
    peer.wantRev = null
  }

  _onProfileStart(peer, m) {
    if (!peer.wantRev || peer.inProfile || m.rev !== peer.wantRev) return
    if (!Number.isInteger(m.n) || m.n < 1 || m.n > LIMITS.profileMaxChunks) return this._abortProfile(peer)
    if (!Number.isInteger(m.size) || m.size < 1 || m.size > PROFILE_LIMITS.maxProfileBytes) return this._abortProfile(peer)
    peer.inProfile = { n: m.n, size: m.size, got: 0, bytes: 0, parts: [], timer: setTimeout(() => this._abortProfile(peer), 60000) }
    peer.inProfile.timer.unref?.()
  }

  _onProfileChunk(peer, m) {
    const ip = peer.inProfile
    if (!ip) return
    if (m.i !== ip.got || typeof m.d !== 'string' || m.d.length > 17000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.d)) return this._abortProfile(peer)
    const buf = Buffer.from(m.d, 'base64')
    ip.bytes += buf.length
    if (ip.bytes > ip.size) return this._abortProfile(peer)
    ip.parts.push(buf)
    if (++ip.got < ip.n) return
    const size = ip.size
    const bytes = ip.bytes
    const parts = ip.parts
    this._abortProfile(peer)
    if (bytes !== size) return
    try {
      const profile = validateProfile(JSON.parse(Buffer.concat(parts).toString('utf8')))
      this.profiles.set(peer.key, profile)
      this.emit('profile', { key: peer.key })
      this._presence()
    } catch { /* perfil inválido: se descarta sin avisar */ }
    const next = peer.pendingRev // si mientras tanto salió una versión más nueva, pedirla
    peer.pendingRev = null
    if (next) this._maybeRequestProfile(peer, next)
  }

  // ---------- Contactos ----------

  _contact(key) { return this.data.contacts.find((c) => c.key === key) }

  listContacts() {
    return this.data.contacts.map((c) => {
      const p = this.peers.get(c.key)
      return {
        key: c.key, name: c.name, remoteName: c.remoteName, verified: !!c.verified, online: !!(p && p.ready),
        profRev: this.profiles ? this.profiles.rev(c.key) : ''
      }
    })
  }

  addContact(code, name) {
    code = String(code || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(code)) throw new Error('Código no válido: debe tener 64 caracteres (0-9 y a-f)')
    if (code === this.code) throw new Error('Ese es tu propio código')
    if (this._contact(code)) throw new Error('Ya está en tus contactos')

    const peer = this.peers.get(code)
    this.data.contacts.push({
      key: code,
      name: clean(name, 40),
      remoteName: peer ? peer.remoteName : '',
      verified: !!(peer && peer.verified),
      addedAt: Date.now()
    })
    this.data.requests = this.data.requests.filter((r) => r.key !== code)
    this.data.blocked = this.data.blocked.filter((k) => k !== code)
    this.vault.save()
    this.swarm?.joinPeer(Buffer.from(code, 'hex')) // conectar y reconectar automáticamente
    if (peer && peer.ready) {
      // Ya estaba conectado (nos escribió primero): avisarle que ahora lo aceptamos
      // para que reenvíe lo que tenía pendiente, y enviar lo nuestro.
      this._send(peer, { t: 'hello', name: this.name, cert: this.cert || undefined, prof: this._myRev() || undefined })
      this._flushOutbox(peer)
      this._maybeRequestProfile(peer, peer.prof)
    }
    this._presence()
  }

  removeContact(key) {
    this.data.contacts = this.data.contacts.filter((c) => c.key !== key)
    const shas = (this.data.chats[key] || []).filter((m) => m.kind === 'file').map((m) => m.file.sha)
    delete this.data.chats[key]
    this._cleanFiles(shas)
    this.profiles?.delete(key)
    this.vault.save()
    this.swarm?.leavePeer(Buffer.from(key, 'hex'))
    this.peers.get(key)?.conn.destroy()
    this._presence()
  }

  acceptRequest(key) {
    const req = this.data.requests.find((r) => r.key === key)
    if (!req) throw new Error('La solicitud ya no existe')
    this.addContact(key, req.name)
  }

  rejectRequest(key) {
    this.data.requests = this.data.requests.filter((r) => r.key !== key)
    if (!this.data.blocked.includes(key)) this.data.blocked.push(key)
    if (this.data.blocked.length > LIMITS.maxBlocked) this.data.blocked.shift()
    this.vault.save()
    this.peers.get(key)?.conn.destroy()
    this._presence()
  }

  // ---------- Mensajes ----------
  // Si el contacto no está conectado, el mensaje queda "pendiente" (⏳) y se envía solo
  // cuando ambos coincidan en línea. No hay servidor que guarde mensajes por ti.

  getChat(key) { return [...(this.data.chats[key] || [])] }

  _pushMessage(key, msg, { silent = false } = {}) {
    const chat = (this.data.chats[key] ||= [])
    chat.push(msg)
    if (chat.length > config.MAX_HISTORY_PER_CHAT) chat.splice(0, chat.length - config.MAX_HISTORY_PER_CHAT)
    this.vault.save()
    this.emit('chat', { key, incoming: msg.from === 'them' && !silent })
  }

  sendMessage(key, text) {
    text = String(text || '').trim().slice(0, config.MAX_MESSAGE_LENGTH)
    if (!text) return
    if (!this._contact(key)) throw new Error('Contacto desconocido')
    const msg = { id: randomId(), from: 'me', text, ts: Date.now(), status: 'pending' }
    this._pushMessage(key, msg)
    const peer = this.peers.get(key)
    if (peer && peer.ready) this._send(peer, { t: 'msg', id: msg.id, text: msg.text })
  }

  _flushOutbox(peer) {
    let sent = 0
    for (const m of this.getChat(peer.key)) {
      if (m.from !== 'me' || m.status !== 'pending') continue
      if (sent++ >= LIMITS.flushBatch) break // el resto se envía en el próximo reintento
      if (m.kind === 'file') this._sendOffer(peer, m)
      else if (typeof m.text === 'string') this._send(peer, { t: 'msg', id: m.id, text: m.text })
    }
  }

  _onMessage(peer, m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id) || typeof m.text !== 'string') return
    const text = m.text.slice(0, config.MAX_MESSAGE_LENGTH)
    if (!text) return
    this._send(peer, { t: 'ack', id: m.id }) // confirmar recepción (aunque sea repetido)
    if ((this.data.chats[peer.key] || []).some((x) => x.id === m.id)) return
    this._pushMessage(peer.key, { id: m.id, from: 'them', text, ts: Date.now() })
  }

  _onAck(peer, m) {
    if (typeof m.id !== 'string') return
    const msg = (this.data.chats[peer.key] || []).find((x) => x.id === m.id && x.from === 'me')
    if (msg && msg.status !== 'delivered') {
      msg.status = 'delivered'
      this.vault.save()
      this.emit('chat', { key: peer.key, incoming: false })
    }
  }

  // ---------- Llamadas de audio ----------
  // El audio viaja por la misma conexión cifrada del chat (sin servidores de terceros).
  // Solo un contacto puede llamarte, y el micrófono solo se activa si TÚ contestas.

  _callSnapshot(reason) {
    if (!this.call) return { state: 'idle', reason }
    const c = this._contact(this.call.peer)
    return {
      state: this.call.state,
      peer: this.call.peer,
      name: c ? c.name || c.remoteName : '',
      startedAt: this.call.startedAt || null
    }
  }

  _emitCall() { this.emit('call', this._callSnapshot()) }

  _armRingTimer() {
    clearTimeout(this._callTimer)
    this._callTimer = setTimeout(() => this.endCall('timeout'), config.CALL_RING_TIMEOUT_MS)
  }

  // Cada lado anota la llamada en su propio chat (no se envía nada extra por la red).
  // result: ended | missed | declined | cancelled | unanswered | busy | failed
  _logCall(c, reason) {
    let result
    if (c.state === 'active') result = 'ended'
    else if (c.dir === 'out') {
      result = { busy: 'busy', remote: 'declined', local: 'cancelled', 'peer-left': 'failed' }[reason] || 'unanswered'
    } else result = reason === 'local' ? 'declined' : 'missed'
    const duration = c.state === 'active' ? Math.max(0, Math.round((Date.now() - c.startedAt) / 1000)) : 0
    this._pushMessage(c.peer, {
      id: randomId(), from: c.dir === 'out' ? 'me' : 'them', kind: 'call', ts: Date.now(),
      call: { dir: c.dir, result, duration }
    }, { silent: result !== 'missed' })
  }

  _finishCall(reason) {
    clearTimeout(this._callTimer)
    if (this.call) this._logCall(this.call, reason)
    this.call = null
    this.emit('call', this._callSnapshot(reason))
  }

  startCall(key) {
    const peer = this.peers.get(key)
    if (!peer || !peer.ready || !this._contact(key)) throw new Error('El contacto no está conectado')
    if (this.call) throw new Error('Ya hay una llamada en curso')
    this.call = { id: randomId(), peer: key, state: 'calling', dir: 'out' }
    this._send(peer, { t: 'call-invite', id: this.call.id })
    this._armRingTimer()
    this._emitCall()
  }

  acceptCall() {
    if (!this.call || this.call.state !== 'ringing') throw new Error('No hay una llamada entrante')
    clearTimeout(this._callTimer)
    this.call.state = 'active'
    this.call.startedAt = Date.now()
    this._send(this.peers.get(this.call.peer), { t: 'call-accept', id: this.call.id })
    this._emitCall()
  }

  endCall(reason = 'local') {
    if (!this.call) return
    this._send(this.peers.get(this.call.peer), {
      t: 'call-end', id: this.call.id, reason: reason === 'timeout' ? 'timeout' : 'ended'
    })
    this._finishCall(reason)
  }

  _onCallInvite(peer, m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return
    const now = Date.now()
    if (now - peer.lastInvite < LIMITS.inviteMinGapMs) return // evita el acoso con invitaciones
    peer.lastInvite = now
    if (this.call) {
      this._send(peer, { t: 'call-end', id: m.id, reason: 'busy' })
      return this._logCall({ peer: peer.key, state: 'ringing', dir: 'in' }, 'busy') // llamada perdida mientras hablabas
    }
    this.call = { id: m.id, peer: peer.key, state: 'ringing', dir: 'in' }
    this._armRingTimer()
    this._emitCall()
  }

  _onCallAccept(peer, m) {
    if (!this.call || this.call.id !== m.id || this.call.peer !== peer.key || this.call.state !== 'calling') return
    clearTimeout(this._callTimer)
    this.call.state = 'active'
    this.call.startedAt = Date.now()
    this._emitCall()
  }

  _onCallEnd(peer, m) {
    if (!this.call || this.call.id !== m.id || this.call.peer !== peer.key) return
    this._finishCall(m.reason === 'busy' ? 'busy' : m.reason === 'timeout' ? 'missed' : 'remote')
  }

  sendAudio(buf) {
    if (!this.call || this.call.state !== 'active') return
    if (buf.length === 0 || buf.length > MAX_AUDIO_FRAME) return
    const peer = this.peers.get(this.call.peer)
    if (!peer || peer.conn.destroyed) return
    if (peer.conn.writableLength > 128 * 1024) return // red lenta: descartar para no acumular retraso
    peer.conn.write(encodeFrame(T_AUDIO, buf))
  }

  _onAudio(peer, payload) {
    if (this.call && this.call.state === 'active' && this.call.peer === peer.key && peer.ready) {
      this.emit('audio', payload)
    }
  }
}

module.exports = { P2PNode, LIMITS }
