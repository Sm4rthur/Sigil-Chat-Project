# Cómo colaborar con PrivChat

¡Gracias por querer ayudar! Este proyecto busca ser una alternativa de mensajería que no exija datos personales.
No hace falta saber programar para colaborar: probar, reportar errores, mejorar textos o traducir también ayuda mucho.

## Formas de ayudar

| Si… | Puedes… |
|---|---|
| No programas | Probar la app en dos computadores o redes distintas y contar qué falló; mejorar el README; traducir; sugerir ideas |
| Programas | Corregir errores, mejorar pruebas, implementar algo de [ROADMAP.md](ROADMAP.md) |
| Sabes de seguridad o criptografía | **Revisar el diseño y el código** (lo más valioso hoy), sobre todo `src/network.js`, `src/servers.js`, `src/profile.js` y `src/files.js` |

## Reglas de seguridad (no negociables)

Es una app de privacidad: un error aquí daña a personas reales. Por eso:

1. **No inventes criptografía.** Usa solo `crypto` de Node, Noise vía Hyperswarm o librerías auditadas y conocidas. Un cambio que toque cifrado, claves o identidad necesita explicar su diseño en el *pull request*.
2. **Todo dato que llega de la red o de otra persona es hostil.** Se valida (tipo, largo, formato, rango) antes de usarse y se dibuja con `textContent`, nunca con `innerHTML`. Los nuevos tipos de mensaje necesitan límites de tamaño y de velocidad.
3. **Nada se abre ni se ejecuta solo.** Ni archivos, ni enlaces, ni código recibido. Todo lo que salga de la app hacia el sistema requiere una acción y confirmación del usuario.
4. **Permisos mínimos.** Si una función necesita un permiso nuevo (cámara, pantalla…), debe pedirse solo cuando se usa y quedar explicado en `SECURITY.md`.
5. **No prometas lo que no puedes cumplir.** Si algo no es anónimo, no lo llames anónimo; si el anfitrión puede leer algo, dilo.
6. **Cada función nueva trae sus pruebas**, incluidas pruebas de abuso (datos mal formados, tamaños enormes, remitentes sin permiso). Mira `test/` para ver cómo se simula la red sin internet. Si tu cambio procesa datos que llegan de la red, `npm test` ya incluye un *fuzzer*; para más intensidad: `FUZZ_SEED=7 FUZZ_ROUNDS=120 node test/fuzz.js`.

## Preparar el entorno

```bash
npm install        # descarga las piezas (incluye Electron, unos 100 MB)
npm test           # corre todas las pruebas: deben pasar TODAS
npm start          # abre la app
```
Para probar dos usuarios en un mismo PC: `PRIVCHAT_DATA=./datos-b npm start` (Windows PowerShell: `$env:PRIVCHAT_DATA="./datos-b"; npm start`).

## Cómo está organizado

Hay un mapa de carpetas y archivos en el [README](README.md#cómo-está-organizado). En corto: `src/` es el programa principal y la red,
`ui/` la pantalla (sin acceso a Node), `server/` el registro opcional de nombres, `headless/` el anfitrión sin pantalla y `test/` las pruebas.

## Enviar un cambio (pull request)

1. Haz un *fork* y crea una rama con un nombre claro (`arregla-recorte-foto`, `agrega-prueba-archivos`).
2. Cambios pequeños y enfocados: un tema por PR.
3. Ejecuta `npm test` y asegúrate de que pasa todo.
4. En la descripción explica **qué** cambia, **por qué** y **qué riesgo de seguridad** podría tener.
5. Sé paciente y amable en la revisión: es un proyecto de personas, no de una empresa.

## Estilo de código

- JavaScript simple y comentado en español, pensado para que alguien que recién empieza pueda seguirlo.
- Sin dependencias nuevas salvo que haya una razón fuerte (cada dependencia es superficie de ataque). Si agregas una, explica por qué.
- Los mensajes que ve la persona usuaria, en español claro y sin tecnicismos.

## Reportar un problema

- **Errores comunes:** abre un *issue* con pasos para reproducirlo, tu sistema y, si puedes, el mensaje de error.
- **Vulnerabilidades de seguridad:** **no las publiques en un issue.** Sigue las instrucciones de [SECURITY.md](SECURITY.md#reportar-una-vulnerabilidad).

## Licencia de tus aportes

Al enviar un cambio aceptas que se publique bajo la licencia del proyecto, **GNU AGPL-3.0 o posterior** (ver [LICENSE](LICENSE)).

## Conducta

Trata a todas las personas con respeto. No se toleran acoso, discriminación ni ataques personales. Las discusiones son sobre el código y las ideas, no sobre las personas.
