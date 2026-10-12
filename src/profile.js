'use strict'
// Perfil social: foto, estado y una "página personal" tipo blog hecha de bloques (texto e imágenes).
//
// SEGURIDAD: el perfil de OTRA persona es contenido no confiable que se dibuja en tu pantalla.
// validateProfile() es la única puerta de entrada: reconstruye el perfil desde cero aceptando solo
// valores conocidos (fuentes de una lista, colores #rrggbb, números acotados, imágenes PNG/JPEG/WebP
// verificadas por su cabecera y tamaño). Nada de HTML, CSS libre, SVG ni enlaces.
const crypto = require('crypto')

const PAGE_W = 800
const FONTS = new Set(['sans', 'serif', 'mono', 'cursive', 'impact', 'verdana', 'georgia', 'trebuchet'])
const ALIGNS = new Set(['left', 'center', 'right'])
const FITS = new Set(['cover', 'contain'])
const LIMITS = {
  maxBlocks: 30,
  maxText: 2000,
  maxStatus: 80,
  maxImageBytes: 400 * 1024,
  maxImagesTotal: 1536 * 1024,
  maxAvatarBytes: 200 * 1024,   // incluye avatares animados
  maxFrames: 300,               // fotogramas máximos de una imagen animada
  maxAnimatedPixels: 50e6,      // ancho x alto x fotogramas: evita animaciones que agotan la memoria
  maxFonts: 4,
  maxFontBytes: 300 * 1024,
  maxDim: 2400,
  maxAvatarDim: 512,
  minHeight: 200,
  maxHeight: 3000,
  maxProfileBytes: 5 * 1024 * 1024
}

// ---------- Imágenes ----------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// PNG: se recorren los bloques para comprobar que la estructura es coherente (IHDR primero, IEND al final,
// largos que cuadran). 'acTL' indica un PNG animado (APNG).
function pngInfo(buf) {
  if (buf.length < 57 || !buf.subarray(0, 8).equals(PNG_SIG)) return null
  let off = 8, width = 0, height = 0, frames = 1, animated = false, idat = false, first = true
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (len > buf.length - off - 12) return null
    if (first) {
      if (type !== 'IHDR' || len !== 13) return null
      width = buf.readUInt32BE(off + 8); height = buf.readUInt32BE(off + 12); first = false
    } else if (type === 'acTL') {
      if (idat || len !== 8) return null
      frames = buf.readUInt32BE(off + 8); animated = true
    } else if (type === 'IDAT') idat = true
    off += 12 + len
    if (type === 'IEND') return off === buf.length && idat ? { type: 'png', width, height, animated, frames } : null
  }
  return null
}

// WebP: se recorren los bloques RIFF; el bit de animación está en VP8X y cada fotograma es un ANMF.
function webpInfo(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  if (buf.readUInt32LE(4) + 8 > buf.length) return null
  let off = 12, width = 0, height = 0, animated = false, frames = 0, got = false
  while (off + 8 <= buf.length) {
    const type = buf.toString('latin1', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (body + size > buf.length) return null
    if (type === 'VP8X') {
      if (size < 10) return null
      animated = (buf[body] & 0x02) !== 0
      width = 1 + buf.readUIntLE(body + 4, 3); height = 1 + buf.readUIntLE(body + 7, 3); got = true
    } else if (type === 'VP8 ' && !got && size >= 10) {
      width = buf.readUInt16LE(body + 6) & 0x3fff; height = buf.readUInt16LE(body + 8) & 0x3fff; got = true
    } else if (type === 'VP8L' && !got && size >= 5) {
      const v = buf.readUInt32LE(body + 1)
      width = (v & 0x3fff) + 1; height = ((v >> 14) & 0x3fff) + 1; got = true
    } else if (type === 'ANMF') frames++
    off = body + size + (size & 1)
  }
  return got ? { type: 'webp', width, height, animated, frames: animated ? frames : 1 } : null
}

// Lee tipo, dimensiones y si es animada SIN decodificar la imagen (así no hay "bombas" de píxeles). null si no es válida.
function imageInfo(buf) {
  try {
    if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) return pngInfo(buf)
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        if (marker === 0xff) { i++; continue }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), animated: false, frames: 1 }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
      return null
    }
    if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF') return webpInfo(buf)
  } catch { /* cabecera truncada */ }
  return null
}

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

