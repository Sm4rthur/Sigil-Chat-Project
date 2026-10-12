'use strict'
// Carga los scripts de la pantalla con un navegador simulado y recorre los flujos principales
// (arranque, chat con registro de llamadas, servidor, perfil y editor) para detectar errores de código.
// No reemplaza probar la ventana real, pero encuentra variables mal escritas y funciones inexistentes.
const vm = require('vm')
const fs = require('fs')
const path = require('path')
const assert = require('assert')

process.on('unhandledRejection', (e) => { console.error('Promesa rechazada:', e); process.exit(1) })
process.on('uncaughtException', (e) => { console.error('Error:', e); process.exit(1) })

const els = new Map()
function mk(id) {
  const store = {
    id, children: [], style: {}, dataset: {}, value: '', checked: false, hidden: false, options: [], files: [], clientWidth: 800, textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
  }
  const proxy = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'then' || typeof k === 'symbol') return undefined
      return (...args) => {
        if (k === 'getBoundingClientRect') return { left: 0, top: 0, width: 100, height: 100 }
        if (k === 'querySelector') return mk('q')
        if (k === 'append') { t.children.push(...args); return undefined }
        if (k === 'replaceChildren') { t.children = [...args]; return undefined }
        return proxy
      }
    },
    set(t, k, v) { t[k] = v; return true }
  })
  return proxy
}
const getEl = (id) => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id) }

const me = 'a'.repeat(64), peer = 'b'.repeat(64), sid = 'c'.repeat(16), cid = 'd'.repeat(8)
const calls = []
let listener = null
const profile = {
  v: 1, status: 'hola', avatar: '', avatarCrop: { zoom: 1, x: 0, y: 0 }, nameFont: 'f:ab',
  fonts: [{ id: 'ab', name: 'Mi fuente', fmt: 'woff2', data: 'AAAA' }],
  page: { height: 600, bg: { color: '#ffffff', image: '', fit: 'cover' }, blocks: [
    { id: 't1', type: 'text', x: 10, y: 10, w: 200, h: 60, z: 0, rot: 20, text: 'Hola', font: 'f:ab', size: 20, color: '#222222', bg: '', bold: false, italic: false, align: 'left' }
  ] }
}
const res = {
  boot: () => ({ ok: true, loggedIn: true }),
  me: () => ({ ok: true, me: { username: 'ana', email: 'a@gmail.com', code: me, hasKeyfile: false, remembered: false, nodeMode: true, acceptRequests: true, runInBackground: false, autoStart: false, packaged: false, verified: true } }),
  contacts: () => ({ ok: true, contacts: [{ key: peer, name: 'Beto', remoteName: 'beto', verified: true, online: true, profRev: 'f'.repeat(16) }], requests: [{ key: 'e'.repeat(64), name: 'Extraño', verified: false, ts: 1 }], node: { nodeMode: true, acting: false, connected: 1 }, verification: true }),
  chat: () => ({ ok: true, messages: [
    { id: '1', from: 'me', text: 'hola', ts: Date.now(), status: 'delivered' },
    { id: '2', from: 'them', kind: 'call', ts: Date.now(), call: { dir: 'in', result: 'missed', duration: 0 } },
    { id: '3', from: 'me', kind: 'call', ts: Date.now(), call: { dir: 'out', result: 'ended', duration: 75 } }
  ] }),
  'profile-avatar': () => ({ ok: true, avatar: '', crop: { zoom: 1, x: 0, y: 0 } }),
  'profile-get': () => ({ ok: true, consent: null, profile }),
  'srv-list': () => ({ ok: true, servers: [{ id: sid, name: 'Srv', mine: false, myRole: 'admin', hostOnline: true }] }),
  'srv-get': () => ({ ok: true, server: { id: sid, name: 'Srv', mine: false, hostKey: peer, myRole: 'admin', hostOnline: true, channels: [{ id: cid, name: 'general' }],
    members: [{ key: me, name: 'ana', role: 'admin', verified: true, online: true, muted: false }, { key: peer, name: 'beto', role: 'member', verified: false, online: true, muted: false }],
    bans: ['9'.repeat(64)], audit: [{ ts: 1, by: 'x', action: 'y', target: 'z' }] } }),
  'srv-messages': () => ({ ok: true, messages: [{ id: '1'.repeat(12), from: peer, name: 'beto', v: false, ts: Date.now(), text: 'hola @ana' }, { id: '2'.repeat(12), from: me, name: 'ana', v: true, ts: Date.now(), text: 'ok', edited: 5 }] })
}

