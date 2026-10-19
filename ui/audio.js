'use strict'
// Motor de audio de Sigil Chat.
//
// Captura el micrófono, lo comprime con Opus (WebCodecs incluido en el navegador
// de la app) y entrega paquetes listos para enviar por la conexión ya cifrada.
// Al recibir, descomprime y reproduce mezclando a todas las personas que hablan.
//
// Si el equipo no trae WebCodecs con Opus, cae a PCM de 16 bits de reserva, sin
// romper nada. Cada paquete lleva una etiqueta de 1 byte (1 = Opus, 0 = PCM),
// así que dos versiones distintas se entienden igual.

;(() => {
  const RATE = 48000            // Opus trabaja a 48 kHz
  const FRAME_MS = 20           // paquete de 20 ms (estándar de voz)
  const FRAME = (RATE * FRAME_MS) / 1000 // 960 muestras
  const MAX_PACKET = 8 * 1024
  const TAG_OPUS = 1
  const TAG_PCM = 0

  const canOpus = () =>
    typeof window.AudioEncoder === 'function' &&
    typeof window.AudioDecoder === 'function' &&
    typeof window.AudioData === 'function' &&
    typeof window.EncodedAudioChunk === 'function'

  const state = {
    ctx: null, stream: null, source: null, processor: null,
    encoder: null, encTs: 0, acc: null, accLen: 0,
    send: null, muted: false, opus: false,
    decoders: new Map(), // clave de quien habla -> AudioDecoder (Opus)
    nextTimes: new Map() // clave de quien habla -> cuándo empieza su próximo paquete
  }

  const isReal = (ctx) => !!ctx && typeof ctx.createBuffer === 'function'

  // ---------- Captura ----------

  function ensureCtx() {
    if (state.ctx) return state.ctx
    if (typeof window.AudioContext !== 'function') return null
    try {
      state.ctx = new window.AudioContext({ sampleRate: RATE })
    } catch {
      try { state.ctx = new window.AudioContext() } catch { state.ctx = null }
    }
    state.opus = canOpus()
    return state.ctx
  }

  async function ensureCapture() {
    if (state.processor) return
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('Este equipo no tiene micrófono disponible')
    }
    const ctx = ensureCtx()
    if (!isReal(ctx)) throw new Error('El sistema de audio no está disponible')
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    if (typeof ctx.resume === 'function') await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(2048, 1, 1)
    state.stream = stream
    state.source = source
    state.processor = processor
    state.acc = new Float32Array(FRAME)
    state.accLen = 0
    state.encTs = 0
    if (state.opus) startEncoder()
    processor.onaudioprocess = (ev) => {
      if (state.muted || !state.send) return
      pump(ev.inputBuffer.getChannelData(0))
    }
    source.connect(processor)
    processor.connect(ctx.destination) // su salida es silencio; solo hace falta que el proceso corra
  }

  function startEncoder() {
    try {
      const enc = new window.AudioEncoder({
        output: (chunk) => {
          if (state.muted || !state.send) return
          const bytes = new Uint8Array(chunk.byteLength)
          chunk.copyTo(bytes)
          sendPacket(TAG_OPUS, bytes)
        },
        error: () => { // si el codificador falla, seguimos con el plan B
          try { state.encoder && state.encoder.close() } catch {}
          state.encoder = null
          state.opus = false
        }
      })
      enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 24000 })
      state.encoder = enc
    } catch {
      state.encoder = null
      state.opus = false
    }
  }

  function sendPacket(tag, body) {
    if (!state.send || !body || !body.length) return
    if (body.length + 1 > MAX_PACKET) return
    const out = new Uint8Array(body.length + 1)
    out[0] = tag
    out.set(body, 1)
    state.send(out)
  }

  // Acumula muestras hasta completar un paquete y lo entrega.
  function pump(input) {
    const acc = state.acc
    for (let i = 0; i < input.length; i++) {
      acc[state.accLen++] = input[i]
      if (state.accLen === FRAME) {
        frame(acc)
        state.accLen = 0
      }
    }
  }

  function frame(samples) {
    if (state.opus && state.encoder) {
      try {
        const copy = new Float32Array(samples)
        const data = new window.AudioData({
          format: 'f32-planar', sampleRate: RATE, numberOfFrames: FRAME,
          numberOfChannels: 1, timestamp: Math.round(state.encTs), data: copy
        })
        state.encTs += (FRAME / RATE) * 1e6
        state.encoder.encode(data)
        data.close()
        return
      } catch {
        state.opus = false
      }
    }
    // Plan B: PCM de 16 bits (1920 bytes por paquete a 48 kHz)
    const pcm = new Int16Array(FRAME)
    for (let i = 0; i < FRAME; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    sendPacket(TAG_PCM, new Uint8Array(pcm.buffer))
  }

  // ---------- Reproducción ----------

  function play(bytes, key) {
    if (!bytes || bytes.length < 2) return
    const ctx = ensureCtx()
    if (!isReal(ctx)) return
    const tag = bytes[0]
    const body = bytes.subarray(1)
    if (tag === TAG_OPUS) {
      if (!state.opus) return // no podemos descomprimir Opus: se ignora
      decodeOpus(body, String(key || 'audio'))
    } else if (tag === TAG_PCM) {
      playPcm(body, String(key || 'audio'))
    }
  }

  function decodeOpus(body, key) {
    let d = state.decoders.get(key)
    if (!d) {
      let dec
      try {
        dec = new window.AudioDecoder({
          output: (audio) => {
            const f = new Float32Array(audio.numberOfFrames)
            try { audio.copyTo(f, { planeIndex: 0, format: 'f32-planar' }) } catch {}
            audio.close()
            schedule(f, key)
          },
          error: () => {}
        })
        dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 })
      } catch {
        return
      }
      d = { dec, ts: 0 }
      state.decoders.set(key, d)
    }
    try {
      const chunk = new window.EncodedAudioChunk({ type: 'key', timestamp: Math.round(d.ts), data: body })
      d.ts += FRAME_MS * 1000
      d.dec.decode(chunk)
    } catch {}
  }

  function playPcm(body, key) {
    const n = Math.floor(body.length / 2)
    if (!n) return
    const float = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const lo = body[i * 2]
      const hi = body[i * 2 + 1]
      let v = (hi << 8) | lo
      if (v >= 0x8000) v -= 0x10000
      float[i] = v / 32768
    }
    schedule(float, key)
  }

  // Programa un fragmento en el tiempo; varias personas suenan mezcladas.
  function schedule(float, key) {
    const ctx = state.ctx
    if (!isReal(ctx) || !float.length) return
    let buffer
    try { buffer = ctx.createBuffer(1, float.length, RATE) } catch { return }
    buffer.copyToChannel(float, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const now = ctx.currentTime
    let next = state.nextTimes.get(key) || 0
    if (next < now + 0.02 || next - now > 0.5) next = now + 0.08 // colchón de 80 ms
    try { src.start(next) } catch { return }
    state.nextTimes.set(key, next + buffer.duration)
  }

  function dropSource(key) {
    state.nextTimes.delete(String(key))
    const d = state.decoders.get(String(key))
    if (d) {
      try { d.dec.close() } catch {}
      state.decoders.delete(String(key))
    }
  }

  // ---------- Control ----------

  function stopCapture() {
    if (state.processor) {
      state.processor.onaudioprocess = null
      try { state.processor.disconnect() } catch {}
    }
    if (state.source) try { state.source.disconnect() } catch {}
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop())
    if (state.encoder) { try { state.encoder.close() } catch {} }
    state.processor = state.source = state.stream = state.encoder = null
    state.acc = null
    state.accLen = 0
  }

  async function start(send) {
    if (typeof send !== 'function') throw new Error('Falta el destino del audio')
    ensureCtx()
    await ensureCapture()
    state.send = send
    state.muted = false
  }

  function stop() {
    state.send = null
    stopCapture()
    for (const key of [...state.decoders.keys()]) dropSource(key)
    state.nextTimes.clear()
    if (state.ctx) { try { state.ctx.close() } catch {} }
    state.ctx = null
  }

  window.AudioEngine = {
    get opus() { return canOpus() },
    isRunning: () => !!state.processor,
    start,
    stop,
    setSend: (fn) => { state.send = fn || null },
    setMuted: (v) => { state.muted = !!v },
    getMuted: () => state.muted,
    play,
    dropSource,
    resume: () => { const c = ensureCtx(); if (c && typeof c.resume === 'function') c.resume().catch(() => {}) }
  }
})()
