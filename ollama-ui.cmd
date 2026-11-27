@echo off
setlocal
set "ROOT=%~dp0"

where pwsh >nul 2>nul
if not errorlevel 1 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start-ollama-ui.ps1" %*
  exit /b %errorlevel%
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start-ollama-ui.ps1" %*
exit /b %errorlevel%
