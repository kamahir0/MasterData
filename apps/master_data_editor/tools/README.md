# MasterData Editor Tools

These scripts build the Tauri desktop app and immediately launch the result for
local testing.

## macOS

Run from Finder or Terminal:

```bash
tools/osx/build-install-open.command
```

The script builds the app, copies the generated `.app` into `/Applications`,
removes the quarantine attribute, and opens it.

## Windows

Run:

```bat
tools\windows\build-portable-run.bat
```

or:

```powershell
.\tools\windows\build-portable-run.ps1
```

The script builds the app and starts the release `.exe` from Tauri's target
directory. It does not install the app system-wide.
