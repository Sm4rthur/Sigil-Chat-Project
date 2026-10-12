@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Primero instala Node.js desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
echo Instalando piezas necesarias (la primera vez tarda unos minutos)...
call npm install
if errorlevel 1 goto error
echo Creando el programa para Windows...
call npm run dist:win
if errorlevel 1 goto error
echo.
echo Listo. Los archivos .exe estan en la carpeta "dist".
explorer dist
pause
exit /b 0
:error
echo.
echo Algo fallo. Copia el mensaje de arriba y pegalo en el chat para corregirlo.
pause
exit /b 1
