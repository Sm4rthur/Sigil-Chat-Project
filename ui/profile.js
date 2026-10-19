'use strict'
// Perfil social en pantalla: ver el perfil de un contacto y editar el propio (página tipo blog).
// SEGURIDAD: el contenido de otras personas SOLO se dibuja con textContent y con propiedades de estilo
// de una lista cerrada (el programa principal ya lo validó). Nunca se inserta HTML.
const ProfileUI = (() => {
  const PAGE_W = 800
  const FONT_STACKS = {
    sans: 'system-ui, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Courier New", Consolas, monospace',
    cursive: '"Comic Sans MS", "Brush Script MT", cursive',
    impact: 'Impact, "Arial Black", sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    georgia: 'Georgia, serif',
    trebuchet: '"Trebuchet MS", sans-serif'
  }
  const FONT_LABELS = {
    sans: 'Sans-serif', serif: 'Serif', mono: 'Monoespaciada', cursive: 'Manuscrita',
    impact: 'Impact', verdana: 'Verdana', georgia: 'Georgia', trebuchet: 'Trebuchet'
  }

  const byId = (id) => document.getElementById(id)
  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  let rpc = null
  let toast = () => {}
  let getMe = () => null
  let onSaved = () => {}

  // Foto de perfil, o la inicial del nombre si no hay foto.
  function applyCrop(img, crop) {
    if (crop && (crop.zoom !== 1 || crop.x || crop.y)) img.style.transform = 'translate(' + crop.x + '%, ' + crop.y + '%) scale(' + crop.zoom + ')'
  }

  function avatarEl(src, name, size = '', crop = null) {
    const box = el('span', 'avatar ' + size)
    if (src) {
      const img = document.createElement('img')
      img.alt = ''
      img.src = src
      applyCrop(img, crop)
      box.append(img)
    } else {
      box.textContent = String(name || '?').trim().charAt(0).toUpperCase() || '?'
    }
    return box
  }

  const isEmpty = (p) => !p || (!p.avatar && !p.status && !(p.fonts || []).length && !p.page.bg.image && p.page.bg.color === '#ffffff' && p.page.blocks.length === 0)

  // ---------- Fuentes propias ----------
  // Se cargan con FontFace desde los bytes (sin pedir nada a internet). Las de otras personas, solo si el usuario acepta.
  let famMap = {}            // id de fuente -> nombre de familia cargada (del perfil que se está mostrando)
  const loadedFaces = new Map()

  const bytesFromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  function b64FromBytes(bytes) {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }

  async function loadFonts(scope, fonts) {
    const map = {}
    for (const f of fonts || []) {
      const family = 'pf' + scope + f.id
      if (!loadedFaces.has(family)) {
        try {
          const face = new FontFace(family, bytesFromB64(f.data))
          await face.load()
          document.fonts.add(face)
          loadedFaces.set(family, face)
        } catch { toast('No se pudo cargar la fuente "' + f.name + '"'); continue }
      }
      map[f.id] = family
    }
    return map
  }

  function fontStack(key) {
    if (typeof key === 'string' && key.startsWith('f:')) {
      const fam = famMap[key.slice(2)]
      return fam ? '"' + fam + '", ' + FONT_STACKS.sans : FONT_STACKS.sans
    }
    return FONT_STACKS[key] || FONT_STACKS.sans
  }

  // ---------- Dibujo de la página ----------

  function styleBlock(node, b) {
    node.style.left = b.x + 'px'
    node.style.top = b.y + 'px'
    node.style.width = b.w + 'px'
    node.style.height = b.h + 'px'
    node.style.zIndex = String(b.z)
    node.style.transform = b.rot ? 'rotate(' + b.rot + 'deg)' : ''
    if (b.type === 'text') {
      node.style.fontFamily = fontStack(b.font)
      node.style.fontSize = b.size + 'px'
      node.style.color = b.color
      node.style.fontWeight = b.bold ? '700' : '400'
      node.style.fontStyle = b.italic ? 'italic' : 'normal'
      node.style.textAlign = b.align
      node.style.backgroundColor = b.bg || 'transparent'
      node.style.whiteSpace = 'pre-wrap'
      node.style.overflowWrap = 'anywhere'
      node.style.padding = '6px'
    } else {
      node.style.borderRadius = b.radius + '%'
      const img = node.querySelector('img')
      if (img) img.style.objectFit = b.fit
    }
  }

  // Dibuja la página dentro de 'host'. Con hooks (editor) permite seleccionar, mover y cambiar tamaño.
  function renderPage(host, page, hooks = null) {
    host.replaceChildren()
    const scale = Math.min(1, (host.clientWidth || PAGE_W) / PAGE_W)
    const stage = el('div', 'page')
    stage.style.width = PAGE_W + 'px'
    stage.style.height = page.height + 'px'
    stage.style.transform = 'scale(' + scale + ')'
    stage.style.backgroundColor = page.bg.color
    if (page.bg.image) {
      stage.style.backgroundImage = 'url("' + page.bg.image + '")' // data URL ya validado (solo base64)
      stage.style.backgroundSize = page.bg.fit
      stage.style.backgroundPosition = 'center'
      stage.style.backgroundRepeat = 'no-repeat'
    }
    host.style.height = Math.round(page.height * scale) + 'px'
    host.style.backgroundColor = page.bg.color

    const nodes = new Map()
    for (const b of page.blocks) {
      const node = el('div', 'block')
      if (b.type === 'text') node.append(el('span', 't', b.text))
      else {
        const img = document.createElement('img')
        img.alt = ''
        img.draggable = false
        img.src = b.src
        node.append(img)
      }
      styleBlock(node, b)
      nodes.set(b.id, node)
      if (hooks) attachEditing(node, b, scale, hooks)
      stage.append(node)
    }
    if (hooks) stage.addEventListener('pointerdown', (e) => { if (e.target === stage) hooks.onSelect(null) })
    host.append(stage)
    return nodes
  }

  // Arrastrar para mover, y esquina inferior derecha para cambiar el tamaño.
  function attachEditing(node, b, scale, hooks) {
    const handle = el('span', 'handle')
    handle.title = 'Cambiar tamaño'
    const rotHandle = el('span', 'rothandle')
    rotHandle.title = 'Girar (mantén Mayús para saltos de 15°)'
    node.append(handle, rotHandle)

    const drag = (e, mode) => {
      e.preventDefault()
      e.stopPropagation()
      hooks.onSelect(b.id)
      const sx = e.clientX, sy = e.clientY
      const start = { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot || 0 }
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      const rect = node.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const a0 = Math.atan2(sy - cy, sx - cx)
      const rad = start.rot * Math.PI / 180
      const move = (ev) => {
        const dx = Math.round((ev.clientX - sx) / scale)
        const dy = Math.round((ev.clientY - sy) / scale)
        if (mode === 'move') {
          b.x = Math.min(PAGE_W - 20, Math.max(0, start.x + dx))
          b.y = Math.max(0, start.y + dy)
        } else if (mode === 'resize') { // con el elemento girado, el cambio se mide sobre sus propios ejes
          const lx = dx * Math.cos(rad) + dy * Math.sin(rad)
          const ly = -dx * Math.sin(rad) + dy * Math.cos(rad)
          b.w = Math.min(PAGE_W, Math.max(20, Math.round(start.w + lx)))
          b.h = Math.min(3000, Math.max(20, Math.round(start.h + ly)))
        } else {
          let r = start.rot + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI
          r = ((((r + 180) % 360) + 360) % 360) - 180
          if (ev.shiftKey) r = Math.round(r / 15) * 15
          b.rot = Math.max(-180, Math.min(180, Math.round(r)))
        }
        styleBlock(node, b)
      }
      const up = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        hooks.onChange()
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
    }
    node.addEventListener('pointerdown', (e) => { if (e.target !== handle && e.target !== rotHandle) drag(e, 'move') })
    handle.addEventListener('pointerdown', (e) => drag(e, 'resize'))
    rotHandle.addEventListener('pointerdown', (e) => drag(e, 'rotate'))
  }

  // ---------- Ver un perfil ----------

  async function view({ key, name, verified, isMe }) {
    const dialog = byId('profile-dialog')
    const nameHeading = byId('pv-name')
    nameHeading.textContent = name
    if (verified) nameHeading.append(IconUI.labeled('check', 'Nombre registrado', 16))
    byId('pv-name').style.fontFamily = ''
    byId('pv-status').textContent = ''
    byId('pv-avatar').replaceChildren(avatarEl('', name, 'big'))
    byId('pv-page').replaceChildren()
    byId('pv-page').style.height = '0px'
    byId('pv-empty').hidden = true
    byId('pv-fonts').hidden = true
    byId('pv-edit').hidden = !isMe
    famMap = {}
    if (!dialog.open) dialog.showModal()
    let profile = null
    let consent = null
    try { ({ profile, consent } = await rpc('profile-get', { key })) } catch (err) { toast(err.message) }
    if (isEmpty(profile)) {
      byId('pv-empty').textContent = isMe ? 'Aún no has creado tu perfil. Pulsa "Editar mi perfil".' : 'Esta persona aún no ha creado su perfil (o todavía no se ha sincronizado).'
      byId('pv-empty').hidden = false
      return
    }

    const draw = () => {
      byId('pv-avatar').replaceChildren(avatarEl(profile.avatar, name, 'big', profile.avatarCrop))
      byId('pv-status').textContent = profile.status
      byId('pv-name').style.fontFamily = fontStack(profile.nameFont)
      renderPage(byId('pv-page'), profile.page)
    }

    const scope = isMe ? 'me' : key.slice(0, 8)
    if (profile.fonts.length && consent === true) famMap = await loadFonts(scope, profile.fonts)
    draw()

    // Fuentes personalizadas de otra persona: se pregunta antes de cargarlas.
    if (profile.fonts.length && consent !== true) {
      const names = profile.fonts.map((f) => f.name).join(', ')
      const kb = Math.round(profile.fonts.reduce((n, f) => n + f.data.length * 0.75, 0) / 1024)
      byId('pv-fonts-text').textContent = consent === false
        ? 'Este perfil usa fuentes personalizadas (' + names + ') que no cargaste.'
        : name + ' usa fuentes personalizadas (' + names + ', ~' + kb + ' KB). ¿Quieres descargarlas para ver su perfil como lo diseñó?'
      byId('pv-fonts-yes').textContent = consent === false ? 'Cargar fuentes' : 'Descargar y usar'
      byId('pv-fonts-no').hidden = consent === false
      byId('pv-fonts').hidden = false
      byId('pv-fonts-yes').onclick = async () => {
        try { await rpc('font-consent', { key, allow: true }) } catch (err) { return toast(err.message) }
        byId('pv-fonts').hidden = true
        famMap = await loadFonts(scope, profile.fonts)
        draw()
      }
      byId('pv-fonts-no').onclick = async () => {
        try { await rpc('font-consent', { key, allow: false }) } catch (err) { return toast(err.message) }
        byId('pv-fonts').hidden = true
      }
    }
  }

  // ---------- Editor ----------

  const ed = { profile: null, selected: null, nodes: new Map(), snapshot: '' }

  // Fuentes incluidas + las propias del perfil que se está editando
  function fontOptions() {
    return [...Object.entries(FONT_LABELS), ...ed.profile.fonts.map((f) => ['f:' + f.id, f.name + ' (mía)'])]
  }

  function renderStage() {
    ed.nodes = renderPage(byId('ed-stage'), ed.profile.page, {
      onSelect: (id) => select(id),
      onChange: () => renderProps()
    })
    updateSelectionClass()
  }

  function updateSelectionClass() {
    for (const [id, node] of ed.nodes) node.classList.toggle('sel', id === ed.selected)
  }

  function select(id) {
    ed.selected = id
    updateSelectionClass()
    renderProps()
  }

  const selectedBlock = () => ed.profile.page.blocks.find((b) => b.id === ed.selected) || null
  const rid = () => Math.random().toString(36).slice(2, 10)

  function restyle(b) {
    const node = ed.nodes.get(b.id)
    if (!node) return
    const t = node.querySelector('.t')
    if (b.type === 'text' && t) t.textContent = b.text
    styleBlock(node, b)
  }

  function field(label, input) {
    const wrap = el('label', 'prop')
    wrap.append(el('span', 'small muted', label), input)
    return wrap
  }
  function numberInput(value, min, max, onInput) {
    const i = document.createElement('input')
    i.type = 'number'; i.min = String(min); i.max = String(max); i.value = String(value)
    i.oninput = () => { const v = Number(i.value); if (Number.isFinite(v)) onInput(Math.min(max, Math.max(min, Math.round(v)))) }
    return i
  }
  function selectInput(options, value, onChange) {
    const s = document.createElement('select')
    for (const [v, label] of options) { const o = el('option', '', label); o.value = v; s.append(o) }
    s.value = value
    s.onchange = () => onChange(s.value)
    return s
  }
  function colorInput(value, onInput) {
    const i = document.createElement('input')
    i.type = 'color'; i.value = value
    i.oninput = () => onInput(i.value)
    return i
  }
  function checkInput(label, value, onChange) {
    const wrap = el('label', 'check')
    const i = document.createElement('input')
    i.type = 'checkbox'; i.checked = value
    i.onchange = () => onChange(i.checked)
    wrap.append(i, document.createTextNode(' ' + label))
    return wrap
  }

  function renderProps() {
    const panel = byId('ed-props')
    panel.replaceChildren()
    const b = selectedBlock()
    if (!b) {
      panel.append(el('p', 'muted small', 'Haz clic en un elemento para editarlo, arrástralo para moverlo y usa la esquina para cambiar su tamaño. Agrega texto o imágenes con los botones de arriba.'))
      return
    }
    panel.append(el('h3', '', b.type === 'text' ? 'Cuadro de texto' : 'Imagen'))
    if (b.type === 'text') {
      const area = document.createElement('textarea')
      area.value = b.text; area.maxLength = 2000; area.rows = 5
      area.oninput = () => { b.text = area.value; restyle(b) }
      panel.append(field('Texto', area))
      panel.append(field('Fuente', selectInput(fontOptions(), b.font, (v) => { b.font = v; restyle(b) })))
      panel.append(field('Tamaño (8–96)', numberInput(b.size, 8, 96, (v) => { b.size = v; restyle(b) })))
      panel.append(field('Color del texto', colorInput(b.color, (v) => { b.color = v; restyle(b) })))
      panel.append(field('Color de fondo del cuadro', colorInput(b.bg || '#ffffff', (v) => { b.bg = v; restyle(b) })))
      panel.append(checkInput('Sin fondo', !b.bg, (on) => { b.bg = on ? '' : '#ffffff'; restyle(b); renderProps() }))
      panel.append(checkInput('Negrita', b.bold, (v) => { b.bold = v; restyle(b) }))
      panel.append(checkInput('Cursiva', b.italic, (v) => { b.italic = v; restyle(b) }))
      panel.append(field('Alineación', selectInput([['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']], b.align, (v) => { b.align = v; restyle(b) })))
    } else {
      panel.append(field('Ajuste', selectInput([['cover', 'Cubrir'], ['contain', 'Contener']], b.fit, (v) => { b.fit = v; restyle(b) })))
      panel.append(field('Bordes redondeados (0–50)', numberInput(b.radius, 0, 50, (v) => { b.radius = v; restyle(b) })))
    }
    panel.append(field('Rotación (−180° a 180°)', numberInput(b.rot || 0, -180, 180, (v) => { b.rot = v; restyle(b) })))
    panel.append(field('Posición X', numberInput(b.x, 0, PAGE_W - 20, (v) => { b.x = v; restyle(b) })))
    panel.append(field('Posición Y', numberInput(b.y, 0, 3000, (v) => { b.y = v; restyle(b) })))
    panel.append(field('Ancho', numberInput(b.w, 20, PAGE_W, (v) => { b.w = v; restyle(b) })))
    panel.append(field('Alto', numberInput(b.h, 20, 3000, (v) => { b.h = v; restyle(b) })))
    const row = el('div', 'row')
    const front = el('button', '', 'Al frente'); front.type = 'button'; front.onclick = () => reorder(b, true)
    const back = el('button', '', 'Al fondo'); back.type = 'button'; back.onclick = () => reorder(b, false)
    const del = el('button', 'danger', 'Eliminar'); del.type = 'button'; del.onclick = () => removeBlock(b)
    row.append(front, back, del)
    panel.append(row)
  }

  function reorder(b, toFront) {
    const list = [...ed.profile.page.blocks].sort((x, y) => x.z - y.z).filter((x) => x !== b)
    if (toFront) list.push(b); else list.unshift(b)
    list.forEach((x, i) => { x.z = i; restyle(x) })
  }

  function removeBlock(b) {
    ed.profile.page.blocks = ed.profile.page.blocks.filter((x) => x !== b)
    ed.selected = null
    renderStage()
    renderProps()
  }

  function addBlock(block) {
    const blocks = ed.profile.page.blocks
    if (blocks.length >= 30) return setEditorMsg('Máximo 30 elementos por página.')
    block.id = rid()
    block.rot = 0
    block.z = blocks.length ? Math.max(...blocks.map((x) => x.z)) + 1 : 0
    blocks.push(block)
    ed.selected = block.id
    renderStage()
    renderProps()
  }

  const setEditorMsg = (text) => { byId('ed-msg').textContent = text || '' }

  // ---------- Imágenes: se reducen en tu equipo antes de guardarlas ----------

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

  // Detecta PNG animado (APNG: bloque acTL antes de los datos) y WebP animado (bit de animación en VP8X)
  function isAnimated(bytes) {
    const text = (i, n) => String.fromCharCode.apply(null, bytes.subarray(i, i + n))
    if (bytes.length > 8 && bytes[0] === 0x89 && text(1, 3) === 'PNG') {
      let off = 8
      while (off + 12 <= bytes.length) {
        const len = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
        const type = text(off + 4, 4)
        if (type === 'acTL') return true
        if (type === 'IDAT' || type === 'IEND') return false
        off += 12 + len
      }
    }
    if (bytes.length > 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && text(12, 4) === 'VP8X') return (bytes[20] & 0x02) !== 0
    return false
  }

  // Las imágenes quietas se reducen aquí; las ANIMADAS se conservan tal cual (si se redibujan, pierden la animación).
  async function fileToDataUrl(file, { maxDim, maxBytes }) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Usa una imagen PNG (también animado), JPG o WebP')
    if (file.size > 15 * 1024 * 1024) throw new Error('La imagen es demasiado pesada (máximo 15 MB)')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const original = await readAsDataUrl(file)
    const img = await loadImage(original)
    if (isAnimated(bytes)) {
      if (bytes.length > maxBytes) throw new Error('La animación pesa ' + Math.round(bytes.length / 1024) + ' KB y el máximo aquí es ' + Math.round(maxBytes / 1024) + ' KB. Redúcela (menos fotogramas o menor tamaño).')
      if (Math.max(img.naturalWidth, img.naturalHeight) > maxDim) throw new Error('La animación mide más de ' + maxDim + ' px por lado. Redúcela.')
      return original
    }
    const sw = img.naturalWidth
    const sh = img.naturalHeight
    let scale = Math.min(1, maxDim / Math.max(sw, sh))
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sw * scale))
      canvas.height = Math.max(1, Math.round(sh * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.85, 0.7, 0.55]) {
        const url = canvas.toDataURL('image/webp', quality)
        if (url.startsWith('data:image/webp') && url.length * 0.75 <= maxBytes) return url
      }
      scale *= 0.75
    }
    throw new Error('No se pudo reducir la imagen lo suficiente')
  }

  // ---------- Recorte de la foto de perfil ----------
  // El recorte son solo números (zoom y desplazamiento); la imagen original no se toca, así se conserva si es animada.
  function cropDialog(src, startCrop) {
    return new Promise((resolve) => {
      const dialog = byId('crop-dialog')
      const crop = { zoom: startCrop ? startCrop.zoom : 1, x: startCrop ? startCrop.x : 0, y: startCrop ? startCrop.y : 0 }
      const preview = byId('crop-preview')
      const zoom = byId('crop-zoom')
      zoom.value = String(crop.zoom)
      const clamp = () => {
        const lim = (crop.zoom - 1) * 50
        crop.x = Math.max(-lim, Math.min(lim, crop.x))
        crop.y = Math.max(-lim, Math.min(lim, crop.y))
      }
      const draw = () => { clamp(); preview.replaceChildren(avatarEl(src, '', '', crop).firstChild) }
      zoom.oninput = () => { crop.zoom = Math.round(Number(zoom.value) * 100) / 100; draw() }
      preview.onpointerdown = (e) => {
        e.preventDefault()
        preview.setPointerCapture(e.pointerId)
        const size = preview.clientWidth
        let lx = e.clientX
        let ly = e.clientY
        const move = (ev) => {
          crop.x += ((ev.clientX - lx) / size) * 100
          crop.y += ((ev.clientY - ly) / size) * 100
          lx = ev.clientX; ly = ev.clientY
          draw()
        }
        const up = () => { preview.removeEventListener('pointermove', move); preview.removeEventListener('pointerup', up) }
        preview.addEventListener('pointermove', move)
        preview.addEventListener('pointerup', up)
      }
      let result = null
      byId('crop-ok').onclick = () => { clamp(); result = { zoom: crop.zoom, x: Math.round(crop.x * 100) / 100, y: Math.round(crop.y * 100) / 100 }; dialog.close() }
      byId('crop-cancel').onclick = () => dialog.close()
      dialog.onclose = () => resolve(result)
      draw()
      dialog.showModal()
    })
  }

  function chooseFile() {
    return new Promise((resolve) => {
      const input = byId('ed-file')
      input.value = ''
      input.onchange = () => resolve(input.files[0] || null)
      input.click()
    })
  }

  async function pickImage(options) {
    const file = await chooseFile()
    if (!file) return null
    try { return await fileToDataUrl(file, options) } catch (err) { setEditorMsg(err.message); return null }
  }

  // ---------- Abrir, guardar y cancelar ----------

  async function openEditor() {
    const me = getMe()
    const { profile } = await rpc('profile-get', { key: me.code })
    ed.profile = JSON.parse(JSON.stringify(profile))
    ed.snapshot = JSON.stringify(ed.profile)
    ed.selected = null
    famMap = await loadFonts('me', ed.profile.fonts)
    byId('ed-status').value = ed.profile.status
    byId('ed-bg-color').value = ed.profile.page.bg.color
    byId('ed-bg-fit').value = ed.profile.page.bg.fit
    byId('ed-height').value = String(ed.profile.page.height)
    setEditorMsg('')
    byId('editor').hidden = false
    renderStage()
    renderProps()
  }

  const FONT_LIMITS = { bytes: 300 * 1024, count: 4 }
  const FONT_MAGIC = {
    woff2: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === 'wOF2',
    woff: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === 'wOFF',
    ttf: (b) => (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || String.fromCharCode(b[0], b[1], b[2], b[3]) === 'true',
    otf: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === 'OTTO'
  }

  async function addFont(file) {
    const fmt = (file.name.split('.').pop() || '').toLowerCase()
    if (!FONT_MAGIC[fmt]) throw new Error('Usa un archivo de fuente .woff2, .woff, .ttf u .otf')
    if (ed.profile.fonts.length >= FONT_LIMITS.count) throw new Error('Máximo ' + FONT_LIMITS.count + ' fuentes por perfil')
    if (file.size > FONT_LIMITS.bytes) throw new Error('La fuente pesa ' + Math.round(file.size / 1024) + ' KB y el máximo es ' + FONT_LIMITS.bytes / 1024 + ' KB')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length < 64 || !FONT_MAGIC[fmt](bytes)) throw new Error('El archivo no parece una fuente ' + fmt.toUpperCase() + ' válida')
    const font = { id: rid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Fuente', fmt, data: b64FromBytes(bytes) }
    const famTest = await loadFonts('me', [font]) // si el navegador no la entiende, se rechaza aquí
    if (!famTest[font.id]) throw new Error('No se pudo leer esa fuente. ¿Está dañada?')
    ed.profile.fonts.push(font)
    famMap = { ...famMap, ...famTest }
  }

  function renderFontsDialog() {
    const list = byId('fonts-list')
    list.replaceChildren()
    if (!ed.profile.fonts.length) list.append(el('li', 'muted small', 'Aún no has subido fuentes.'))
    for (const f of ed.profile.fonts) {
      const li = el('li', 'row')
      const sample = el('span', '', f.name + ' — Abc áéñ 123')
      sample.style.fontFamily = fontStack('f:' + f.id)
      const del = el('button', 'danger', 'Quitar')
      del.type = 'button'
      del.onclick = () => {
        ed.profile.fonts = ed.profile.fonts.filter((x) => x.id !== f.id)
        for (const b of ed.profile.page.blocks) if (b.font === 'f:' + f.id) b.font = 'sans'
        if (ed.profile.nameFont === 'f:' + f.id) ed.profile.nameFont = ''
        renderFontsDialog(); renderStage(); renderProps()
      }
      li.append(sample, el('span', 'spacer'), del)
      list.append(li)
    }
    const select = byId('fonts-name')
    select.replaceChildren()
    for (const [v, label] of [['', 'Normal'], ...fontOptions()]) { const o = el('option', '', label); o.value = v; select.append(o) }
    select.value = ed.profile.nameFont
    byId('fonts-sample').textContent = 'Así se verá tu nombre'
    byId('fonts-sample').style.fontFamily = fontStack(ed.profile.nameFont)
  }

  function closeEditor() { byId('editor').hidden = true }

  function bindEditor() {
    byId('ed-status').oninput = (e) => { ed.profile.status = e.target.value }
    byId('ed-bg-color').oninput = (e) => { ed.profile.page.bg.color = e.target.value; renderStage() }
    byId('ed-bg-fit').onchange = (e) => { ed.profile.page.bg.fit = e.target.value; renderStage() }
    byId('ed-height').oninput = (e) => {
      const v = Number(e.target.value)
      if (Number.isFinite(v)) { ed.profile.page.height = Math.min(3000, Math.max(200, Math.round(v))); renderStage() }
    }
    byId('ed-bg-image').onclick = async () => {
      const url = await pickImage({ maxDim: 1600, maxBytes: 380 * 1024 })
      if (url) { ed.profile.page.bg.image = url; setEditorMsg(''); renderStage() }
    }
    byId('ed-bg-clear').onclick = () => { ed.profile.page.bg.image = ''; renderStage() }
    byId('ed-avatar-btn').onclick = async () => {
      const url = await pickImage({ maxDim: 512, maxBytes: 190 * 1024 })
      if (!url) return
      const crop = await cropDialog(url, null)
      if (crop) { ed.profile.avatar = url; ed.profile.avatarCrop = crop; setEditorMsg('Foto de perfil lista. Pulsa Guardar.') }
    }
    byId('ed-avatar-adjust').onclick = async () => {
      if (!ed.profile.avatar) return setEditorMsg('Primero elige una foto de perfil.')
      const crop = await cropDialog(ed.profile.avatar, ed.profile.avatarCrop)
      if (crop) { ed.profile.avatarCrop = crop; setEditorMsg('Recorte actualizado. Pulsa Guardar.') }
    }

    // ----- Fuentes propias -----
    byId('ed-fonts-btn').onclick = () => { renderFontsDialog(); byId('fonts-dialog').showModal() }
    byId('fonts-close').onclick = () => byId('fonts-dialog').close()
    byId('fonts-add').onclick = async () => {
      const input = byId('ed-font-file')
      input.value = ''
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) return
        try { await addFont(file) } catch (err) { byId('fonts-msg').textContent = err.message; return }
        byId('fonts-msg').textContent = ''
        renderFontsDialog()
        renderProps()
      }
      input.click()
    }
    byId('fonts-name').onchange = (e) => { ed.profile.nameFont = e.target.value; byId('fonts-sample').style.fontFamily = fontStack(ed.profile.nameFont) }
    byId('ed-add-text').onclick = () => addBlock({
      type: 'text', x: 40, y: 40, w: 300, h: 80, text: 'Escribe aquí', font: 'sans', size: 24,
      color: '#222222', bg: '', bold: false, italic: false, align: 'left'
    })
    byId('ed-add-image').onclick = async () => {
      const url = await pickImage({ maxDim: 1000, maxBytes: 380 * 1024 })
      if (url) addBlock({ type: 'image', x: 40, y: 40, w: 260, h: 200, src: url, fit: 'cover', radius: 0 })
    }
    byId('ed-cancel').onclick = () => {
      if (JSON.stringify(ed.profile) !== ed.snapshot && !confirm('¿Descartar los cambios?')) return
      closeEditor()
    }
    byId('ed-save').onclick = async () => {
      setEditorMsg('')
      try {
        await rpc('profile-save', { profile: ed.profile })
        closeEditor()
        toast('Perfil guardado. Tus contactos lo recibirán automáticamente.')
        onSaved()
      } catch (err) {
        setEditorMsg(err.message)
      }
    }
    byId('pv-close').onclick = () => byId('profile-dialog').close()
    byId('pv-edit').onclick = () => { byId('profile-dialog').close(); openEditor().catch((err) => toast(err.message)) }
  }

  function init(deps) {
    rpc = deps.rpc
    toast = deps.toast
    getMe = deps.getMe
    onSaved = deps.onSaved
    bindEditor()
  }

  return { init, view, avatarEl, openEditor }
})()
