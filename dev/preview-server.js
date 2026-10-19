'use strict'
// Previsualizador local para revisar la interfaz sin Electron.
// No forma parte de la app empaquetada: build.files solo incluye src, ui y assets.
// Uso: node dev/preview-server.js  →  http://127.0.0.1:8787/app.html?view=chat
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const UI = path.join(ROOT, 'ui')
const ASSETS = path.join(ROOT, 'assets')
const PORT = Number(process.env.PREVIEW_PORT || 8787)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
  })
  res.end(body)
}

function safeJoin(base, requestPath) {
  const clean = path.normalize(requestPath).replace(/^([/\\])+/, '')
  const full = path.resolve(base, clean)
  return full.startsWith(base + path.sep) ? full : null
}

function appHtml() {
  let html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8')
  html = html.replace('<script src="icons.js"></script>', '<script src="/mock-api.js"></script>\n  <script src="icons.js"></script>')
  html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script>\n  <script src="/preview-boot.js"></script>')
  return html
}

function frameHtml(query) {
  const width = Math.max(360, Math.min(1600, Number(query.get('w')) || 1280))
  const height = Math.max(520, Math.min(1100, Number(query.get('h')) || 900))
  const view = String(query.get('view') || 'chat').replace(/[^a-z-]/g, '')
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Sigil Chat · ${width}px</title>
<style>
  html,body{margin:0;background:#0b0c0f;color:#9294a5;font:12px system-ui;min-height:100%}
  iframe{display:block;border:0;width:${width}px;height:${height}px;background:#111216}
</style></head>
<body><iframe title="Sigil Chat ${view} ${width}" src="/app.html?view=${view}" width="${width}" height="${height}"></iframe></body></html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/app.html') return send(res, 200, appHtml(), TYPES['.html'])
  if (url.pathname === '/frame.html') return send(res, 200, frameHtml(url.searchParams), TYPES['.html'])
  if (url.pathname === '/mock-api.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'mock-api.js')), TYPES['.js'])
  if (url.pathname === '/preview-boot.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'preview-boot.js')), TYPES['.js'])
  if (url.pathname === '/') { res.writeHead(302, { Location: '/app.html?view=chat' }); return res.end() }

  const uiFile = safeJoin(UI, url.pathname)
  if (uiFile && fs.existsSync(uiFile) && fs.statSync(uiFile).isFile()) {
    return send(res, 200, fs.readFileSync(uiFile), TYPES[path.extname(uiFile)] || 'application/octet-stream')
  }
  const assetFile = safeJoin(ASSETS, url.pathname.replace(/^\/assets\//, ''))
  if (url.pathname.startsWith('/assets/') && assetFile && fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
    return send(res, 200, fs.readFileSync(assetFile), TYPES[path.extname(assetFile)] || 'application/octet-stream')
  }
  send(res, 404, 'No encontrado')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sigil Chat preview: http://127.0.0.1:${PORT}/app.html?view=chat`)
  console.log(`Anchos: http://127.0.0.1:${PORT}/frame.html?w=1440&view=chat`)
})
