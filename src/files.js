'use strict'
// Archivos compartidos: límites, nombres seguros, tipos peligrosos y vista previa.
//
// REGLAS DE SEGURIDAD
//  - Nadie recibe un archivo sin aceptarlo: primero llega una "oferta" y el receptor decide si descargarla.
//  - Límite de peso por archivo y de espacio total. Todo se guarda cifrado.
//  - La app NUNCA abre ni ejecuta un archivo recibido. Solo se puede "Guardar como…" (decisión del usuario).
//  - Vista previa solo de imágenes verificadas (PNG, JPEG, WebP) y de texto plano; todo lo demás, solo ficha.
const { imageInfo } = require('./profile')

const FILES = {
  maxBytes: 10 * 1024 * 1024,        // por archivo
  maxStorage: 500 * 1024 * 1024,     // total por cuenta
  maxOffered: 20,                    // ofertas sin responder por chat
  chunk: 32 * 1024,
  paceMs: 4,
  recvBurst: 1024 * 1024,            // velocidad máxima de recepción (bytes)
  recvPerSec: 6 * 1024 * 1024,
  timeoutMs: 180000,
  maxPreviewImage: 5 * 1024 * 1024,
  maxImageDim: 4096,
  textPreviewBytes: 4000
}

const DANGEROUS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'jar', 'lnk', 'reg', 'dll', 'sys', 'hta', 'cpl', 'msc', 'apk', 'app', 'dmg', 'pkg', 'sh', 'run', 'bin', 'docm', 'xlsm', 'pptm', 'iso', 'img', 'url', 'appx', 'msix', 'inf', 'scf', 'gadget'])
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MIMES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', log: 'text/plain',
  pdf: 'application/pdf', zip: 'application/zip', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet'
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

// Nombre seguro: sin rutas, sin caracteres de control ni de inversión de texto, sin nombres reservados de Windows.
function sanitizeName(raw) {
  let n = typeof raw === 'string' ? raw : ''
  n = n.split(/[\\/]/).pop()
  n = n.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '')
  if (!n) n = 'archivo'
  if (RESERVED.test(n.split('.')[0])) n = '_' + n
  if (n.length > 120) { const e = extOf(n); n = n.slice(0, 110) + (e ? '.' + e.slice(0, 8) : '') }
  return n
}

// Tipos que pueden ejecutar código, o doble extensión que intenta disfrazarlos (foto.jpg.exe)
const isDangerous = (name) => DANGEROUS.has(extOf(name)) || /\.[a-z0-9]{1,5}\.(exe|scr|bat|cmd|com|js|vbs|ps1|msi|jar)$/i.test(name)
const mimeFor = (name) => MIMES[extOf(name)] || 'application/octet-stream'

const TEXT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

function previewOf(name, bytes) {
  const ext = extOf(name)
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const info = bytes.length <= FILES.maxPreviewImage ? imageInfo(bytes) : null
    const want = ext === 'jpg' ? 'jpeg' : ext
    if (info && info.type === want && info.width <= FILES.maxImageDim && info.height <= FILES.maxImageDim) {
      return { kind: 'image', url: 'data:image/' + info.type + ';base64,' + bytes.toString('base64'), width: info.width, height: info.height }
    }
    return { kind: 'none' } // dice ser imagen pero no lo es (o es enorme): no se muestra
  }
  if (['txt', 'md', 'csv', 'log', 'json'].includes(ext)) {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(0, FILES.textPreviewBytes)).replace(TEXT_CONTROL, '')
    return { kind: 'text', text, truncated: bytes.length > FILES.textPreviewBytes }
  }
  return { kind: 'none' }
}

module.exports = { FILES, sanitizeName, isDangerous, mimeFor, previewOf }
