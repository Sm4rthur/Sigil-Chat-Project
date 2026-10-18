'use strict'
// Buscador interno: se ejecuta en tu equipo sobre tus datos ya descifrados en memoria.
// No se guarda ningún índice en disco (un índice sería otra copia legible de tus mensajes) y nada sale a la red.
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin mayúsculas ni tildes

function searchAll(data, query, scope = 'all', limit = 100) {
  const terms = fold(typeof query === 'string' ? query.slice(0, 100) : '').split(/\s+/).filter(Boolean).slice(0, 6)
  if (!terms.length || terms.join('').length < 2) return []
  const hit = (text) => { const f = fold(text); return terms.every((t) => f.includes(t)) }
  const out = []

  if (scope !== 'servers') {
    for (const c of data.contacts || []) {
      for (const m of (data.chats || {})[c.key] || []) {
        const text = m.kind === 'file' && m.file ? '📎 ' + m.file.name : m.kind ? '' : m.text
        if (typeof text === 'string' && text && hit(text)) {
          out.push({ type: 'chat', key: c.key, who: c.name || c.remoteName || '', id: m.id, ts: m.ts, mine: m.from === 'me', text })
        }
      }
    }
  }
  if (scope !== 'chats') {
    for (const S of Object.values(data.servers || {})) {
      for (const ch of S.channels || []) {
        for (const m of (S.msgs || {})[ch.id] || []) {
          const text = m.kind === 'file' && m.file ? '📎 ' + m.file.name : m.text
          if (typeof text === 'string' && hit(text)) {
            out.push({ type: 'server', sid: S.id, server: S.name, cid: ch.id, channel: ch.name, id: m.id, ts: m.ts, name: m.name, text })
          }
        }
      }
    }
  }
  out.sort((a, b) => b.ts - a.ts)
  return out.slice(0, limit).map((r) => ({ ...r, text: String(r.text).slice(0, 300) }))
}

module.exports = { searchAll, fold }
