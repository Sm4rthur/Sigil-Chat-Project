# Seguridad de PrivChat

> Estado: prototipo **sin auditoría externa**. Las protecciones de abajo están revisadas y probadas por
> tests automáticos (`npm test`), pero eso no reemplaza una revisión de un experto antes de que lo use
> gente que dependa de su privacidad.

## Qué se protege y de quién

| Amenaza | Qué hace la app |
|---|---|
| Un desconocido que conoce tu código intenta escribirte o llamarte | Solo los **contactos** pueden escribir o llamar. Los desconocidos quedan como "solicitud" que tú aceptas o rechazas (y bloqueas). Opción en Ajustes para **no aceptar solicitudes** de nadie nuevo. |
| Alguien intenta colapsar la app con paquetes enormes o mal formados | Todo dato de red se valida. Paquetes >20 KB (chat) u >8 KB (audio) se rechazan, el JSON se verifica, y ante datos inválidos la conexión se corta. |
| Inundación de mensajes, solicitudes, llamadas o conexiones | Límites por conexión (velocidad), tope de conexiones de desconocidos (8) y de solicitudes guardadas (20), una conexión que no se presenta en 10 s se corta, invitaciones de llamada espaciadas, avisos del sistema limitados. |
| Suplantación de nombre ("Mamá", "Soporte") | El nombre lo elige quien escribe, así que se avisa en pantalla; se eliminan caracteres invisibles y de inversión de texto; contactos con el mismo nombre se distinguen con parte de su código; al aceptar, el nombre queda fijo. |
| Alguien intercepta tus mensajes en internet | La conexión es cifrada de extremo a extremo y autenticada con la clave pública del contacto (protocolo Noise de Hyperswarm). |
| Robo del archivo de datos de tu PC | Contactos y chats están cifrados (AES-256-GCM) con una clave protegida por tu contraseña (scrypt). Contraseña mínima de 10 caracteres, sin las más comunes. |
| Adivinar tu contraseña probando muchas | La app frena los intentos fallidos (5 por usuario, 25 en total, con espera creciente). |
| Código malicioso en la pantalla (XSS) | La pantalla corre aislada y sin acceso a Node, nunca inserta HTML de mensajes ajenos, no tiene enlaces clicables, y su CSP bloquea scripts y recursos externos. |
| La pantalla comprometida intenta salir a internet o abrir páginas | Se bloquean todas las peticiones web, la navegación, las ventanas nuevas y los webviews. Solo se permite micrófono (sin cámara) y copiar al portapapeles. |
| Mensajes falsos hacia el programa principal | Solo se atienden mensajes de la ventana propia y cada dato se valida (tipo, largo, formato). |
| Abusar del programa instalado (variables de entorno, depurador remoto) | Al crear el instalador se apagan los *fuses* de Electron: `RunAsNode`, `NODE_OPTIONS`, `--inspect`, y se exige cargar la app solo desde `app.asar`. |
| Herramientas de desarrollo abiertas en la versión final | Desactivadas en la versión empaquetada. |
| Fuga de privacidad por el corrector ortográfico | Desactivado (podía descargar diccionarios de internet). |
| Archivos adulterados al descargar | Cada versión publica `SHA256SUMS.txt` y certificación de procedencia (GitHub). |

**Lo que la app NO puede ser usada para hacer:** no es un proxy ni un relay general (no retransmite tráfico de terceros),
no transfiere archivos, no abre enlaces y no ejecuta nada recibido. La única retransmisión es la de los **mensajes de texto de
los servidores que tú alojas**, hacia sus propios miembros. Mantener estas limitaciones reduce mucho la superficie de ataque;
cualquier función nueva de ese tipo (archivos, enlaces, relays) necesita revisión de seguridad propia.

## Perfil social (foto y página personal)

El perfil de otra persona es **contenido no confiable** que se dibuja en tu pantalla, así que pasa por una sola puerta
(`validateProfile`, en `src/profile.js`) tanto al recibirlo como al guardar el tuyo y al leerlo del disco.

| Amenaza | Qué hace |
|---|---|
| Inyectar código (XSS) con texto, estilos o nombres | Los textos se dibujan con `textContent`; no existe HTML, CSS libre ni enlaces. Fuentes de una lista cerrada, colores solo `#rrggbb`, números acotados; todo lo desconocido se descarta. |
| Imágenes que ejecuten algo (SVG, HTML) | Solo PNG, JPEG y WebP, comprobados por su cabecera real (no por lo que dicen ser). SVG y cualquier otro formato se rechazan. |
| "Bombas" de imagen (pocos bytes, miles de millones de píxeles) | Se leen las dimensiones de la cabecera sin decodificar: máximo 2400 px (512 px la foto de perfil) y pesos máximos por imagen y en total. |
| Perfil gigante o transferencia interminable | Tope de 2 MB, 200 partes, solo se acepta si TÚ lo pediste, la versión debe coincidir, orden estricto de partes, límite de tiempo y de ritmo. Datos fuera de lo declarado cancelan la descarga. |
| Un desconocido espía o scrapea tu perfil | Solo se entrega a contactos, y solo cuando lo piden. Un contacto no puede obligarte a reenviar lo mismo sin parar. |
| Perfiles en el disco | Cifrados, un archivo por contacto, y vueltos a validar al leerlos. |
| Navegación o carga de recursos externos desde el perfil | No hay enlaces ni imágenes remotas; la política CSP bloquea todo lo externo. |

