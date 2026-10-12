'use strict'
// Arranque del registro de nombres. Variables de entorno (todas opcionales):
//   PORT         puerto (por defecto 8787)
//   DATA_DIR     carpeta de datos y claves (por defecto ./data)
//   DIFFICULTY   prueba de trabajo exigida a quien reclama un nombre (por defecto 20, unos segundos de cálculo)
//   TRUST_PROXY  1 si corre detrás de un proxy de confianza (necesario en muchos hostings)
const path = require('path')
const { createServer } = require('./app')

const port = Number(process.env.PORT) || 8787
const app = createServer({
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  difficulty: Number(process.env.DIFFICULTY) || 20,
  trustProxy: process.env.TRUST_PROXY === '1'
})

app.server.listen(port, () => {
  console.log('Registro de nombres de PrivChat escuchando en el puerto ' + port)
  console.log('\nCopia esta clave pública en src/config.js (REGISTRY_PUBKEY):\n  ' + app.publicHex + '\n')
  console.log('Haz copia de seguridad de la carpeta de datos. Si pierdes secrets.json, hay que publicar una versión nueva de la app.')
})
