# PrivChat (prototipo)

Chat y llamadas de audio entre computadores, **sin servidor central** y sin pedir datos personales ni biométricos.
Cada PC guarda sus propios datos, cifrados, y se conecta directamente con los de sus amigos.

> **Estado: prototipo 0.6.** La lógica de cuentas, cifrado, chat y llamadas está probada con tests
> automáticos (`npm test`), pero la conexión por internet real y la ventana de la app **todavía no se han
> probado en dos computadores**. Hazlo antes de compartir el proyecto (ver "Probarla").

## Cómo ejecutarla

1. Instala [Node.js](https://nodejs.org) (versión LTS).
2. Abre una terminal dentro de esta carpeta.
3. Escribe `npm install` (descarga las piezas necesarias; solo la primera vez). Esto crea `package-lock.json`:
   guárdalo en el repositorio, fija las versiones exactas y evita sorpresas.
4. Escribe `npm start`.
5. Opcional: `npm test` ejecuta las pruebas automáticas (cuentas, red simulada, ataques simulados, perfiles, servidores, recorrido de la interfaz y revisión de seguridad).

## Nombres de usuario únicos (opcional)

**Aclaración importante:** tu nombre de usuario no da acceso a tus mensajes. Todo va ligado a tu *código* (tu clave), así que
nadie puede leer tus chats por llamarse igual que tú. El riesgo de un nombre repetido es la **suplantación**: aparecer con
tu mismo nombre para engañar a tus contactos. Para evitarlo, el proyecto incluye un pequeño **registro de nombres**
(carpeta `server/`) que **no pide correo ni ningún dato personal**.

Cuando está activado:
- Al crear la cuenta se reserva el nombre **para siempre**. Si ya existe, no se puede crear.
- Cuenta como repetido aunque cambien las mayúsculas, los puntos o los guiones, o se parezca (`Ana`, `an.a`, `1uis`/`luis`).
  Los nombres solo usan letras sin tilde, números y `. _ -`, para que nadie copie un nombre con letras de otro alfabeto.
- Para frenar a quien quiera acaparar nombres, cada reserva exige unos segundos de cálculo en tu PC y hay un límite diario por conexión.
- Cada cuenta recibe un **certificado firmado** ligado a su código. Tus contactos lo comprueban sin contactar al registro y
  ven ✓ junto a los nombres registrados; los demás aparecen como "sin registrar". Un nombre registrado no puede usarlo otro código.
- El registro guarda solo el nombre y el código público. No ve chats, contactos ni llamadas.

Cómo probarlo en tu PC (no necesita instalar nada):
1. En una terminal dentro de la carpeta `server`, escribe `node index.js`.
2. Copia la clave pública de 64 caracteres que imprime.
3. En `src/config.js` completa `REGISTRY_URL: 'http://localhost:8787'` y `REGISTRY_PUBKEY: 'la-clave-copiada'`.
4. Inicia la app (`npm start`) y crea una cuenta. Intenta crear otra con el mismo nombre: será rechazada.

Para usarlo de verdad hace falta un lugar donde el registro esté **encendido siempre y con https** (un servidor pequeño o el plan
gratuito de algún hosting; revisa las condiciones vigentes; con proxy, inicia con `TRUST_PROXY=1`), hacer **copia de seguridad de
`server/data/`** (ahí está la clave de firma) y poner la dirección y la clave en `src/config.js` **antes de crear el instalador**.

Limitaciones: sin el registro configurado los nombres pueden repetirse (los contactos igual se distinguen por su código); las cuentas
creadas antes quedan "sin registrar"; no se puede cambiar ni recuperar un nombre; si el registro cae, nadie puede crear cuentas nuevas
(chats y llamadas siguen funcionando). El campo de Gmail del registro de cuenta es solo una etiqueta local: no se envía a ningún lado.

## Servidores (grupos)

Un servidor **vive en el PC de quien lo crea** (el "anfitrión"): ahí están los canales, miembros, roles e historial, y los
demás se conectan a él. Por eso:
- **Si el PC del anfitrión está apagado o la app cerrada, el servidor está inactivo.** Activa el modo segundo plano (Ajustes).
- **Cifrado de extremo a extremo (🔒):** en los servidores nuevos cada mensaje va firmado por su autor y cifrado, de modo que ni el anfitrión ni un repetidor (por ejemplo, una Raspberry Pi) pueden leerlo ni falsificarlo. Solo el dueño crea invitaciones y reparte las claves; quien entra lee desde que se une; los mensajes no se editan (sí se borran). Los servidores antiguos quedan marcados ⚠ y su anfitrión sí puede leerlos. Detalles y límites en [SECURITY.md](SECURITY.md).
- **Canales de voz** (🔊): además de los canales de texto, un servidor puede tener canales de voz. Se entra y se sale desde el propio canal, sin ventana aparte; ves quién está dentro y quién tiene el micrófono silenciado. El audio va por la misma conexión cifrada y lo reparte el PC del anfitrión (una "SFU" sencilla): el anfitrión reenvía la voz de cada persona al resto del canal, sin oírse a sí mismo. Es para grupos pequeños (unas 8–10 personas).
- Máximo 50 miembros, 25 canales y 10 servidores por anfitrión.

Cómo se usa: en la barra lateral, **Crear servidor** (se crea el canal `#general`); **Invitar** genera un código con validez y
número de usos a tu elección; quien lo recibe pulsa **Unirme** y lo pega. Los cambios se ven al instante para todos.

| Rol | Puede |
|---|---|
| Miembro | Escribir, editar y borrar sus mensajes |
| Moderador | Además: invitar, silenciar, expulsar a miembros y borrar mensajes de otros |
| Admin | Además: banear, crear/renombrar/eliminar canales, renombrar el servidor, asignar roles de moderador o miembro, ver el registro de acciones |
| Dueño | Todo, incluida la creación de admins y la eliminación del servidor |

Nadie puede actuar sobre alguien con su mismo rango o mayor. Un expulsado puede volver con una invitación; un baneado no.

**Todavía no incluye:** federación (co-anfitriones y repetidores comunitarios), pantalla compartida, archivos en servidores,
reacciones, hilos, permisos por canal, emojis propios, bots e integraciones, ni verificación de claves entre miembros.
La [hoja de ruta](ROADMAP.md) explica el orden y por qué.

## Privacidad de red

En **Ajustes → Privacidad de red** ves, para tu caso, **quién puede ver tu IP** (contactos, anfitriones, la red pública, desconocidos, sitios de enlaces). Hay un **modo privado**
que *reduce* la exposición: dejas de aparecer como nodo de la red y se rechaza al instante a quien no sea tu contacto ni un servidor tuyo.

**Esto no oculta tu IP.** La conexión es directa, así que tus contactos y los anfitriones de tus servidores la ven siempre, y el cifrado protege el contenido, no la IP.
Para ocultarla de verdad usa una VPN de confianza. Los repetidores en capas están en la [hoja de ruta](ROADMAP.md) (Fase D) y no se anunciarán como "anonimato" hasta que existan y los revise alguien especializado.

## Anfitrión 24/7 (Raspberry Pi)

Para que un servidor no dependa de que tu PC esté encendido, instala el anfitrión sin pantalla en una Raspberry Pi o similar: mira [headless/README.md](headless/README.md).
El dueño sigue siendo quien tú elijas y se administra desde la app de escritorio.

## Segundo plano

En Ajustes: **Mantener PrivChat en segundo plano al cerrar la ventana** (queda un icono junto al reloj para abrirla o salir del
todo) e **Iniciar con el sistema** (solo en la versión instalada; abre la app oculta; para que entre sola activa también
"Recordar en este dispositivo"). Mientras esté en segundo plano, tu PC sigue en línea: tus servidores funcionan y recibes mensajes.

## Versión para Windows (.exe)

**El `.exe` no puede venir dentro de este zip**: se genera a partir del código en un equipo con internet (descarga Electron,
unos 100 MB), y donde se creó este zip no hay conexión. Pero **una sola vez** lo generas y desde entonces tus usuarios
instalan y listo: el instalador ya incluye todo, **no necesitan Node.js ni ningún otro programa**.

**Forma más fácil, sin instalar nada (GitHub):**
1. Crea una cuenta gratis en github.com y un repositorio nuevo **público** (botón *New*).
2. Sube el contenido de esta carpeta: en el repositorio, *Add file → Upload files* y arrastra TODO.
   **Importante:** la carpeta `.github` empieza con punto y Windows puede ocultarla. Antes, en el Explorador: *Vista → Mostrar →
   Elementos ocultos*. Sin esa carpeta no se genera el instalador.
3. Entra a la pestaña **Actions**, elige **Compilar para Windows** y pulsa **Run workflow** (si GitHub pide habilitar las acciones, acéptalo).
4. A los 5–10 minutos abre la ejecución terminada y baja **PrivChat-Windows** (sección *Artifacts*): trae el instalador, la
   versión portable y `SHA256SUMS.txt`. Si algo falla, el registro indica el motivo: pégalo en el chat y se corrige.
5. Entrega a tus usuarios `PrivChat-Instalador-<versión>.exe` (o la portable, que no instala nada).

**En un PC con Windows:** instala [Node.js](https://nodejs.org) y haz doble clic en `build-windows.bat`; los archivos aparecen en `dist`.
**Con comandos:** `npm install` y luego `npm run dist:win`.

**Aviso de Windows:** como el programa no está firmado digitalmente (la firma cuesta dinero), Windows mostrará
"Windows protegió su PC". Hay que pulsar *Más información* → *Ejecutar de todas formas*. Si el proyecto crece, conviene
publicar el código y los hashes del archivo para que cualquiera pueda verificar qué está ejecutando.

Esta configuración de empaquetado todavía no se ha probado de punta a punta.

## Probarla

- **Con dos computadores:** instala y abre la app en ambos, crea una cuenta en cada uno, copia el
  "código" de uno y pégalo en "Añadir contacto" del otro. En el primero aparecerá una solicitud: acéptala.
- **Con un solo computador** (dos ventanas con datos separados):
  - Mac/Linux: `PRIVCHAT_DATA=./datos-b npm start` en una segunda terminal.
  - Windows (PowerShell): `$env:PRIVCHAT_DATA="./datos-b"; npm start`
- Para llamadas: ambos deben conceder permiso de micrófono. Usa auriculares para evitar eco.

## Qué hace

- **Ver la contraseña:** casilla "Mostrar contraseña" al iniciar sesión y al crear la cuenta (se vuelve a ocultar sola).
- **Cuentas locales:** Gmail, usuario y contraseña. Todo se guarda en tu PC en un archivo cifrado (AES-256-GCM,
  clave derivada con scrypt). No hay servidor de cuentas.
- **Clave de acceso en pendrive (opcional):** se ofrece justo después de crear la cuenta. Guarda un archivo
  `.privchat-key`; al conectar el pendrive, la app entra sola. Se puede crear o quitar en Ajustes.
- **Recordar en este dispositivo:** guarda la sesión en el llavero del sistema operativo.
- **Servidores (grupos)** estilo Discord, alojados en el PC de quien los crea: canales de **texto y de voz**, **cifrado de extremo a extremo**, invitaciones, roles
  (dueño, admin, moderador, miembro) y **roles personalizables** (nombre, color y rango base), expulsar, banear, silenciar, editar y borrar mensajes, registro de acciones,
  menciones con `@usuario` e historial. Ver la sección "Servidores".
- **Archivos en chats:** envía documentos, fotos y otros archivos (máx. 10 MB). Quien los recibe decide si descargarlos; hay vista previa de imágenes y texto, y la app **nunca abre ni ejecuta** un archivo.
- **Enlaces con advertencia:** abrir un enlace externo exige confirmar y aceptar que es bajo tu absoluta responsabilidad; se muestra el sitio real y avisos (acortadores, direcciones numéricas, dominios que imitan a otros).
- **Buscador interno** de mensajes antiguos (chats y servidores), sin tildes ni mayúsculas, hecho en tu equipo sin guardar ningún índice.
- **Apariencia:** tema automático, claro, oscuro, gris o personalizado (colores de fondo, paneles, letra, bordes y acento; foto de fondo; efecto cristal semitransparente).
- **Pantalla de carga** al abrir, mientras se prepara tu cuenta y la conexión.
- **Anfitrión 24/7 en una Raspberry Pi** u otro equipo siempre encendido (carpeta `headless/`).
- **Segundo plano:** la app puede seguir en línea al cerrar la ventana (icono junto al reloj) y abrirse sola al iniciar el sistema.
- **Historial de llamadas** dentro de cada chat: salientes, entrantes, perdidas, rechazadas y su duración.
- **Perfil social:** foto de perfil con recorte (arrastras y acercas viendo cómo queda en el círculo), estado y una página
  personal tipo blog: fondo de color o imagen, cuadros de texto (fuente, tamaño, color, negrita, cursiva, alineación) e
  imágenes que se mueven, redimensionan y **giran libremente** (arrastra el círculo de la esquina superior izquierda;
  con Mayús, saltos de 15°). Acepta **PNG animado (APNG)** y WebP animado. Puedes subir **tus propias fuentes** (hasta 4)
  para tu nombre y tus textos; a quien no las tenga, la app le pregunta si quiere descargarlas para ver tu perfil como lo
  diseñaste. Solo tus contactos reciben tu perfil.
- **Chat:** mensajes directos y cifrados de extremo a extremo. Si tu contacto no está conectado, el mensaje
  queda pendiente (⏳) y se envía solo cuando ambos coincidan en línea.
- **Solicitudes:** si alguien con tu código te escribe, queda como solicitud; puedes aceptar o rechazar y bloquear.
- **Llamadas de audio** por la misma conexión cifrada (sin servidores de terceros), comprimidas con **Opus**
  (WebCodecs) a ~24 kbps: se oyen mejor y consumen mucha menos conexión que antes.
- **Canales de voz en servidores:** entra y sal del canal desde la propia lista; el anfitrión reparte el audio
  entre quienes están dentro y se ve quién habla y quién está silenciado. Se usa el mismo motor de audio que las llamadas.
- **Modo nodo:** tu PC se une a la red pública (DHT) y ayuda a otros a encontrarse, con muy poco consumo.
- **Permisos:** solo micrófono; cámara y todo lo demás se niegan.
- **Seguridad reforzada:** límites contra abuso, validación de todo dato de red, pantalla aislada, freno de intentos
  de contraseña, ajuste para aceptar solo contactos conocidos y protecciones al crear el instalador.
  Todo el detalle (y lo que sigue siendo un riesgo) está en [SECURITY.md](SECURITY.md).

## Limitaciones (importante)

- **El Gmail es solo una etiqueta local** (no se verifica ni se envía a ningún lado).
  Si olvidas la contraseña y no tienes pendrive, los datos no se pueden recuperar.
- **La cuenta vive en un solo PC.** No hay inicio de sesión desde otro equipo (futuro: exportar/importar).
- **No es 100 % sin infraestructura.** Para encontrarse por primera vez usa los nodos de arranque públicos de
  Hyperswarm (como BitTorrent). Puedes cambiarlos en `src/config.js` (`BOOTSTRAP`) y operar los tuyos.
- **Tus contactos ven tu IP** (es una conexión directa). Si necesitas anonimato fuerte, hay que añadir Tor/relays.
- **Mensajes sin servidor:** si ambos nunca coinciden en línea, no se entregan.
- **Llamadas y voz:** solo audio, sin video. Se comprime con Opus (WebCodecs) a ~24 kbps; si el equipo no
  trae WebCodecs con Opus, se usa un PCM de 16 bits de reserva. Usa auriculares para evitar eco. En algunas
  redes muy restrictivas la conexión directa puede fallar.
- **"Modo nodo":** la red decide cuándo tu PC califica como nodo (conexión estable y accesible).
  No retransmite chats de otros ni guarda mensajes ajenos.
- **Seguridad:** el código no ha sido auditado. Antes de usarlo con gente que lo necesite de verdad,
  pide una revisión de seguridad. Lee [SECURITY.md](SECURITY.md).
- **Sin actualización automática:** cuando Electron publique correcciones de seguridad, hay que generar y
  distribuir una versión nueva.

## Cómo está organizado

| Archivo | Para qué sirve |
|---|---|
| `src/config.js` | Ajustes fáciles de cambiar (Gmail obligatorio, nodos de arranque, límites) |
| `src/main.js` | Ventana, permisos y conexión entre pantalla, cuentas y red |
| `src/accounts.js` | Crear cuenta, contraseña, clave de pendrive, recordar dispositivo |
| `src/storage.js`, `src/crypto.js` | Archivo de datos cifrado |
| `src/network.js` | Red P2P: nodo, contactos, mensajes, llamadas |
| `src/registry.js`, `src/shared.js` | Cliente del registro de nombres y reglas compartidas (usuario, certificados, prueba de trabajo) |
| `src/profile.js` | Validación estricta del perfil (todo lo que llega de otros se limpia aquí) |
| `src/servers.js` | Servidores: roles, invitaciones, moderación, historial (lado anfitrión y lado miembro) |
| `ui/profile.js`, `ui/servers.js` | Pantallas del perfil (ver y editar) y de los servidores |
| `ui/audio.js` | Motor de audio: captura, Opus (WebCodecs), mezcla y reproducción de la voz |
| `assets/icon.png` | Icono de la app, del instalador y de la bandeja |
| `server/` | Registro opcional de nombres únicos (se ejecuta aparte, sin dependencias) |
| `src/frames.js` | Formato de los paquetes que viajan entre PCs |
| `ui/` | La pantalla (HTML, CSS, JavaScript) |
| `test/` | Pruebas automáticas (`npm test`) |

## Siguientes pasos sugeridos

Federación con co-anfitriones y repetidores comunitarios (Fase B), archivos cifrados dentro de los servidores,
canales de voz y pantalla compartida (Fase C), ocultar la IP mediante repetidores (Fase D), exportar/importar
y recuperar la cuenta, actualización automática del programa y una revisión de seguridad externa.
El orden y los motivos están en [ROADMAP.md](ROADMAP.md).

## Licencia y colaboración

Software libre bajo **GNU AGPL-3.0 o posterior** (ver [LICENSE](LICENSE)). Para colaborar lee [CONTRIBUTING.md](CONTRIBUTING.md); lo que falta y el orden de las próximas funciones, en [ROADMAP.md](ROADMAP.md).

