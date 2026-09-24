@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

echo Starting local Discord backend...
node server.js
