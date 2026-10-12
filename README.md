# Sigil-chat Project

Chat y llamadas de audio entre computadores, **sin servidor central** y sin pedir datos personales ni biométricos.
Cada PC guarda sus propios datos, cifrados, y se conecta directamente con los de sus amigos.

> \*\*Estado: prototipo 0.1.\*\* La lógica de cuentas, cifrado, chat y llamadas está probada con tests
> automáticos (`npm test`), pero la conexión por internet real y la ventana de la app \*\*todavía no se han
> probado en dos computadores\*\*. Hazlo antes de compartir el proyecto (ver "Probarla").

## 

## Nombres de usuario únicos 

* Al crear la cuenta se reserva el nombre **para siempre**. Si ya existe, no se puede crear.
* Cuenta como repetido aunque cambien las mayúsculas, los puntos o los guiones, o se parezca (`Ana`, `an.a`, `1uis`/`luis`).
Los nombres solo usan letras sin tilde, números y `. \_ -`, para que nadie copie un nombre con letras de otro alfabeto.
* Para frenar a quien quiera acaparar nombres, cada reserva exige unos segundos de cálculo en tu PC y hay un límite diario por conexión.
* Cada cuenta recibe un **certificado firmado** ligado a su código. Tus contactos lo comprueban sin contactar al registro y
ven ✓ junto a los nombres registrados; los demás aparecen como "sin registrar". Un nombre registrado no puede usarlo otro código.
* El registro guarda solo el nombre y el código público. No ve chats, contactos ni llamadas.

## 

## Servidores (grupos)

Un servidor **vive en el PC de quien lo crea** (el "anfitrión"): ahí están los canales, miembros, roles e historial, y los
demás se conectan a él. Por eso:

* **Si el PC del anfitrión está apagado o la app cerrada, el servidor está inactivo.** Activa el modo segundo plano (Ajustes).
* **El anfitrión puede leer todo lo que se escribe en su servidor.** La conexión va cifrada hasta él, pero no es cifrado de extremo a extremo entre miembros.
* Máximo 50 miembros, 25 canales y 10 servidores por anfitrión.

Cómo se usa: en la barra lateral, **Crear servidor** (se crea el canal `#general`); **Invitar** genera un código con validez y
número de usos a tu elección; quien lo recibe pulsa **Unirme** y lo pega. Los cambios se ven al instante para todos.

|Rol|Puede|
|-|-|
|Miembro|Escribir, editar y borrar sus mensajes|
|Moderador|Además: invitar, silenciar, expulsar a miembros y borrar mensajes de otros|
|Admin|Además: banear, crear/renombrar/eliminar canales, renombrar el servidor, asignar roles de moderador o miembro, ver el registro de acciones|
|Dueño|Todo, incluida la creación de admins y la eliminación del servidor|

Nadie puede actuar sobre alguien con su mismo rango o mayor. Un expulsado puede volver con una invitación; un baneado no.

**Todavía no incluye** (próximas versiones): canales de voz, reacciones, archivos adjuntos, hilos, roles personalizados, permisos por
canal, emojis propios, búsqueda, bots e integraciones.

## Segundo plano

En Ajustes: **Mantener PrivChat en segundo plano al cerrar la ventana** (queda un icono junto al reloj para abrirla o salir del
todo) e **Iniciar con el sistema** (solo en la versión instalada; abre la app oculta; para que entre sola activa también
"Recordar en este dispositivo"). Mientras esté en segundo plano, tu PC sigue en línea: tus servidores funcionan y recibes mensajes.

## 

## Qué hace