const sandbox = {
  console, setTimeout, setInterval, clearInterval, clearTimeout, Date, Math, JSON, Promise, Array, Object, Number, String, RegExp, Set, Map,
  Uint8Array, Int16Array, ArrayBuffer, Error, Symbol, parseInt, parseFloat, isNaN, atob, btoa, URL,
  confirm: () => true, alert() {}, location: { reload() {} },
  navigator: { mediaDevices: {}, clipboard: { writeText: async () => {} } },
  AudioContext: class {}, Image: class {}, FileReader: class {},
  FontFace: class { async load() { return this } },
  document: { getElementById: getEl, createElement: () => mk('new'), createTextNode: (t) => ({ nodeValue: t }), querySelectorAll: () => [], fonts: { add() {} } }
}
sandbox.window = sandbox
sandbox.api = undefined
sandbox.window.api = {
  invoke: async (channel, arg) => { calls.push([channel, arg]); return res[channel] ? res[channel](arg) : { ok: true } },
  sendAudio() {},
  onEvent(cb) { listener = cb }
}
vm.createContext(sandbox)
const run = (code) => vm.runInContext(code, sandbox)
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  for (const f of ['profile.js', 'servers.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui', f), 'utf8'), sandbox, { filename: f })
  }
  await tick(100)
  const called = (name) => calls.some((c) => c[0] === name)
  for (const ch of ['boot', 'me', 'contacts', 'srv-list']) assert.ok(called(ch), 'el arranque debe llamar a ' + ch)

  // Chat con registros de llamada
  await run(`openChat("${peer}")`)
  await tick()
  assert.ok(getEl('messages').children.length >= 3)

  // Servidor
  await run(`ServersUI.open("${sid}")`)
  await tick(80)
  assert.strictEqual(getEl('srv-name').textContent, 'Srv')
  listener({ type: 'servers', sid })
  listener({ type: 'server-msg', sid, cid, m: { text: 'x' }, mine: false })
  listener({ type: 'server-msg', sid: 'z'.repeat(16), cid, m: { text: 'x' }, mine: false })
  listener({ type: 'servers', sid, gone: 'kicked' })
  await tick(80)

  // Ver el perfil de un contacto (pide consentimiento de fuentes) y aceptarlo
  await run(`ProfileUI.view({ key: "${peer}", name: "Beto", verified: true, isMe: false })`)
  await tick(50)
  assert.strictEqual(getEl('pv-fonts').hidden, false, 'debe preguntar antes de cargar fuentes ajenas')
  await getEl('pv-fonts-yes').onclick()
  assert.ok(called('font-consent'))

  // Editor: abrir, agregar texto, ajustar recorte y guardar
  await run('ProfileUI.openEditor()')
  await tick(50)
  getEl('ed-add-text').onclick()
  await tick()
  await getEl('ed-save').onclick()
  await tick()
  assert.ok(called('profile-save'))
  const saved = calls.filter((c) => c[0] === 'profile-save').at(-1)[1].profile
  assert.ok(saved.page.blocks.length >= 2 && saved.page.blocks.every((b) => 'rot' in b), 'los bloques nuevos incluyen rotación')

  console.log('ui-smoke.js: todo bien')
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
