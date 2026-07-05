$ErrorActionPreference = "Stop"

$AppName = "MasterData Editor Dev"
$AppIdentifier = "com.kamahir0.masterdata.editor.dev"

Get-Process |
    Where-Object { $_.ProcessName -eq "master_data_editor" -or $_.MainWindowTitle -eq $AppName } |
    Stop-Process -Force -ErrorAction SilentlyContinue

$Paths = @(
    (Join-Path $env:APPDATA "$AppIdentifier\config"),
    (Join-Path $env:APPDATA "$AppIdentifier\data"),
    (Join-Path $env:LOCALAPPDATA "$AppIdentifier\cache"),
    (Join-Path $env:LOCALAPPDATA "$AppIdentifier\config"),
    (Join-Path $env:LOCALAPPDATA "$AppIdentifier\data"),
    (Join-Path $env:LOCALAPPDATA "$AppName"),
    (Join-Path $env:LOCALAPPDATA "Programs\$AppName")
)

foreach ($Path in $Paths) {
    if (Test-Path $Path) {
        Remove-Item -Recurse -Force $Path
        Write-Host "Removed: $Path"
    }
}

Write-Host "Cleaned $AppName development state."
