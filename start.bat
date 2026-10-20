@echo off
chcp 65001 >nul
title RDR Local
cd /d "%~dp0"

rem Precisa de administrador: edita o arquivo hosts e instala a CA local do HTTPS.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js nao encontrado. Instalando via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js instalado. FECHE esta janela e abra o start.bat novamente.
  pause
  exit /b
)

node server.js
pause
