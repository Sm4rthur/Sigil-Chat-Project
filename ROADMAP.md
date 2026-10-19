# Hoja de ruta

Estado actual: **prototipo 0.6, sin auditoría de seguridad.** Este documento explica qué falta, **por qué está en ese orden** y qué decisiones de diseño
hay que tomar. Varias funciones pedidas (federación, repetidores, cifrado de extremo a extremo, voz, pantalla, ocultar la IP) **dependen unas de otras**:
construirlas por separado y deprisa produciría cifrado o "anonimato" que parece proteger y no protege. Por eso se hacen en fases.

## Ya hecho (hasta 0.6)
Chat y llamadas P2P · perfiles (foto con recorte, página personal, fuentes propias, PNG animado, rotación) · servidores alojados por el creador con roles y moderación ·
modo segundo plano · anfitrión sin pantalla para Raspberry Pi (24/7) · compartir archivos en chats (límite, vista previa segura, descarga aceptada) ·
advertencia al abrir enlaces · buscador interno · temas (claro, oscuro, gris, personalizado con foto y cristal) · pantalla de carga · registro opcional de nombres únicos · **0.5:** mensajes firmados y cifrado de extremo a extremo en servidores (un repetidor o anfitrión ve solo sobres cifrados) · panel de privacidad de red con modo privado · fuzzer de seguridad ·
**0.6:** llamadas y canales de voz de servidor con Opus (WebCodecs), paquetes de 20 ms y reenvío por el anfitrión (una "SFU" sencilla) · roles personalizables por servidor.

## Fase B — Servidores v2 (la base de todo lo demás)

**Problema de hoy:** el anfitrión lee todo, puede falsificar mensajes y, si se apaga, el servidor se detiene.

1. ✅ **Hecho en 0.5 — Mensajes firmados.** Cada mensaje lo firma su autor (Ed25519, con la identidad que ya existe). Los anfitriones y repetidores no pueden inventar mensajes ni atribuirlos a otro.
2. ✅ **Hecho en 0.5 (primera versión, sin auditoría) — Cifrado de extremo a extremo para servidores.** *Pendiente: números de seguridad entre miembros y migrar a MLS.* Una clave de grupo por "época", entregada cifrada a cada miembro; se renueva al expulsar o banear.
   Se usa AEAD estándar (`crypto` de Node) con una construcción conocida. *Limitación honesta:* sin renovación continua por mensaje, no hay "post-compromiso". Para una versión
   robusta se recomienda **MLS (RFC 9420)** con una librería auditada en cuanto exista una madura para JavaScript. Quien no deba leer nada (anfitrión, repetidores) solo ve texto cifrado.
3. **(Siguiente) Co-anfitriones y repetidores comunitarios (federación).** *Ya se puede usar un anfitrión 24/7 ciego (Raspberry Pi); falta la lista firmada de nodos autorizados, la réplica entre ellos y la conmutación.* El dueño publica un *manifiesto firmado* con los nodos autorizados. Esos nodos **replican mensajes cifrados**, los guardan y los entregan aunque
   los demás estén desconectados. **No tienen poder de administración** (roles, baneos, invitaciones): solo el dueño/anfitrión principal las ordena, y puede promover a otro anfitrión manualmente.
   Así se evita el "cerebro dividido" (dos anfitriones decidiendo cosas distintas). Decisión a tomar: *principal-secundario* (más simple y seguro, recomendado) frente a *múltiples escritores* (más disponible, mucho más complejo).
4. **Archivos en servidores**, cifrados con la clave del grupo y con las mismas reglas (límite de peso, descarga aceptada, vista previa segura).

Orden: 1 → 2 → 3 → 4. Los puntos 3 y 4 sin el 2 expondrían los mensajes a los repetidores.

## Fase C — Voz y pantalla
- ✅ **Hecho en 0.6 (primera versión, sin auditoría) — Canales de voz grupales:** códec Opus mediante `AudioEncoder`/`AudioDecoder` de Chromium (WebCodecs), paquetes de 20 ms, reenvío por el anfitrión (una "SFU" simple), búfer anti-jitter por hablante y cancelación de eco.
  Límite razonable: unas 8–10 personas hablando. *Pendiente:* clave de grupo propia para el audio, cifrado por paquete y una SFU real para grupos grandes.
- **Compartir pantalla:** selector explícito de pantalla o ventana (permiso solo al usarlo, indicador visible), `VideoEncoder` (VP8/H.264) con tope de resolución y de tasa de datos, solo hacia visores conectados.

Dependen de la Fase B (claves de grupo y nodos que reenvían).

## Fase D — Ocultar la IP
Hoy tus contactos y la red DHT ven tu IP. Opciones, de más sencilla a más ambiciosa:
0. ✅ **Hecho en 0.5 — Panel "Privacidad de red"** (quién ve tu IP en cada caso) y **modo privado** que reduce la exposición. No oculta la IP.
1. **Guía de uso con VPN** (ya aplicable, sin cambios de código).
2. **Modo "solo repetidores":** las conexiones no van directas; pasan por repetidores comunitarios. Tus contactos ya no ven tu IP, **pero el repetidor sí** (y el DHT sigue viendo búsquedas). Requiere la Fase B3.
3. **Enrutado en capas tipo cebolla (3 saltos)** o integración con Tor/I2P/Nym: es un proyecto en sí. *Nota técnica:* Hyperswarm usa UDP y Tor no lo transporta, por lo que haría falta otro canal de transporte.

**No se anunciará "anonimato" hasta que haya un diseño revisado por especialistas.** Prometer lo que no se cumple pone en riesgo a quien confíe.

## Siempre pendiente
Auditoría de seguridad externa · firma digital del instalador · actualización automática · exportar/importar cuenta · recuperación de cuenta · reacciones, hilos y permisos por canal en servidores · traducciones.

## Cómo sumarte
Lee [CONTRIBUTING.md](CONTRIBUTING.md). Lo más valioso ahora: **revisión de diseño de la Fase B** por personas con experiencia en criptografía y sistemas distribuidos.