// Devuelve la imagen normalizada (data URL) y su tamaño, o lanza error. '' = sin imagen.
function checkImage(value, maxBytes, maxDim) {
  if (value === undefined || value === null || value === '') return { url: '', bytes: 0 }
  if (typeof value !== 'string' || value.length > maxBytes * 1.4 + 64) throw new Error('Imagen demasiado grande')
  const m = DATA_URL.exec(value)
  if (!m) throw new Error('Formato de imagen no permitido (solo PNG, JPG o WebP)')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > maxBytes) throw new Error('Imagen demasiado grande')
  const info = imageInfo(buf)
  if (!info || info.type !== m[1].replace('jpg', 'jpeg')) throw new Error('El archivo no es una imagen válida')
  if (!(info.width >= 1 && info.height >= 1 && info.width <= maxDim && info.height <= maxDim)) {
    throw new Error('Las dimensiones de la imagen no son válidas')
  }
  if (info.animated && (!(info.frames >= 1 && info.frames <= LIMITS.maxFrames) || info.width * info.height * info.frames > LIMITS.maxAnimatedPixels)) {
    throw new Error('La animación es demasiado grande (demasiados fotogramas o píxeles)')
  }
  return { url: `data:image/${m[1]};base64,${m[2]}`, bytes: buf.length }
}

// ---------- Fuentes propias ----------
// Una fuente es un archivo que el navegador interpreta; por eso solo se aceptan formatos conocidos,
// con la firma correcta, tamaño acotado y como máximo 4 por perfil. En pantalla solo se cargan si TÚ aceptas.
const FONT_FORMATS = {
  woff2: (b) => b.toString('latin1', 0, 4) === 'wOF2',
  woff: (b) => b.toString('latin1', 0, 4) === 'wOFF',
  ttf: (b) => (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || b.toString('latin1', 0, 4) === 'true',
  otf: (b) => b.toString('latin1', 0, 4) === 'OTTO'
}

function checkFont(f) {
  if (!f || typeof f !== 'object' || typeof f.data !== 'string' || !FONT_FORMATS[f.fmt]) return null
  if (typeof f.id !== 'string' || !/^[a-z0-9]{1,8}$/.test(f.id)) return null
  if (f.data.length > LIMITS.maxFontBytes * 1.4 + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) throw new Error('Fuente demasiado grande o no válida')
  const buf = Buffer.from(f.data, 'base64')
  if (buf.length < 64 || buf.length > LIMITS.maxFontBytes) throw new Error('Fuente demasiado grande o no válida')
  if (!FONT_FORMATS[f.fmt](buf)) throw new Error('El archivo no es una fuente ' + f.fmt.toUpperCase() + ' válida')
  return { id: f.id, name: text(f.name, 40).replace(/\n/g, ' ').trim() || 'Fuente', fmt: f.fmt, data: f.data, bytes: buf.length }
}

// ---------- Campos simples ----------

const int = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def)
const flt = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : def)
const COLOR = /^#[0-9a-f]{6}$/
const color = (v, def) => (typeof v === 'string' && COLOR.test(v.toLowerCase()) ? v.toLowerCase() : def)
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g
const text = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, '').slice(0, max) : '')

function emptyProfile() {
  return { v: 1, status: '', avatar: '', avatarCrop: { zoom: 1, x: 0, y: 0 }, nameFont: '', fonts: [], page: { height: 600, bg: { color: '#ffffff', image: '', fit: 'cover' }, blocks: [] } }
}

function isEmptyProfile(p) {
  return !p.avatar && !p.status && !p.nameFont && p.fonts.length === 0 && !p.page.bg.image && p.page.blocks.length === 0 && p.page.bg.color === '#ffffff'
}

