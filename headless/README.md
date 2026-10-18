# Anfitrión 24/7 (Raspberry Pi u otro equipo siempre encendido)

Un servidor de PrivChat vive en el equipo de quien lo aloja. Si ese equipo es tu PC y lo apagas, el servidor se detiene.
Con este anfitrión sin pantalla puedes dejarlo en una **Raspberry Pi** (o cualquier mini-PC, servidor o VPS) funcionando
todo el día. **El dueño del servidor sigues siendo tú (o quien elijas)**, y lo administras desde la app de escritorio.

## Qué necesitas
- Raspberry Pi 4 o 5 (o similar) con **Raspberry Pi OS de 64 bits** (también sirve Debian/Ubuntu), conexión a internet y Node.js 20 o superior.
- No hace falta abrir puertos en el router en la mayoría de casos (la conexión se perfora sola). Si tu red es muy restrictiva, puede fallar.

## Instalación (Raspberry Pi OS / Debian / Ubuntu)
```bash
# 1. Node.js (si no lo tienes): https://nodejs.org o con el gestor de paquetes de tu sistema
# 2. Usuario sin privilegios y código
sudo useradd --system --create-home --shell /usr/sbin/nologin privchat
sudo mkdir -p /opt/privchat && sudo chown $USER /opt/privchat
cp -r privchat/* /opt/privchat/        # la carpeta del proyecto (sin node_modules)
cd /opt/privchat && npm install --omit=dev    # --omit=dev evita descargar Electron (no se necesita aquí)
sudo chown -R privchat /opt/privchat

# 3. Crear el servidor, indicando el CÓDIGO del dueño (se copia desde su app: "Tu código")
sudo -u privchat node headless/index.js create "Mi comunidad" --owner CODIGO_DEL_DUEÑO --data /var/lib/privchat-host
#    -> imprime un código de unión: el dueño lo pega en "Unirme" en su app

# 4. Dejarlo funcionando siempre
sudo cp headless/privchat-host.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now privchat-host
sudo journalctl -u privchat-host -f          # ver el registro
```
Después el dueño crea invitaciones y administra canales, roles y moderación **desde su app**, igual que siempre.

## Comandos
`info` (muestra el código del anfitrión) · `create "Nombre" --owner <código>` [`--sin-cifrado`] · `list` · `run`. Opciones: `--data <carpeta>`, `--name <nombre>`.

## Seguridad
- Corre con un usuario sin privilegios y con las restricciones de systemd del archivo `.service`.
- **En servidores cifrados (por defecto) este equipo NO puede leer los mensajes:** solo guarda y reparte sobres cifrados, porque las claves las tiene el dueño y los miembros. Ve metadatos (quién escribe y cuándo) y las IP. Con la opción `--sin-cifrado` el servidor no está cifrado y el anfitrión sí puede leerlo todo.
- Los datos van cifrados, pero la clave debe estar disponible sin contraseña. Por defecto se guarda en `host.key` (permisos 600) junto a los datos:
  protege de curiosos, **no** de quien robe el disco entero. Mejor: cifra el disco de la Raspberry o entrega la clave por la variable
  `PRIVCHAT_HOST_KEY` (64 caracteres hexadecimales) desde el servicio.
- Haz **copias de seguridad** de la carpeta de datos (`/var/lib/privchat-host`) y de la clave. Quien tenga ambas puede leer los datos.
- Actualiza con frecuencia el sistema y Node.js. Este anfitrión no se actualiza solo.
- El anfitrión no atiende chats directos ni solicitudes de contacto: solo servidores.
