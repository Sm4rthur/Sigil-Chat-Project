'use strict'
// Revisión estática: detecta errores de conexión entre archivos y regresiones de seguridad.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const html = read('ui/index.html')
const app = read('ui/app.js')
const profileUi = read('ui/profile.js')
const serversUi = read('ui/servers.js')
const main = read('src/main.js')
const preload = read('src/preload.js')

// 1) Todo elemento que usa app.js existe en index.html
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
for (const m of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(m[1]), 'Falta en index.html el elemento: ' + m[1])

// 2) Canales: preload <-> main <-> pantalla
const channels = new Set([...preload.match(/new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
const handled = new Set([...main.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]))
for (const c of channels) assert.ok(handled.has(c), 'Canal sin atender en main.js: ' + c)
for (const c of handled) assert.ok(channels.has(c), 'Canal no permitido en preload.js: ' + c)
for (const m of app.matchAll(/rpc\('([^']+)'/g)) assert.ok(channels.has(m[1]), 'La pantalla usa un canal inexistente: ' + m[1])
for (const m of profileUi.matchAll(/rpc\('([^']+)'/g)) assert.ok(channels.has(m[1]), 'profile.js usa un canal inexistente: ' + m[1])
for (const m of profileUi.matchAll(/byId\('([^']+)'\)/g)) assert.ok(ids.has(m[1]), 'Falta en index.html el elemento: ' + m[1])
for (const m of serversUi.matchAll(/rpc\('([^']+)'/g)) assert.ok(channels.has(m[1]), 'servers.js usa un canal inexistente: ' + m[1])
for (const m of serversUi.matchAll(/byId\('([^']+)'\)/g)) assert.ok(ids.has(m[1]), 'Falta en index.html el elemento: ' + m[1])

// 3) Eventos que main envía y la pantalla atiende
const sent = new Set([...main.matchAll(/\bsend\('([^']+)'/g)].map((m) => m[1]))
sent.delete('event')
const listened = new Set([...app.matchAll(/case '([^']+)':/g)].map((m) => m[1]))
for (const e of sent) assert.ok(listened.has(e), 'La pantalla no atiende el evento: ' + e)

// 4) Regresiones de seguridad en la pantalla (compatibles con la política CSP)
assert.ok(/default-src 'none'/.test(html), 'Falta la política CSP restrictiva')
assert.ok(!/\sstyle\s*=/i.test(html), 'No usar estilos en línea')
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'No usar manejadores en línea (onclick=...)')
assert.ok(![...html.matchAll(/<script\b([^>]*)>/g)].some((m) => !/\bsrc=/.test(m[1])), 'No usar scripts en línea')
for (const [name, code] of [['app.js', app], ['profile.js', profileUi], ['servers.js', serversUi]]) {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]style/.test(code), 'API peligrosa en ' + name + ' (riesgo de inyección)')
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(code), name + ' no debe hacer conexiones')
}
assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(app), 'La pantalla no debe hacer conexiones')
assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'No cargar recursos externos en index.html')

// 5) Ajustes de aislamiento de la ventana
for (const rule of [
  /contextIsolation:\s*true/, /nodeIntegration:\s*false/, /sandbox:\s*true/, /webviewTag:\s*false/,
  /webSecurity:\s*true/, /setWindowOpenHandler/, /will-navigate/, /will-attach-webview/,
  /onBeforeRequest/, /setPermissionRequestHandler/, /fromOurWindow/
]) assert.ok(rule.test(main), 'Falta en main.js: ' + rule)
assert.ok(!/nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/.test(main))

// 6) El puente solo expone "api"
assert.strictEqual([...preload.matchAll(/exposeInMainWorld\(/g)].length, 1)

console.log('consistency.js: todo bien')
