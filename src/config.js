'use strict'
// Ajustes fáciles de cambiar. Todo el proyecto lee de aquí.

module.exports = {
  APP_NAME: 'PrivChat',

  // true = al crear la cuenta solo se aceptan correos @gmail.com
  REQUIRE_GMAIL: true,

  // Extensión del archivo de clave de acceso que se guarda en el pendrive
  KEYFILE_EXT: '.privchat-key',

  // undefined = usa los nodos de arranque públicos de Hyperswarm.
  // Para usar los tuyos: ['ip-o-dominio:49737']
  BOOTSTRAP: undefined,

  // Registro de nombres únicos (carpeta server/). NO usa correo ni datos personales. Si REGISTRY_URL está
  // vacío, las cuentas son solo locales y los nombres pueden repetirse. Si se completa, crear una cuenta
  // reserva el nombre para siempre y los contactos ven ✓ junto a los nombres registrados.
  //  - REGISTRY_URL: dirección https del registro (http solo se acepta para localhost)
  //  - REGISTRY_PUBKEY: clave pública que imprime el servidor al iniciar (64 caracteres)
  REGISTRY_URL: '',
  REGISTRY_PUBKEY: '',

  MAX_MESSAGE_LENGTH: 4000,
  MAX_HISTORY_PER_CHAT: 1000,
  CALL_RING_TIMEOUT_MS: 45000
}
