[CmdletBinding()]
param(
  [string]$PackageUrl = "https://github.com/alivirgo/3aik-web2/releases/latest/download/3aik-cli.tgz"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 24 or newer is required. Install Node.js, reopen PowerShell, and run this script again."
}

$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 24) {
  throw "Node.js 24 or newer is required; found $(& node --version)."
}

& npm install --global $PackageUrl
if ($LASTEXITCODE -ne 0) { throw "npm could not install the 3aik CLI." }

& 3aik --version
if ($LASTEXITCODE -ne 0) { throw "3aik was installed, but its command is not available on PATH. Reopen the terminal and try again." }

Write-Host "3aik is ready. Run: 3aik doctor"
