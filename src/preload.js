'use strict'
// Puente seguro entre la pantalla (ui/) y el programa principal (src/main.js).
// La pantalla solo puede llamar a estos canales, nada más.
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = new Set([
  'boot', 'signup', 'login', 'login-keyfile', 'logout', 'me', 'contacts', 'chat', 'send',
  'profile-get', 'profile-avatar', 'profile-save',
  'srv-list', 'srv-get', 'srv-create', 'srv-join', 'srv-leave', 'srv-messages', 'srv-send', 'srv-edit', 'srv-del', 'srv-admin',
  'font-consent', 'set-background', 'link-check', 'link-open', 'search', 'privacy-get', 'privacy-set', 'file-send', 'file-download', 'file-get', 'file-save',
  'contact-add', 'contact-remove', 'request-accept', 'request-reject',
  'call-start', 'call-accept', 'call-end', 'set-node-mode', 'set-accept-requests',
  'notify-get', 'notify-set', 'mute-contact', 'mute-server',
  'keyfile-create', 'keyfile-remove', 'remember-set', 'ask-mic',
  'srv-voice-join', 'srv-voice-leave', 'srv-voice-mute'
])

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, arg) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('Canal no permitido'))
    return ipcRenderer.invoke(channel, arg)
  },
  sendAudio: (bytes) => ipcRenderer.send('audio-send', bytes),
  sendVoice: (sid, cid, bytes) => ipcRenderer.send('voice-send', { sid, cid, buf: bytes }),
  onEvent: (callback) => ipcRenderer.on('event', (_e, data) => callback(data))
})
