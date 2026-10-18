'use strict'
// Comprobación de enlaces ANTES de abrirlos en el navegador del usuario.
// La app nunca abre un enlace sola: el usuario debe confirmar y aceptar la responsabilidad (ver ui/links.js).
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 't.ly', 'buff.ly', 'rb.gy'])

function checkLink(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return { ok: false, reason: 'Enlace no válido o demasiado largo' }
  let u
  try { u = new URL(raw) } catch { return { ok: false, reason: 'Enlace no válido' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Solo se pueden abrir enlaces http y https' }
  if (!u.hostname) return { ok: false, reason: 'Enlace no válido' }
  if (u.username || u.password) return { ok: false, reason: 'El enlace incluye usuario o contraseña antes del sitio: es una técnica habitual de estafa' }

  const host = u.hostname.toLowerCase()
  const warnings = []
  if (u.protocol === 'http:') warnings.push('No usa https: la conexión no es privada.')
  if (host.split('.').some((label) => label.startsWith('xn--'))) warnings.push('El nombre del sitio usa caracteres especiales: puede estar imitando a otro sitio.')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) warnings.push('Es una dirección numérica, no el nombre de un sitio.')
  if (u.port && u.port !== '80' && u.port !== '443') warnings.push('Usa un puerto poco habitual.')
  if (SHORTENERS.has(host)) warnings.push('Es un acortador de enlaces: oculta a dónde lleva realmente.')
  return { ok: true, url: u.href, host, warnings }
}

module.exports = { checkLink }
