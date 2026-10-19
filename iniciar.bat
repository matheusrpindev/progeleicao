@echo off
chcp 65001 >nul
title Sistema de Votacao - NAO FECHE ESTA JANELA
mode con: cols=120 lines=40
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado neste computador.
  echo  Veja o passo 1 do arquivo README.md.
  echo.
  pause
  exit /b 1
)

rem Arquivo que o npm so grava quando a instalacao termina com sucesso.
if not exist "node_modules\.package-lock.json" (
  echo.
  echo  Primeira execucao: instalando os componentes. Isso precisa de INTERNET...
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo  Nao foi possivel instalar. Verifique a internet e tente de novo.
    pause
    exit /b 1
  )
)

:ligar
node --disable-warning=ExperimentalWarning src\server.js
echo.
echo  O sistema parou. Pressione uma tecla para liga-lo de novo (ou feche a janela para desligar).
pause >nul
goto ligar
