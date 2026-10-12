'use strict'
// Puente seguro entre la pantalla (ui/) y el programa principal (src/main.js).
// La pantalla solo puede llamar a estos canales, nada más.
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = new Set([
  'boot', 'signup', 'login', 'login-keyfile', 'logout', 'me', 'contacts', 'chat', 'send',
  'profile-get', 'profile-avatar', 'profile-save',
  'srv-list', 'srv-get', 'srv-create', 'srv-join', 'srv-leave', 'srv-messages', 'srv-send', 'srv-edit', 'srv-del', 'srv-admin',
  'font-consent', 'set-background',
  'contact-add', 'contact-remove', 'request-accept', 'request-reject',
  'call-start', 'call-accept', 'call-end', 'set-node-mode', 'set-accept-requests',
  'keyfile-create', 'keyfile-remove', 'remember-set', 'ask-mic'
])

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, arg) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('Canal no permitido'))
    return ipcRenderer.invoke(channel, arg)
  },
  sendAudio: (bytes) => ipcRenderer.send('audio-send', bytes),
  onEvent: (callback) => ipcRenderer.on('event', (_e, data) => callback(data))
})
