'use strict'
// Privacidad de red: quién puede ver tu IP en cada situación, y un modo que reduce la exposición.
//
// IMPORTANTE: esto NO oculta tu IP. En una red directa (P2P) tus contactos y los anfitriones de tus servidores la ven siempre.
// Ocultarla de verdad requiere una VPN o repetidores en capas (ver ROADMAP.md, Fase D). Lo que sí hace el "modo privado"
// es reducir quién más puede verla: no apareces como nodo público y los desconocidos no pueden ni solicitarte.

const LEVEL = { alto: 'alto', medio: 'medio', bajo: 'bajo', info: 'info' }

function exposure({ contacts = 0, hosted = 0, joined = 0, members = 0, nodeMode = false, acceptRequests = true, registry = false } = {}) {
  const rows = [
    { who: 'Tus contactos (' + contacts + ')', sees: 'Tu IP, en cuanto se conectan contigo: la conexión es directa.', level: LEVEL.alto },
    { who: 'Anfitriones de servidores donde participas (' + joined + ')', sees: 'Tu IP. Los demás miembros NO la ven: todo pasa por el anfitrión.', level: LEVEL.medio }
  ]
  if (hosted > 0) rows.push({ who: 'Miembros de tus servidores (' + members + ')', sees: 'Tú ves la IP de cada miembro que se conecta a tu equipo.', level: LEVEL.info })
  rows.push(nodeMode
    ? { who: 'Red pública (DHT)', sees: 'Tu IP puede quedar publicada en las tablas de la red como nodo: es la opción más expuesta.', level: LEVEL.alto }
    : { who: 'Red pública (DHT)', sees: 'Los nodos de arranque ven tu IP cuando buscan a tus contactos, pero no apareces como nodo.', level: LEVEL.medio })
  rows.push(acceptRequests
    ? { who: 'Desconocidos que sepan tu código', sees: 'Pueden conectarse (y ver tu IP) y enviarte solicitudes.', level: LEVEL.alto }
    : { who: 'Desconocidos que sepan tu código', sees: 'Su intento de conexión llega a tu equipo, pero se rechaza al instante y no pueden escribirte.', level: LEVEL.bajo })
  if (registry) rows.push({ who: 'Registro de nombres', sees: 'Tu IP, una sola vez, al crear la cuenta.', level: LEVEL.bajo })
  rows.push({ who: 'Sitios de los enlaces que abras', sees: 'Su sitio ve tu IP: se abren en tu navegador, fuera de PrivChat.', level: LEVEL.medio })
  return rows
}

const PRESETS = {
  private: { nodeMode: false, acceptRequests: false },
  normal: { nodeMode: true, acceptRequests: true }
}

const modeOf = (s) => (!s.nodeMode && !s.acceptRequests ? 'private' : s.nodeMode && s.acceptRequests ? 'normal' : 'custom')

module.exports = { exposure, PRESETS, modeOf }
