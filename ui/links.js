'use strict'
// Enlaces dentro de mensajes. NUNCA se abren solos ni se crean elementos <a>: el texto se muestra como un
// elemento clicable que primero pide confirmación, muestra el sitio real y exige aceptar la responsabilidad.
const LinkUI = (() => {
  const byId = (id) => document.getElementById(id)
  const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
  let rpc = null
  let toast = () => {}

  function render(text, container) {
    let last = 0
    for (const m of String(text).matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:!?)\]]+$/, '') // la puntuación final no es parte del enlace
      if (m.index > last) container.append(document.createTextNode(text.slice(last, m.index)))
      const span = document.createElement('span')
      span.className = 'link'
      span.textContent = url
      span.title = 'Enlace externo: te pediremos confirmación antes de abrirlo'
      span.onclick = () => confirmOpen(url)
      container.append(span)
      last = m.index + url.length
    }
    if (last < text.length) container.append(document.createTextNode(text.slice(last)))
  }

  async function confirmOpen(url) {
    let info
    try { info = await rpc('link-check', { url }) } catch (err) { return toast(err.message) }
    if (!info.ok) return toast(info.reason)
    byId('link-host').textContent = info.host
    byId('link-url').textContent = info.url
    const ul = byId('link-warnings')
    ul.replaceChildren()
    for (const w of info.warnings) { const li = document.createElement('li'); li.textContent = '• ' + w; ul.append(li) }
    const agree = byId('link-agree')
    const open = byId('link-open')
    agree.checked = false
    open.disabled = true
    agree.onchange = () => { open.disabled = !agree.checked }
    open.onclick = async () => {
      byId('link-dialog').close()
      try { await rpc('link-open', { url: info.url }); toast('Abriendo en tu navegador…') } catch (err) { toast(err.message) }
    }
    byId('link-cancel').onclick = () => byId('link-dialog').close()
    byId('link-dialog').showModal()
  }

  function init(deps) { rpc = deps.rpc; toast = deps.toast }
  return { init, render }
})()
