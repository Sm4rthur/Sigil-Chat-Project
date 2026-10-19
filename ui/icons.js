'use strict'
// Iconografía única de Sigil Chat (trazos tipo Lucide, dibujados localmente).
// No carga recursos externos ni usa HTML: crea SVG con createElementNS.
const IconUI = (() => {
  const NS = 'http://www.w3.org/2000/svg'
  // Cada icono es una lista de elementos [etiqueta, atributos]. Solo datos estáticos y revisados.
  const ICONS = {
    brand: [
      ['path', { d: 'M12 2 20 5.5v6c0 5-3.2 8.4-8 10.5-4.8-2.1-8-5.5-8-10.5v-6Z' }],
      ['path', { d: 'M12 7v10' }],
      ['path', { d: 'M9 10.4c0-1.6 1.3-2.9 3-2.9s3 1.1 3 2.7c0 3-6 2-6 5.1 0 1.6 1.3 2.7 3 2.7s3-1.3 3-2.9' }]
    ],
    'message-square': [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
    server: [
      ['rect', { x: '2', y: '3', width: '20', height: '8', rx: '2' }],
      ['rect', { x: '2', y: '13', width: '20', height: '8', rx: '2' }],
      ['line', { x1: '6', y1: '7', x2: '6.01', y2: '7' }],
      ['line', { x1: '6', y1: '17', x2: '6.01', y2: '17' }]
    ],
    search: [
      ['circle', { cx: '11', cy: '11', r: '8' }],
      ['line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }]
    ],
    settings: [
      ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
      ['circle', { cx: '12', cy: '12', r: '3' }]
    ],
    plus: [['line', { x1: '12', y1: '5', x2: '12', y2: '19' }], ['line', { x1: '5', y1: '12', x2: '19', y2: '12' }]],
    copy: [
      ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }],
      ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
    ],
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
    clock: [['circle', { cx: '12', cy: '12', r: '10' }], ['polyline', { points: '12 6 12 12 16 14' }]],
    'alert-triangle': [
      ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
      ['line', { x1: '12', y1: '9', x2: '12', y2: '13' }],
      ['line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }]
    ],
    lock: [
      ['rect', { x: '3', y: '11', width: '18', height: '11', rx: '2' }],
      ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]
    ],
    shield: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }]],
    user: [
      ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '12', cy: '7', r: '4' }]
    ],
    users: [
      ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '9', cy: '7', r: '4' }],
      ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
      ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]
    ],
    'user-plus': [
      ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '9', cy: '7', r: '4' }],
      ['line', { x1: '19', y1: '8', x2: '19', y2: '14' }],
      ['line', { x1: '22', y1: '11', x2: '16', y2: '11' }]
    ],
    phone: [['path', { d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' }]],
    mic: [
      ['path', { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' }],
      ['path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }],
      ['line', { x1: '12', y1: '19', x2: '12', y2: '22' }],
      ['line', { x1: '8', y1: '22', x2: '16', y2: '22' }]
    ],
    'mic-off': [
      ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }],
      ['path', { d: 'M9 9v3a3 3 0 0 0 5.12 2.12' }],
      ['path', { d: 'M15 9.34V5a3 3 0 0 0-5.94-.6' }],
      ['path', { d: 'M19 10v2a7 7 0 0 1-.11 1.23' }],
      ['path', { d: 'M5 10v2a7 7 0 0 0 7 7' }],
      ['line', { x1: '12', y1: '19', x2: '12', y2: '22' }],
      ['line', { x1: '8', y1: '22', x2: '16', y2: '22' }]
    ],
    headphones: [['path', { d: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3' }]],
    'volume-2': [
      ['path', { d: 'M11 5 6 9H2v6h4l5 4z' }],
      ['path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }],
      ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }]
    ],
    'volume-x': [
      ['path', { d: 'M11 5 6 9H2v6h4l5 4z' }],
      ['line', { x1: '22', y1: '9', x2: '16', y2: '15' }],
      ['line', { x1: '16', y1: '9', x2: '22', y2: '15' }]
    ],
    'phone-missed': [
      ['path', { d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' }],
      ['line', { x1: '23', y1: '3', x2: '17', y2: '9' }],
      ['line', { x1: '17', y1: '3', x2: '23', y2: '9' }]
    ],
    'phone-off': [
      ['path', { d: 'M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67' }],
      ['path', { d: 'M5.17 5.17A19.79 19.79 0 0 0 2.07 13.9a2 2 0 0 0 2 2.1h3a2 2 0 0 0 2-1.72 12.84 12.84 0 0 1 .7-2.81 2 2 0 0 1 .45-2.11l1.27-1.27a16 16 0 0 1 2.6-3.41' }],
      ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }]
    ],
    trash: [
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
      ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
      ['line', { x1: '10', y1: '11', x2: '10', y2: '17' }],
      ['line', { x1: '14', y1: '11', x2: '14', y2: '17' }]
    ],
    paperclip: [['path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48' }]],
    send: [['path', { d: 'm22 2-7 20-4-9-9-4Z' }], ['line', { x1: '22', y1: '2', x2: '11', y2: '13' }]],
    hash: [
      ['line', { x1: '4', y1: '9', x2: '20', y2: '9' }],
      ['line', { x1: '4', y1: '15', x2: '20', y2: '15' }],
      ['line', { x1: '10', y1: '3', x2: '8', y2: '21' }],
      ['line', { x1: '16', y1: '3', x2: '14', y2: '21' }]
    ],
    'panel-left': [['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }], ['line', { x1: '9', y1: '3', x2: '9', y2: '21' }]],
    'panel-right': [['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }], ['line', { x1: '15', y1: '3', x2: '15', y2: '21' }]],
    'chevron-down': [['polyline', { points: '6 9 12 15 18 9' }]],
    'chevron-right': [['polyline', { points: '9 18 15 12 9 6' }]],
    x: [['line', { x1: '18', y1: '6', x2: '6', y2: '18' }], ['line', { x1: '6', y1: '6', x2: '18', y2: '18' }]],
    eye: [['path', { d: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
    'eye-off': [['path', { d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }], ['path', { d: 'M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }], ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }], ['path', { d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }]],
    key: [
      ['circle', { cx: '7.5', cy: '15.5', r: '5.5' }],
      ['path', { d: 'm21 2-9.6 9.6' }],
      ['path', { d: 'm15.5 7.5 3 3L22 7l-3-3' }]
    ],
    download: [
      ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
      ['polyline', { points: '7 10 12 15 17 10' }],
      ['line', { x1: '12', y1: '15', x2: '12', y2: '3' }]
    ],
    file: [
      ['path', { d: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z' }],
      ['polyline', { points: '14 2 14 8 20 8' }]
    ],
    image: [
      ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
      ['circle', { cx: '8.5', cy: '8.5', r: '1.5' }],
      ['polyline', { points: '21 15 16 10 5 21' }]
    ],
    info: [['circle', { cx: '12', cy: '12', r: '10' }], ['line', { x1: '12', y1: '16', x2: '12', y2: '12' }], ['line', { x1: '12', y1: '8', x2: '12.01', y2: '8' }]],
    bell: [
      ['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }],
      ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }]
    ],
    'bell-off': [
      ['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }],
      ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
      ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }]
    ],
    menu: [['line', { x1: '4', y1: '6', x2: '20', y2: '6' }], ['line', { x1: '4', y1: '12', x2: '20', y2: '12' }], ['line', { x1: '4', y1: '18', x2: '20', y2: '18' }]],
    'more-horizontal': [['circle', { cx: '5', cy: '12', r: '1' }], ['circle', { cx: '12', cy: '12', r: '1' }], ['circle', { cx: '19', cy: '12', r: '1' }]],
    'log-out': [
      ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
      ['polyline', { points: '16 17 21 12 16 7' }],
      ['line', { x1: '21', y1: '12', x2: '9', y2: '12' }]
    ],
    'refresh-cw': [
      ['path', { d: 'M21 12a9 9 0 0 1-15.5 6.2L3 16' }],
      ['path', { d: 'M3 12a9 9 0 0 1 15.5-6.2L21 8' }],
      ['polyline', { points: '3 21 3 16 8 16' }],
      ['polyline', { points: '21 3 21 8 16 8' }]
    ],
    wifi: [['path', { d: 'M5 12.55a11 11 0 0 1 14.08 0' }], ['path', { d: 'M1.42 9a16 16 0 0 1 21.16 0' }], ['path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }], ['line', { x1: '12', y1: '20', x2: '12.01', y2: '20' }]],
    'wifi-off': [['path', { d: 'M1 1l22 22' }], ['path', { d: 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55' }], ['path', { d: 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39' }], ['path', { d: 'M10.71 5.05A16 16 0 0 1 22.58 9' }], ['path', { d: 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88' }], ['path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }], ['line', { x1: '12', y1: '20', x2: '12.01', y2: '20' }]]
  }

  function make (tag, attrs) {
    const n = document.createElementNS ? document.createElementNS(NS, tag) : document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }

  function el (name, size = 18, cls = '') {
    const def = ICONS[name] || ICONS.info
    const s = document.createElementNS ? document.createElementNS(NS, 'svg') : document.createElement('svg')
    s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('width', String(size))
    s.setAttribute('height', String(size))
    s.setAttribute('fill', 'none')
    s.setAttribute('stroke', 'currentColor')
    s.setAttribute('stroke-width', '1.8')
    s.setAttribute('stroke-linecap', 'round')
    s.setAttribute('stroke-linejoin', 'round')
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('focusable', 'false')
    if (cls) s.setAttribute('class', cls)
    for (const [tag, attrs] of def) s.append(make(tag, attrs))
    return s
  }

  // Rellena los <span data-icon="..."> del HTML estático.
  function hydrate (root = document) {
    const list = root.querySelectorAll ? root.querySelectorAll('[data-icon]') : []
    for (const box of list) {
      const name = box.dataset && box.dataset.icon
      if (!name) continue
      box.replaceChildren(el(name, Number(box.dataset.size) || 18))
    }
  }

  // Icono con nombre accesible (para estados que no deben depender solo del color).
  function labeled (name, label, size = 16) {
    const s = el(name, size)
    s.removeAttribute('aria-hidden')
    s.setAttribute('role', 'img')
    s.setAttribute('aria-label', label)
    return s
  }

  return { el, hydrate, labeled, names: Object.keys(ICONS) }
})()
