@echo off
setlocal
if "%~1"=="" (
  set "THREEAIK_PACKAGE=https://github.com/alivirgo/3aik-web2/releases/latest/download/3aik-cli.tgz"
) else (
  set "THREEAIK_PACKAGE=%~1"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install Node.js, reopen Command Prompt, and try again.
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  exit /b 1
)

call npm install --global "%THREEAIK_PACKAGE%"
if errorlevel 1 exit /b %errorlevel%

call 3aik --version
if errorlevel 1 (
  echo 3aik was installed, but its command is not available on PATH. Reopen the terminal and try again.
  exit /b 1
)

echo 3aik is ready. Run: 3aik doctor
exit /b 0