function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Perfil no válido')
  const page = input.page && typeof input.page === 'object' ? input.page : {}
  const height = int(page.height, LIMITS.minHeight, LIMITS.maxHeight, 600)
  let imageBytes = 0

  const avatar = checkImage(input.avatar, LIMITS.maxAvatarBytes, LIMITS.maxAvatarDim).url
  // Recorte de la foto: acercamiento y desplazamiento (en % del círculo), siempre dentro de lo que cubre la imagen
  const crop = input.avatarCrop && typeof input.avatarCrop === 'object' ? input.avatarCrop : {}
  const zoom = flt(crop.zoom, 1, 4, 1)
  const lim = (zoom - 1) * 50
  const avatarCrop = { zoom, x: flt(crop.x, -lim, lim, 0), y: flt(crop.y, -lim, lim, 0) }

  const fonts = []
  for (const f of (Array.isArray(input.fonts) ? input.fonts : []).slice(0, LIMITS.maxFonts)) {
    const ok = checkFont(f)
    if (ok && !fonts.some((x) => x.id === ok.id)) fonts.push(ok)
  }
  const fontIds = new Set(fonts.map((f) => f.id))
  const fontKey = (v) => (FONTS.has(v) ? v : typeof v === 'string' && v.startsWith('f:') && fontIds.has(v.slice(2)) ? v : null)
  const bgIn = page.bg && typeof page.bg === 'object' ? page.bg : {}
  const bgImg = checkImage(bgIn.image, LIMITS.maxImageBytes, LIMITS.maxDim)
  imageBytes += bgImg.bytes

  const blocks = []
  const seen = new Set()
  const list = Array.isArray(page.blocks) ? page.blocks.slice(0, LIMITS.maxBlocks) : []
  for (const b of list) {
    if (!b || typeof b !== 'object' || (b.type !== 'text' && b.type !== 'image')) continue
    let id = typeof b.id === 'string' ? b.id.replace(/[^a-z0-9]/g, '').slice(0, 16) : ''
    if (!id || seen.has(id)) id = crypto.randomBytes(4).toString('hex')
    seen.add(id)
    const box = {
      id, type: b.type,
      x: int(b.x, 0, PAGE_W - 20, 0), y: int(b.y, 0, height - 20, 0),
      w: int(b.w, 20, PAGE_W, 200), h: int(b.h, 20, LIMITS.maxHeight, 100),
      z: int(b.z, 0, 999, 0),
      rot: int(b.rot, -180, 180, 0) // rotación libre en grados
    }
    if (b.type === 'text') {
      blocks.push({
        ...box,
        text: text(b.text, LIMITS.maxText),
        font: fontKey(b.font) || 'sans',
        size: int(b.size, 8, 96, 20),
        color: color(b.color, '#222222'),
        bg: b.bg === '' || b.bg === undefined ? '' : color(b.bg, ''),
        bold: b.bold === true,
        italic: b.italic === true,
        align: ALIGNS.has(b.align) ? b.align : 'left'
      })
    } else {
      const img = checkImage(b.src, LIMITS.maxImageBytes, LIMITS.maxDim)
      if (!img.url) continue
      imageBytes += img.bytes
      blocks.push({ ...box, src: img.url, fit: FITS.has(b.fit) ? b.fit : 'cover', radius: int(b.radius, 0, 50, 0) })
    }
  }
  if (imageBytes > LIMITS.maxImagesTotal) throw new Error('Las imágenes de la página pesan demasiado (máximo 1,5 MB en total)')

  const out = {
    v: 1,
    status: text(input.status, LIMITS.maxStatus).replace(/\n/g, ' '),
    avatar,
    avatarCrop,
    nameFont: fontKey(input.nameFont) || '',
    fonts: fonts.map(({ id, name, fmt, data }) => ({ id, name, fmt, data })),
    page: { height, bg: { color: color(bgIn.color, '#ffffff'), image: bgImg.url, fit: FITS.has(bgIn.fit) ? bgIn.fit : 'cover' }, blocks }
  }
  if (Buffer.byteLength(JSON.stringify(out)) > LIMITS.maxProfileBytes) throw new Error('El perfil es demasiado grande')
  return out
}

// Identificador corto del contenido: sirve para saber si un contacto tiene la versión más reciente.
const profileRev = (p) => crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 16)

module.exports = { PAGE_W, FONTS, LIMITS, imageInfo, pngInfo, webpInfo, validateProfile, emptyProfile, isEmptyProfile, profileRev }
