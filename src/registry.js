'use strict'
// Cliente del registro de nombres (carpeta server/). Se usa solo al crear la cuenta, para que el nombre sea único.
// No confía ciegamente en el servidor: comprueba que el certificado esté firmado con la clave pública fijada
// en config.js y que sea para ESTE nombre y ESTE código.
const config = require('./config')
const { verifyCert, solvePow } = require('./shared')

const MESSAGES = {
  bad_username: 'Nombre de usuario no válido.',
  username_taken: 'Ese nombre de usuario ya está registrado. Elige otro.',
  key_taken: 'Este dispositivo ya tiene un nombre registrado.',
  bad_pow: 'El registro rechazó la prueba de trabajo. Inténtalo de nuevo.',
  rate_limited: 'Demasiados registros desde esta conexión hoy. Inténtalo mañana.',
  try_later: 'El servicio está saturado. Inténtalo más tarde.',
  bad_request: 'Datos no válidos.'
}
const MAX_DIFFICULTY = 24 // un servidor malicioso no puede hacer que la app calcule sin fin

const enabled = () => !!config.REGISTRY_URL

function baseUrl() {
  let u
  try { u = new URL(config.REGISTRY_URL) } catch { throw new Error('REGISTRY_URL no es una dirección válida (revisa src/config.js)') }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('El registro debe usar https (http solo se acepta en localhost)')
  }
  if (!/^[0-9a-f]{64}$/.test(config.REGISTRY_PUBKEY)) throw new Error('Falta REGISTRY_PUBKEY en src/config.js')
  return u.origin
}

async function call(route, body) {
  const url = baseUrl() + route
  let res
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
      redirect: 'error' // nunca seguir redirecciones (podrían bajar a http)
    })
  } catch {
    throw new Error('No se pudo conectar con el registro de nombres. Revisa tu internet.')
  }
  let data = {}
  try {
    const text = await res.text()
    if (text.length <= 4096) data = JSON.parse(text)
  } catch { data = {} }
  if (!res.ok) throw new Error(MESSAGES[data.error] || 'Error del registro de nombres (' + res.status + ')')
  return data
}

// Reclama el nombre para este código. Devuelve el certificado ya comprobado.
async function claim(username, pub) {
  const info = await call('/v1/info')
  const difficulty = Number.isInteger(info.difficulty) ? Math.min(Math.max(info.difficulty, 0), MAX_DIFFICULTY) : 20
  const nonce = await solvePow(username, pub, difficulty)
  const data = await call('/v1/claim', { username, pub, nonce })
  const proven = verifyCert(data.cert, pub, config.REGISTRY_PUBKEY)
  if (!proven || proven.username !== username) throw new Error('El registro devolvió un certificado no válido')
  return data.cert
}

module.exports = { enabled, claim }
