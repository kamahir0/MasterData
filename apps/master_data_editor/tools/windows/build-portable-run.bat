@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-portable-run.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