* **Ver la contraseña:** casilla "Mostrar contraseña" al iniciar sesión y al crear la cuenta (se vuelve a ocultar sola).
* **Cuentas locales:** Gmail, usuario y contraseña. Todo se guarda en tu PC en un archivo cifrado (AES-256-GCM,
clave derivada con scrypt). No hay servidor de cuentas.
* **Clave de acceso en pendrive (opcional):** se ofrece justo después de crear la cuenta. Guarda un archivo
`.privchat-key`; al conectar el pendrive, la app entra sola. Se puede crear o quitar en Ajustes.
* **Recordar en este dispositivo:** guarda la sesión en el llavero del sistema operativo.
* **Servidores (grupos)** estilo Discord, alojados en el PC de quien los crea: canales de texto, invitaciones, roles
(dueño, admin, moderador, miembro), expulsar, banear, silenciar, editar y borrar mensajes, registro de acciones,
menciones con `@usuario` e historial. Ver la sección "Servidores".
* **Segundo plano:** la app puede seguir en línea al cerrar la ventana (icono junto al reloj) y abrirse sola al iniciar el sistema.
* **Historial de llamadas** dentro de cada chat: salientes, entrantes, perdidas, rechazadas y su duración.
* **Perfil social:** foto de perfil con recorte (arrastras y acercas viendo cómo queda en el círculo), estado y una página
personal tipo blog: fondo de color o imagen, cuadros de texto (fuente, tamaño, color, negrita, cursiva, alineación) e
imágenes que se mueven, redimensionan y **giran libremente** (arrastra el círculo de la esquina superior izquierda;
con Mayús, saltos de 15°). Acepta **PNG animado (APNG)** y WebP animado. Puedes subir **tus propias fuentes** (hasta 4)
para tu nombre y tus textos; a quien no las tenga, la app le pregunta si quiere descargarlas para ver tu perfil como lo
diseñaste. Solo tus contactos reciben tu perfil.
* **Chat:** mensajes directos y cifrados de extremo a extremo. Si tu contacto no está conectado, el mensaje
queda pendiente (⏳) y se envía solo cuando ambos coincidan en línea.
* **Solicitudes:** si alguien con tu código te escribe, queda como solicitud; puedes aceptar o rechazar y bloquear.
* **Llamadas de audio** por la misma conexión cifrada (sin servidores de terceros).
* **Modo nodo:** tu PC se une a la red pública (DHT) y ayuda a otros a encontrarse, con muy poco consumo.
* **Permisos:** solo micrófono; cámara y todo lo demás se niegan.
* **Seguridad reforzada:** límites contra abuso, validación de todo dato de red, pantalla aislada, freno de intentos
de contraseña, ajuste para aceptar solo contactos conocidos y protecciones al crear el instalador.
Todo el detalle (y lo que sigue siendo un riesgo) está en [SECURITY.md](SECURITY.md).
* ## Limitaciones 

**El Gmail es solo una etiqueta local** (no se verifica ni se envía a ningún lado).
Si olvidas la contraseña y no tienes pendrive, los datos no se pueden recuperar.

* **La cuenta vive en un solo PC.** No hay inicio de sesión desde otro equipo (futuro: exportar/importar).
* **No es 100 % sin infraestructura.** Para encontrarse por primera vez usa los nodos de arranque públicos de
Hyperswarm (como BitTorrent). Puedes cambiarlos en `src/config.js` (`BOOTSTRAP`) y operar los tuyos.
* **Tus contactos ven tu IP** (es una conexión directa). Si necesitas anonimato fuerte, hay que añadir Tor/relays.
* **Mensajes sin servidor:** si ambos nunca coinciden en línea, no se entregan.
* **Llamadas:** solo audio, sin compresión (\~256 kbps) y sin video. En algunas redes muy restrictivas
la conexión directa puede fallar.
* **"Modo nodo":** la red decide cuándo tu PC califica como nodo (conexión estable y accesible).
No retransmite chats de otros ni guarda mensajes ajenos.
* **Seguridad:** el código no ha sido auditado. Antes de usarlo con gente que lo necesite de verdad,
pide una revisión de seguridad. Lee [SECURITY.md](SECURITY.md).
* **Sin actualización automática:** cuando Electron publique correcciones de seguridad, hay que generar y
distribuir una versión nueva.

## Cómo está organizado

|Archivo|Para qué sirve|
|-|-|
|`src/config.js`|Ajustes fáciles de cambiar (Gmail obligatorio, nodos de arranque, límites)|
|`src/main.js`|Ventana, permisos y conexión entre pantalla, cuentas y red|
|`src/accounts.js`|Crear cuenta, contraseña, clave de pendrive, recordar dispositivo|
|`src/storage.js`, `src/crypto.js`|Archivo de datos cifrado|
|`src/network.js`|Red P2P: nodo, contactos, mensajes, llamadas|
|`src/registry.js`, `src/shared.js`|Cliente del registro de nombres y reglas compartidas (usuario, certificados, prueba de trabajo)|
|`src/profile.js`|Validación estricta del perfil (todo lo que llega de otros se limpia aquí)|
|`src/servers.js`|Servidores: roles, invitaciones, moderación, historial (lado anfitrión y lado miembro)|
|`ui/profile.js`, `ui/servers.js`|Pantallas del perfil (ver y editar) y de los servidores|
|`assets/icon.png`|Icono de la app, del instalador y de la bandeja|
|`server/`|Registro opcional de nombres únicos (se ejecuta aparte, sin dependencias)|
|`src/frames.js`|Formato de los paquetes que viajan entre PCs|
|`ui/`|La pantalla (HTML, CSS, JavaScript)|
|`test/`|Pruebas automáticas (`npm test`)|



