'use strict'
// Apariencia: tema automático, claro, oscuro, gris o personalizado (colores, foto de fondo y efecto cristal).
// Se guarda en este equipo (localStorage) y se aplica antes de iniciar sesión.
// SEGURIDAD: todo valor se valida (colores #rrggbb, imagen PNG/JPEG/WebP en data URL, números acotados)
// y solo se aplica con propiedades CSS; nada de HTML.
const ThemeUI = (() => {
  const KEY = 'privchat-theme'
  const MODES = ['auto', 'light', 'dark', 'gray', 'custom']
  const DEFAULT_CUSTOM = { bg: '#1b1f24', panel: '#252a31', ink: '#eef1f5', line: '#3a424d', accent: '#4fb89f', image: '', glass: false, opacity: 70 }
  const HEX = /^#[0-9a-f]{6}$/i
  const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
  const MAX_IMAGE = 2 * 1024 * 1024
  const byId = (id) => document.getElementById(id)

  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d)

  function normalize(t) {
    const c = t && typeof t.custom === 'object' && t.custom ? t.custom : {}
    const opacity = Number.isFinite(c.opacity) ? Math.min(100, Math.max(20, Math.round(c.opacity))) : DEFAULT_CUSTOM.opacity
    return {
      mode: t && MODES.includes(t.mode) ? t.mode : 'auto',
      custom: {
        bg: hex(c.bg, DEFAULT_CUSTOM.bg), panel: hex(c.panel, DEFAULT_CUSTOM.panel), ink: hex(c.ink, DEFAULT_CUSTOM.ink),
        line: hex(c.line, DEFAULT_CUSTOM.line), accent: hex(c.accent, DEFAULT_CUSTOM.accent),
        image: typeof c.image === 'string' && c.image.length <= MAX_IMAGE * 1.4 && IMG.test(c.image) ? c.image : '',
        glass: c.glass === true, opacity
      }
    }
  }

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))) } catch { return normalize(null) }
  }
  function save(t) {
    try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* sin almacenamiento: el tema dura hasta cerrar */ }
  }

  // ---------- Color ----------
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
  const mix = (a, b, w) => { const x = rgb(a); const y = rgb(b); return toHex(x.map((v, i) => v * w + y[i] * (1 - w))) }
  const rgba = (h, alpha) => 'rgba(' + rgb(h).join(',') + ',' + alpha + ')'
  function luminance(h) {
    const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => { const la = luminance(a); const lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }

  const VARS = ['--bg', '--panel', '--ink', '--muted', '--line', '--accent', '--accent-ink', '--mine', '--theirs', '--bgimg']

  function apply(t) {
    const root = document.documentElement
    root.dataset.theme = t.mode
    for (const v of VARS) root.style.removeProperty(v)
    delete root.dataset.glass
    delete root.dataset.bgimg
    if (t.mode !== 'custom') return
    const c = t.custom
    root.style.setProperty('--bg', c.bg)
    root.style.setProperty('--panel', c.glass ? rgba(c.panel, c.opacity / 100) : c.panel)
    root.style.setProperty('--ink', c.ink)
    root.style.setProperty('--muted', mix(c.ink, c.bg, 0.6))
    root.style.setProperty('--line', c.line)
    root.style.setProperty('--accent', c.accent)
    root.style.setProperty('--accent-ink', luminance(c.accent) > 0.45 ? '#111111' : '#ffffff')
    root.style.setProperty('--mine', mix(c.accent, c.panel, 0.28))
    root.style.setProperty('--theirs', mix(c.ink, c.panel, 0.1))
    if (c.image) { root.style.setProperty('--bgimg', 'url("' + c.image + '")'); root.dataset.bgimg = '1' }
    if (c.glass) root.dataset.glass = '1'
  }

  // ---------- Imagen de fondo: se reduce en tu equipo ----------
  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('No se pudo leer el archivo'))
    r.readAsDataURL(file)
  })
  const loadImage = (src) => new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('No se pudo abrir la imagen'))
    i.src = src
  })
  async function backgroundFromFile(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Usa una imagen PNG, JPG o WebP')
    if (file.size > 20 * 1024 * 1024) throw new Error('La imagen es demasiado pesada (máximo 20 MB)')
    const img = await loadImage(await readAsDataUrl(file))
    let scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight))
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const q of [0.8, 0.65, 0.5]) {
        const url = canvas.toDataURL('image/webp', q)
        if (url.startsWith('data:image/webp') && url.length <= 1.5 * 1024 * 1024) return url
      }
      scale *= 0.75
    }
    throw new Error('No se pudo reducir la imagen lo suficiente')
  }

  // ---------- Ventana de apariencia ----------
  let current = load()

  function renderDialog() {
    byId('th-mode').value = current.mode
    byId('th-custom').hidden = current.mode !== 'custom'
    const c = current.custom
    for (const [id, key] of [['th-bg', 'bg'], ['th-panel', 'panel'], ['th-ink', 'ink'], ['th-line', 'line'], ['th-accent', 'accent']]) byId(id).value = c[key]
    byId('th-glass').checked = c.glass
    byId('th-opacity').value = String(c.opacity)
    byId('th-opacity').disabled = !c.glass
    byId('th-image-clear').disabled = !c.image
    const worst = Math.min(contrast(c.ink, c.bg), contrast(c.ink, c.panel))
    byId('th-contrast').textContent = worst < 4.5 ? 'Poco contraste entre la letra y el fondo: el texto puede ser difícil de leer.' : ''
  }

  function change(fn) {
    fn(current)
    current = normalize(current)
    save(current)
    apply(current)
    renderDialog()
  }

  function bind() {
    byId('th-mode').onchange = (e) => change((t) => { t.mode = e.target.value })
    for (const [id, key] of [['th-bg', 'bg'], ['th-panel', 'panel'], ['th-ink', 'ink'], ['th-line', 'line'], ['th-accent', 'accent']]) {
      byId(id).oninput = (e) => change((t) => { t.custom[key] = e.target.value })
    }
    byId('th-glass').onchange = (e) => change((t) => { t.custom.glass = e.target.checked })
    byId('th-opacity').oninput = (e) => change((t) => { t.custom.opacity = Number(e.target.value) })
    byId('th-image').onclick = () => {
      const input = byId('th-file')
      input.value = ''
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) return
        try {
          const url = await backgroundFromFile(file)
          byId('th-msg').textContent = ''
          change((t) => { t.mode = 'custom'; t.custom.image = url })
        } catch (err) { byId('th-msg').textContent = err.message }
      }
      input.click()
    }
    byId('th-image-clear').onclick = () => change((t) => { t.custom.image = '' })
    byId('th-reset').onclick = () => change((t) => { t.custom = { ...DEFAULT_CUSTOM } })
    byId('th-close').onclick = () => byId('theme-dialog').close()
  }

  function open() { renderDialog(); byId('th-msg').textContent = ''; byId('theme-dialog').showModal() }

  function init() { bind(); apply(current) }

  apply(current) // se aplica de inmediato para evitar parpadeos
  return { init, open, normalize, contrast }
})()
