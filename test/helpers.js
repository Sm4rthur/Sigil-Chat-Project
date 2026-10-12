'use strict'
// Red falsa y utilidades para probar sin internet ni Electron.
const crypto = require('crypto')
const EventEmitter = require('events')
const { Duplex } = require('stream')
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')

class FakeDHT {
  constructor(opts) { this.ephemeral = !!opts.ephemeral }
  static keyPair(seed) { return { publicKey: crypto.createHash('sha256').update(seed).digest(), secretKey: seed } }
  async destroy() {}
}
class FakeSwarm extends EventEmitter {
  constructor({ keyPair }) { super(); this.keyPair = keyPair; this.wanted = new Set() }
  async listen() {}
  joinPeer(pk) { this.wanted.add(pk.toString('hex')) }
  leavePeer(pk) { this.wanted.delete(pk.toString('hex')) }
  async destroy() {}
}
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'hyperswarm') return FakeSwarm
  if (request === 'hyperdht') return FakeDHT
  return realLoad.call(this, request, ...rest)
}

const { P2PNode } = require('../src/network')
const { Vault, ProfileStore } = require('../src/storage')
const { randomKey } = require('../src/crypto')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privchat-net-'))
const allNodes = []
const sleep = (ms = 30) => new Promise((r) => setTimeout(r, ms))

async function makeNode(name, { cert } = {}) {
  const dir = path.join(tmp, name.replace(/[^a-z0-9]/gi, '_') + allNodes.length)
  const key = randomKey()
  const vault = new Vault(dir, key)
  vault.load()
  const profiles = new ProfileStore(dir, key)
  const node = new P2PNode({ seed: Buffer.from(vault.data.identitySeed, 'base64'), name, vault, nodeMode: true, cert, profiles })
  await node.start()
  allNodes.push(node)
  return node
}

// Conecta dos nodos como lo haría Hyperswarm. Devuelve las dos puntas.
function connect(a, b) {
  const sa = new Duplex({ read() {}, write(chunk, _e, cb) { sb.push(chunk); cb() } })
  const sb = new Duplex({ read() {}, write(chunk, _e, cb) { sa.push(chunk); cb() } })
  sa.on('close', () => sb.destroy())
  sb.on('close', () => sa.destroy())
  sa.remotePublicKey = b.keyPair.publicKey
  sb.remotePublicKey = a.keyPair.publicKey
  a.swarm.emit('connection', sa, {})
  b.swarm.emit('connection', sb, {})
  return [sa, sb]
}

async function finish(msg) {
  for (const n of allNodes) await n.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(msg)
  process.exit(0)
}

module.exports = { makeNode, connect, sleep, finish }
