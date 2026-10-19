'use strict'
// Acciones automáticas para las capturas del previsualizador.
// No se carga en la app real; solo desde dev/preview-server.js.
;(() => {
  const view = new URLSearchParams(location.search).get('view') || 'chat'
  if (view === 'login' || view === 'signup') return

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const byId = (id) => document.getElementById(id)
  const until = async (fn, timeout = 5000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (fn()) return true
      await wait(50)
    }
    return false
  }

  async function main() {
    // Capturas deterministas: sin transiciones de color a medio camino.
    const noTransitions = document.createElement('style')
    noTransitions.textContent = '*, *::before, *::after { transition: none !important; }'
    document.head.append(noTransitions)

    // Previsualizador sin micrófono real: el motor de audio no debe pedir permisos.
    if (window.__mock && window.AudioEngine) {
      window.AudioEngine.start = async () => {}
      window.AudioEngine.stop = () => {}
      window.AudioEngine.play = () => {}
    }

    await until(() => byId('screen-main') && !byId('screen-main').hidden)
    await wait(180)

    // Dos avisos de mensajes sin leer para que el panel muestre sus estados.
    if (window.__mock) {
      window.__mock.emit({ type: 'chat', key: window.__mock.contacts[2].key, incoming: true })
      window.__mock.emit({ type: 'chat', key: window.__mock.contacts[3].key, incoming: true })
      await wait(80)
    }

    const firstContact = () => document.querySelector('#contacts .nav-item')
    const firstServer = () => document.querySelector('#servers .nav-item')

    if (view === 'chat' || view === 'profile' || view === 'call' || view === 'call-active' || view === 'drawer') {
      const contact = firstContact()
      if (contact) contact.click()
      await wait(450)
      const messages = byId('messages')
      if (messages) messages.scrollTop = 0
      if (view === 'profile') {
        byId('btn-profile').click()
        await wait(450)
      }
      if (view === 'call' && window.__mock) {
        window.__mock.emit({ type: 'call', call: { state: 'ringing', name: 'Mara' } })
        await wait(200)
      }
      if (view === 'call-active' && window.__mock) {
        // Sin micrófono en el previsualizador: se evita que el motor de audio corte la llamada.
        if (window.AudioEngine) window.AudioEngine.start = async () => {}
        window.__mock.emit({ type: 'call', call: { state: 'active', name: 'Mara', startedAt: Date.now() - 84000 } })
        await wait(300)
      }
      if (view === 'drawer') {
        byId('btn-nav-chats').click()
        await wait(300)
      }
      return
    }

    if (view === 'server-voice') {
      byId('btn-nav-servers').click()
      await wait(150)
      const server = firstServer()
      if (server) server.click()
      await wait(650)
      const voiceBtn = document.querySelector('#srv-channels .chan-voice')
      if (voiceBtn) voiceBtn.click()
      await wait(250)
      return
    }

    if (view === 'server' || view === 'server-members' || view === 'server-settings' || view === 'server-roles' || view === 'server-members-settings' || view === 'server-role-form') {
      byId('btn-nav-servers').click()
      await wait(120)
      const server = firstServer()
      if (server) server.click()
      await wait(650)
      const messages = byId('srv-messages')
      if (messages) messages.scrollTop = 0
      if (view === 'server-settings' || view === 'server-roles' || view === 'server-members-settings' || view === 'server-role-form') {
        byId('srv-settings').click()
        await wait(300)
        if (view === 'server-roles' || view === 'server-role-form') {
          document.querySelector('[data-srv-panel="roles"]').click()
          await wait(150)
          if (view === 'server-role-form') {
            byId('srv-role-add').click()
            await wait(150)
          }
        }
        if (view === 'server-members-settings') {
          document.querySelector('[data-srv-panel="members"]').click()
          await wait(150)
        }
      }
      return
    }

    if (view === 'server-context') {
      byId('btn-nav-servers').click()
      await wait(350)
      const card = document.querySelector('#servers-grid .server-card')
      if (card) {
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 340, clientY: 300 }))
        await wait(200)
      }
      return
    }

    if (view === 'contacts' || view === 'contacts-add') {
      byId('btn-nav-contacts').click()
      await wait(300)
      if (view === 'contacts-add') {
        byId('btn-contacts-add').click()
        await wait(300)
      }
      return
    }

    if (view === 'servers-home') {
      byId('btn-nav-servers').click()
      await wait(300)
      return
    }

    if (view === 'settings' || view === 'settings-privacy' || view === 'settings-appearance' || view === 'notifications') {
      byId('btn-settings').click()
      await wait(550)
      if (view === 'settings-privacy') {
        document.querySelector('[data-settings-panel="privacy"]').click()
        await wait(120)
      }
      if (view === 'notifications') {
        document.querySelector('[data-settings-panel="notifications"]').click()
        await wait(150)
      }
      if (view === 'settings-appearance') {
        document.querySelector('[data-settings-panel="appearance"]').click()
        await wait(120)
      }
      return
    }

    if (view === 'context-menu') {
      byId('btn-nav-contacts').click()
      await wait(300)
      const row = document.querySelector('#friends-list .friend-row') || firstContact()
      if (row) {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 430 }))
        await wait(200)
      }
      return
    }

    if (view === 'privacy') {
      byId('btn-privacy').click()
      await wait(400)
      return
    }

    if (view === 'search') {
      byId('btn-search').click()
      await wait(120)
      byId('search-q').value = '21:00'
      byId('search-q').dispatchEvent(new Event('input', { bubbles: true }))
      await wait(650)
      return
    }

    if (view === 'theme') {
      byId('btn-theme').click()
      await wait(400)
      return
    }

    // view=empty: deja la conversación vacía a propósito.
  }

  function freezeTransitions() {
    // Los estilos en línea sí cortan una transición ya iniciada (la hoja con !important no siempre).
    for (const node of document.querySelectorAll('*')) node.style.transition = 'none'
  }

  main().then(freezeTransitions).catch((err) => {
    console.error('preview-boot:', err)
    document.title = 'ERROR: ' + err.message
  })
})()