Riesgos propios: un contacto puede mostrar contenido molesto u ofensivo (la app no modera el texto); quien ve tu perfil puede
guardar una captura de él. Antes de publicar, conviene una revisión adicional del procesamiento de imágenes de Chromium
mediante actualizaciones frecuentes de Electron.

## Registro de nombres (`server/`, opcional)

| Amenaza | Qué hace |
|---|---|
| Suplantar a alguien con su mismo nombre | Un nombre solo se puede reservar una vez; la comparación ignora mayúsculas, signos, 0/o y 1/i/l, y solo admite ASCII (sin letras de otros alfabetos). Los contactos ven ✓ en nombres registrados y "sin registrar" en los demás. |
| Acaparar muchos nombres | Cada reserva exige una prueba de trabajo (unos segundos de cálculo) ligada al nombre y al código, y hay límites diarios por conexión y totales. Frena, pero no hace imposible el acaparamiento. |
| Falsificar o copiar un certificado | Está firmado (Ed25519) y ligado al código del usuario: copiarlo a otro código no sirve, y la app solo confía en la clave pública fijada en `config.js`. Se comprueba sin conectarse al registro. |
| Un servidor falso o alterado | La app exige https (http solo en localhost), no sigue redirecciones, limita el cálculo que puede pedir y comprueba firma, nombre y código del certificado. |
| Abuso del servicio | Cuerpos de máximo 1 KB, solo JSON, tiempos de espera cortos, sin dependencias externas. |
| Fuga de datos del registro | Solo guarda nombre y código público: no hay correos ni mensajes ni contactos. |

Riesgos propios:
- **Es un punto central.** Si cae, no se crean cuentas nuevas (lo ya creado sigue funcionando). Quien lo opera ve la IP de quien reserva un nombre.
- **Si se filtra la clave de firma** (`secrets.json`) alguien podría emitir certificados falsos; habría que publicar una versión nueva con otra clave. No hay revocación individual.
- **Los nombres no se pueden cambiar ni recuperar.** Sin el registro configurado, los nombres pueden repetirse.

## Llamadas y chat

Cada lado anota las llamadas en su propio chat (no viaja información extra por la red). Los registros no generan avisos del sistema salvo las llamadas perdidas.

## Servidores (grupos alojados por el creador)

El anfitrión es la autoridad; cada lado desconfía del otro.

| Amenaza | Qué hace |
|---|---|
| Un miembro intenta hacer lo que no le corresponde (banear, borrar, ascenderse) | Cada acción pasa por una tabla de permisos en el PC del anfitrión; nadie actúa sobre un rango igual o mayor; solo el dueño crea admins. La pantalla no decide nada: el anfitrión valida. |
| Un desconocido intenta escribir, administrar o cerrar un servidor | Se ignora todo lo que no venga de un miembro. Para unirse hace falta una invitación válida (aleatoria de 64 bits, con vencimiento y número de usos). Los baneados no pueden volver. |
| Datos mal formados o gigantes | Todo se valida (tipos, largos, formato); mensajes de máximo 2000 caracteres; ante datos inválidos se descarta o se corta la conexión. |
| Inundación de mensajes | Límite por miembro y por conexión; quien se excede recibe un aviso. Máximo 50 miembros y 20 invitaciones activas. |
| Alguien que no es el anfitrión se hace pasar por el servidor | Los miembros solo aceptan estado, mensajes, historial e invitaciones que vengan de la clave del anfitrión de ESE servidor. |
| Un anfitrión malicioso manda contenido hostil | Todo lo recibido se limpia igual que el perfil: texto plano, sin HTML. Puede mostrar nombres o mensajes falsos dentro de su propio servidor (ver riesgos). |
| Conexiones de "turistas" que ocupan cupos | Quien dice venir por un servidor y no se une en 10 s se corta; no genera solicitudes de chat. |

