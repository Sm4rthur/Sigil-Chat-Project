'use strict'
// Formato de cada "paquete" que viaja entre dos computadores:
//   [4 bytes: largo][1 byte: tipo][contenido]
//
// SEGURIDAD: este código lee datos que envía un desconocido, así que es estricto:
// largos máximos, y el lector no hace trabajo repetido aunque lleguen los datos de a 1 byte.

const T_JSON = 0   // chat y control de llamadas (texto JSON)
const T_AUDIO = 1  // audio de la llamada (Opus; o PCM 16 bits de reserva)
const T_FILE = 2   // parte de un archivo: [8 bytes id][4 bytes número][datos]
const T_VOICE = 3  // audio de un canal de voz: [16 sid][8 cid][64 hablante][Opus]

const MAX_FRAME = 64 * 1024       // tope duro del lector
const MAX_JSON_FRAME = 20 * 1024  // 4000 caracteres ocupan como máximo ~16 KB
const MAX_AUDIO_FRAME = 8 * 1024  // paquete de audio de una llamada
const MAX_VOICE_FRAME = 4 * 1024  // paquete de audio de un canal de voz
const VOICE_HEADER = 16 + 8 + 64  // sid + cid + clave del hablante

function encodeFrame(type, payload) {
  const header = Buffer.alloc(5)
  header.writeUInt32BE(payload.length + 1, 0)
  header[4] = type
  return Buffer.concat([header, payload])
}

// Junta los pedazos que llegan por la red y entrega paquetes completos.
// Guarda los pedazos en una lista y solo los une cuando el paquete está completo.
class FrameParser {
  constructor(onFrame, maxFrame = MAX_FRAME) {
    this.onFrame = onFrame
    this.max = maxFrame
    this.chunks = []
    this.size = 0
    this.need = 0 // bytes totales del paquete en curso (0 = aún no se leyó el largo)
  }

  push(chunk) {
    if (!chunk.length) return
    this.chunks.push(chunk)
    this.size += chunk.length
    for (;;) {
      if (!this.need) {
        if (this.size < 4) return
        const len = this._peekLength()
        if (len < 1 || len > this.max) throw new Error('Paquete inválido')
        this.need = 4 + len
      }
      if (this.size < this.need) return
      const frame = this._take(this.need)
      this.need = 0
      this.onFrame(frame[4], frame.subarray(5))
    }
  }

  _peekLength() {
    const first = this.chunks[0]
    if (first.length >= 4) return first.readUInt32BE(0)
    const b = Buffer.alloc(4)
    let got = 0
    for (const c of this.chunks) {
      const n = Math.min(4 - got, c.length)
      c.copy(b, got, 0, n)
      got += n
      if (got === 4) break
    }
    return b.readUInt32BE(0)
  }

  _take(n) {
    const parts = []
    let left = n
    let i = 0
    while (left > 0) {
      const c = this.chunks[i]
      if (c.length <= left) {
        parts.push(c)
        left -= c.length
        i++
      } else {
        parts.push(c.subarray(0, left))
        this.chunks[i] = c.subarray(left)
        left = 0
      }
    }
    this.chunks.splice(0, i)
    this.size -= n
    return parts.length === 1 ? parts[0] : Buffer.concat(parts)
  }
}

module.exports = {
  T_JSON, T_AUDIO, T_FILE, T_VOICE,
  MAX_FRAME, MAX_JSON_FRAME, MAX_AUDIO_FRAME, MAX_VOICE_FRAME, VOICE_HEADER,
  encodeFrame, FrameParser
}
