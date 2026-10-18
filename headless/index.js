#!/usr/bin/env node
'use strict'
// Uso:
//   node headless/index.js info                                  muestra el código del anfitrión
//   node headless/index.js create "Nombre" --owner <código>      crea un servidor cuyo dueño es esa persona
//   node headless/index.js list                                  lista los servidores alojados
//   node headless/index.js run                                   deja el anfitrión funcionando (24/7)
// Opciones: --data <carpeta> (por defecto ./host-data o PRIVCHAT_DATA_DIR)  --name <nombre visible>
const path = require('path')
const { createHost } = require('./host')

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined }
const cmd = args[0]
const dataDir = path.resolve(flag('data') || process.env.PRIVCHAT_DATA_DIR || './host-data')

if (!['info', 'create', 'list', 'run'].includes(cmd)) {
  console.log('Uso: node headless/index.js <info|create|list|run> [opciones]. Lee headless/README.md')
  process.exit(cmd ? 1 : 0)
}

const { vault, node } = createHost({ dataDir, name: flag('name') || 'anfitrion' })
const S = () => Object.values(vault.data.servers)

if (cmd === 'info') {
  console.log('Código del anfitrión:\n  ' + node.code)
} else if (cmd === 'list') {
  for (const s of S()) console.log(`${s.id}  ${s.name}  (${Object.keys(s.members).length} miembros)`)
  if (!S().length) console.log('No hay servidores. Crea uno con: create "Nombre" --owner <código>')
} else if (cmd === 'create') {
  const name = args[1]
  const owner = flag('owner')
  if (!name || name.startsWith('--') || !/^[0-9a-f]{64}$/.test(owner || '')) {
    console.error('Uso: create "Nombre del servidor" --owner <código de 64 caracteres del dueño>')
    process.exit(1)
  }
  const legacy = args.includes('--sin-cifrado') // solo para compatibilidad: el servidor NO tendrá cifrado de extremo a extremo
  const v = node.servers.create(name, owner, { e2ee: !legacy })
  vault.saveNow()
  const joinCode = legacy ? `psrv1.${node.code}.${v.id}.${'0'.repeat(16)}` : `psrv2.${node.code}.${v.id}.${'0'.repeat(16)}.${owner}.${'0'.repeat(32)}`
  console.log(`Servidor creado: ${v.name} (${legacy ? 'SIN cifrado de extremo a extremo' : 'cifrado de extremo a extremo: este equipo solo repite mensajes cifrados y no puede leerlos'})\n\nEl dueño debe pulsar "Unirme" en su app y pegar este código:\n  ${joinCode}\n\nDespués el dueño crea las invitaciones para los demás desde su app.`)
} else {
  const log = (m) => console.log(new Date().toISOString() + ' ' + m)
  node.on('node', (i) => { if (i.error) log('Red: ' + i.error) })
  node.start().then(() => log('Anfitrión en línea. Código: ' + node.code + ' · servidores: ' + S().length)).catch((e) => { log('No se pudo iniciar: ' + e.message); process.exit(1) })
  setInterval(() => log(`Estado: ${node.nodeInfo().connected} conexiones, ${S().length} servidores`), 10 * 60 * 1000).unref()
  const stop = async () => { log('Cerrando…'); try { await node.stop() } catch {} vault.saveNow(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
if (cmd !== 'run') { vault.saveNow(); process.exit(0) }
