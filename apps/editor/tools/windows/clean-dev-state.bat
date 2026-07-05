@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean-dev-state.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
