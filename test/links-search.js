'use strict'
// Comprobación de enlaces y buscador interno.
const assert = require('assert')
const { checkLink } = require('../src/links')
const { searchAll, fold } = require('../src/search')

// ---------- Enlaces ----------
for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'data:text/html,<script>', 'ftp://x.com/a', 'vbscript:x', 'mailto:a@b.cl', '//evil.com', 'no es un enlace', '', null, 5, 'http://' + 'a'.repeat(2100) + '.com']) {
  assert.strictEqual(checkLink(bad).ok, false, 'debe rechazar: ' + String(bad).slice(0, 40))
}
assert.strictEqual(checkLink('https://usuario:clave@banco.cl/login').ok, false, 'usuario:clave@sitio es una técnica de estafa')
assert.strictEqual(checkLink('https://banco.cl@evil.com/').ok, false)
let r = checkLink('https://Ejemplo.COM/ruta?x=1')
assert.deepStrictEqual([r.ok, r.host, r.warnings.length], [true, 'ejemplo.com', 0])
assert.ok(checkLink('http://ejemplo.com').warnings.some((w) => /https/.test(w)))
assert.ok(checkLink('https://xn--pple-43d.com').warnings.some((w) => /caracteres especiales/.test(w)), 'dominio IDN (homógrafos)')
assert.ok(checkLink('https://аррӏе.com').warnings.some((w) => /caracteres especiales/.test(w)), 'letras de otro alfabeto se detectan por punycode')
assert.ok(checkLink('https://192.168.1.1/admin').warnings.some((w) => /numérica/.test(w)))
assert.ok(checkLink('https://[::1]/').warnings.some((w) => /numérica/.test(w)))
assert.ok(checkLink('https://bit.ly/abc').warnings.some((w) => /acortador/.test(w)))
assert.ok(checkLink('https://ejemplo.com:8443/').warnings.some((w) => /puerto/.test(w)))

// ---------- Buscador ----------
const data = {
  contacts: [{ key: 'a'.repeat(64), name: 'Beto', remoteName: 'beto' }, { key: 'b'.repeat(64), name: '', remoteName: 'carla' }],
  chats: {
    ['a'.repeat(64)]: [
      { id: '1', from: 'me', text: 'Escucha esta canción', ts: 100 },
      { id: '2', from: 'them', text: 'Qué CANCION más linda', ts: 200 },
      { id: '3', from: 'them', kind: 'call', ts: 300, call: { dir: 'in', result: 'ended', duration: 5 } },
      { id: '4', from: 'me', kind: 'file', ts: 400, file: { name: 'Cancion-final.mp3', size: 10 } }
    ],
    ['b'.repeat(64)]: [{ id: '5', from: 'them', text: 'hola, nos vemos mañana', ts: 150 }]
  },
  servers: {
    s1: { id: 's1', name: 'Banda', channels: [{ id: 'c1', name: 'general' }], msgs: { c1: [{ id: '6', name: 'ana', ts: 250, text: 'Nueva CANCIÓN del ensayo' }, { id: '7', name: 'luis', ts: 50, text: 'otra cosa' }] } }
  }
}
assert.strictEqual(fold('CANCIÓN Ñandú'), 'cancion nandu')
let res = searchAll(data, 'cancion')
assert.deepStrictEqual(res.map((x) => x.id), ['4', '6', '2', '1'], 'sin tildes ni mayúsculas, del más nuevo al más viejo, incluye archivos')
assert.deepStrictEqual(searchAll(data, 'cancion', 'chats').map((x) => x.type), ['chat', 'chat', 'chat'])
assert.deepStrictEqual(searchAll(data, 'cancion', 'servers').map((x) => x.type), ['server'])
assert.deepStrictEqual(searchAll(data, 'nueva ensayo').map((x) => x.id), ['6'], 'todas las palabras deben estar')
assert.deepStrictEqual(searchAll(data, 'manana').map((x) => x.who), ['carla'])
assert.deepStrictEqual(searchAll(data, 'llamada'), [], 'los registros de llamada no se buscan como texto')
for (const q of ['', ' ', 'a', null, undefined, 5, {}]) assert.deepStrictEqual(searchAll(data, q), [], 'consulta inválida o muy corta')
assert.strictEqual(searchAll(data, 'cancion', 'all', 2).length, 2, 'respeta el límite')
const long = { contacts: data.contacts, chats: { ['a'.repeat(64)]: [{ id: 'x', from: 'me', text: 'hola ' + 'x'.repeat(1000), ts: 1 }] }, servers: {} }
assert.strictEqual(searchAll(long, 'hola')[0].text.length, 300, 'se recorta el texto de cada resultado')
assert.strictEqual(res.find((x) => x.id === '2').who, 'Beto')
assert.strictEqual(res.find((x) => x.id === '1').mine, true)

console.log('links-search.js: todo bien')
