'use strict'
// Anfitrión SIN pantalla para servidores 24/7 (Raspberry Pi u otro equipo siempre encendido).
// Reutiliza la misma red y la misma lógica de servidores que la app de escritorio, pero sin Electron.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Vault } = require('../src/storage')
const { P2PNode } = require('../src/network')

// La clave que cifra los datos debe estar disponible sin que nadie escriba una contraseña.
// Opción segura: pasarla por la variable PRIVCHAT_HOST_KEY (64 caracteres hex) desde el servicio del sistema.
// Si no, se crea host.key (permisos 600) junto a los datos: protege de curiosos, no de quien robe todo el disco.
function loadKey(dataDir, hostKey) {
  const fromEnv = hostKey || process.env.PRIVCHAT_HOST_KEY
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv)) throw new Error('PRIVCHAT_HOST_KEY debe tener 64 caracteres hexadecimales')
    return Buffer.from(fromEnv, 'hex')
  }
  const file = path.join(dataDir, 'host.key')
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
  if (key.length !== 32) throw new Error('host.key está dañado')
  return key
}

function createHost({ dataDir, name = 'anfitrion', hostKey } = {}) {
  if (!dataDir) throw new Error('Falta la carpeta de datos (--data)')
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const vault = new Vault(dataDir, loadKey(dataDir, hostKey))
  vault.load()
  vault.data.settings.acceptRequests = false // un anfitrión no atiende chats: solo servidores
  vault.data.settings.nodeMode = true
  const node = new P2PNode({ seed: Buffer.from(vault.data.identitySeed, 'base64'), name, vault, nodeMode: true })
  return { vault, node }
}

module.exports = { createHost }