Riesgos propios:
- **El anfitrión lee todo y puede alterarlo:** mensajes, quién dijo qué y el historial. No hay cifrado de extremo a extremo entre miembros ni firmas por mensaje. Elige anfitriones de confianza.
- **Si el anfitrión se apaga, el servidor se detiene** y su historial solo existe en su PC (y en las copias parciales de los miembros).
- **Quien tenga un código de invitación puede unirse** mientras sea válido: compártelo solo por canales de confianza y con pocos usos.
- Los nombres dentro de un servidor los entrega el anfitrión; la marca ✓ indica que esa persona tiene nombre registrado.

## Fuentes propias, imágenes animadas y segundo plano

- **Fuentes:** los archivos de fuente los interpreta el navegador, un componente históricamente delicado. Mitigaciones: solo
  .woff2/.woff/.ttf/.otf comprobados por su firma real (no por la extensión), máximo 300 KB y 4 por perfil, sin colecciones (.ttc),
  y **en pantalla solo se cargan si el usuario acepta** (en tu propio perfil, siempre). La carga usa los bytes ya recibidos: no pide nada a internet.
  Riesgo residual: un fallo en el procesador de fuentes del navegador; mantener Electron actualizado. Además, sube solo fuentes con licencia que permita compartirlas.
- **PNG/WebP animados:** se recorre su estructura completa (bloques coherentes, IEND al final, nada sobrante), máximo 300 fotogramas y 50 millones de
  píxeles en total (ancho × alto × fotogramas) para evitar animaciones que agoten la memoria. Se conserva el archivo original (no se vuelve a dibujar) para no perder la animación.
- **Rotación y recorte:** son solo números acotados (grados, zoom y desplazamiento); no ejecutan nada.
- **Segundo plano e inicio con el sistema:** la app sigue en línea con la ventana oculta (por eso hay un icono visible y "Salir del todo").
  El inicio automático registra la app para tu usuario de Windows y la abre con un parámetro que solo oculta la ventana. Quien use tu usuario puede ver
  la app activa; si usas "Recordar en este dispositivo", entra sin contraseña (ver riesgos de esa opción).

## Riesgos que siguen existiendo

- **Tu IP es visible para tus contactos** y la red DHT sabe que "alguien busca tu código". Para anonimato fuerte
  haría falta Tor u otro sistema de relays.
- **Programas maliciosos en tu propio PC** (virus, keyloggers) pueden leer tu sesión. Ninguna app los detiene.
  "Recordar en este dispositivo" guarda la sesión en el llavero de tu usuario de Windows: cualquiera que use ese
  usuario puede abrir la app. No lo actives en equipos compartidos.
- **La clave de acceso del pendrive** equivale a una llave: quien tenga el pendrive entra a tu cuenta.
- **No hay actualización automática.** Las vulnerabilidades de Electron/Chromium se corrigen en versiones nuevas;
  hay que publicar e instalar nuevas versiones. Dependabot está activado para avisar. Mientras tanto, versiones
  viejas del programa quedan expuestas.
- **El instalador no está firmado digitalmente**, por eso Windows advierte. Verifica siempre el SHA-256.
- **Dependencias de terceros** (Hyperswarm y sus librerías, Electron): un fallo en ellas afecta a la app.
  `npm audit` se ejecuta en cada compilación.
- **El "Gmail" es solo una etiqueta local** y la cuenta es local: no sirve como identidad ante otros. Sin el registro de nombres, los nombres pueden repetirse.
- **Sin auditoría de criptografía.** Se usan solo librerías estándar (Node `crypto`, Noise vía Hyperswarm),
  pero la forma de combinarlas debe ser revisada por un experto.
- **Códigos de contacto:** compártelos por un canal que confíes. Quien tenga tu código puede enviarte
  solicitudes (no mensajes) mientras aceptes solicitudes.

## Antes de publicar una versión

1. `npm test` en verde (también corre en GitHub antes de crear el instalador).
2. `npm audit` sin vulnerabilidades altas o críticas; actualizar Electron si salió una versión nueva
   (soportan las 3 últimas versiones mayores).
3. Subir `package-lock.json` al repositorio (se crea con el primer `npm install`) para que todos instalen
   exactamente las mismas versiones.
4. Probar a mano: crear cuenta, contactos, chat, llamada, pendrive, "recordar", y una prueba entre redes distintas.
5. Publicar el archivo `SHA256SUMS.txt` junto al instalador.

## Cómo verificar un archivo descargado (Windows)

En PowerShell: `Get-FileHash .\PrivChat-Instalador-0.1.0.exe -Algorithm SHA256` y compara el resultado con
`SHA256SUMS.txt` de la misma versión.

## Reportar una vulnerabilidad

Escribe en privado a la persona que mantiene el proyecto (añade aquí un correo de contacto) y no publiques
el detalle hasta que haya una corrección. Si el repositorio está en GitHub, activa *Private vulnerability reporting*
en Settings > Security.
