'use strict'
// Comprueba que los pares de color principales de los temas tengan contraste
// suficiente. Lee los tokens reales de ui/style.css para que la prueba no se
// quede desactualizada si alguien cambia la paleta.

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const css = fs.readFileSync(path.join(__dirname, '..', 'ui', 'style.css'), 'utf8')

function block(selector) {
  const i = css.indexOf(selector)
  if (i === -1) throw new Error('No se encontró el bloque ' + selector)
  const start = css.indexOf('{', i)
  const end = css.indexOf('}', start)
  return css.slice(start + 1, end)
}

function token(source, name) {
  const m = source.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})'))
  if (!m) throw new Error('Falta el token --' + name)
  return m[1]
}

function luminance(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a, b) {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function checkTheme(label, source, minAccentPanel) {
  const t = (name) => token(source, name)
  const pairs = [
    ['texto sobre fondo', t('ink'), t('bg'), 7],
    ['texto secundario sobre panel', t('muted'), t('panel'), 4.5],
    ['acento sobre fondo', t('accent'), t('bg'), 4.5],
    ['acento sobre panel', t('accent'), t('panel'), minAccentPanel],
    ['texto de acento sobre acento', t('accent-ink'), t('accent'), 4.5]
  ]
  for (const [name, fg, bg, min] of pairs) {
    const ratio = Math.round(contrast(fg, bg) * 100) / 100
    assert.ok(ratio >= min, label + ': ' + name + ' = ' + ratio + ' (mínimo ' + min + ')')
  }
}

// Dark Sanctuary: base de la aplicación.
const dark = block(':root {')
checkTheme('Dark Sanctuary', dark, 4.5)

// Los acentos sobre panel rozan el mínimo en el tema oscuro: se exige 4.5.
assert.ok(
  Math.round(contrast(token(dark, 'accent'), token(dark, 'panel')) * 100) / 100 >= 4.5,
  'Dark Sanctuary: el acento debe mantener 4.5 sobre el panel'
)

// El blanco sobre el acento oscuro no alcanza AA para texto normal.
assert.ok(
  contrast('#ffffff', token(dark, 'accent')) < 4.5,
  'El blanco sobre el acento oscuro no debe usarse como texto normal'
)

checkTheme('Claro', block(':root[data-theme="light"]'), 4.5)
checkTheme('Gris', block(':root[data-theme="gray"]'), 4.5)

// Los tokens de estructura deben existir y mantener el orden de tamaño previsto.
const rail = Number((css.match(/--rail-w:\s*(\d+)px/) || [])[1])
const panel = Number((css.match(/--panel-w:\s*(\d+)px/) || [])[1])
const members = Number((css.match(/--members-w:\s*(\d+)px/) || [])[1])
assert.ok(rail >= 60 && rail <= 72, 'rail dentro de 60-72 px')
assert.ok(panel >= 220 && panel <= 250, 'panel contextual dentro de 220-250 px')
assert.ok(members >= 200 && members <= 230, 'miembros dentro de 200-230 px')

console.log('contrast.js: todo bien')
