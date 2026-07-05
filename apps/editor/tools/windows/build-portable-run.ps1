$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$WorkspaceRoot = Resolve-Path (Join-Path $AppRoot "..\..")
$ReleaseDir = Join-Path $WorkspaceRoot "target\release"

Set-Location $AppRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Install Node.js before building the editor."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo was not found. Install Rust before building the editor."
}

if (-not (Test-Path (Join-Path $AppRoot "node_modules"))) {
    npm install
}

npm run tauri:build:dev

$Exe = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -File |
    Where-Object { $_.Name -notlike "*setup*" -and $_.Name -notlike "*installer*" } |
    Sort-Object Name |
    Select-Object -First 1

if (-not $Exe) {
    throw "Release .exe was not found under $ReleaseDir"
}

Start-Process -FilePath $Exe.FullName
Write-Host "Started: $($Exe.FullName)"
