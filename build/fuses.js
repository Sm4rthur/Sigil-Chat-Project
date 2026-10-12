'use strict'
// Se ejecuta solo al crear el instalador (electron-builder lo llama después de empaquetar).
// Apaga funciones de Electron que un atacante podría usar contra la app ya instalada:
//  - ELECTRON_RUN_AS_NODE: convertir el programa en un intérprete de Node con tus permisos
//  - NODE_OPTIONS y --inspect: inyectar código o abrir un depurador remoto
//  - cargar código de la app desde fuera del paquete app.asar
// Si algo falla, el instalador NO se crea (mejor no publicar que publicar sin proteger).
const path = require('path')

module.exports = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses')
  const platform = context.electronPlatformName
  const productName = context.packager.appInfo.productFilename

  let target
  if (platform === 'win32') target = path.join(context.appOutDir, productName + '.exe')
  else if (platform === 'darwin') target = path.join(context.appOutDir, productName + '.app')
  else target = path.join(context.appOutDir, context.packager.executableName)

  await flipFuses(target, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
  console.log('  • protecciones de seguridad (fuses) aplicadas a', path.basename(target))
}
