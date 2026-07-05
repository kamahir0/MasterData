# MasterData Editor Tools

These scripts build the Tauri desktop app and immediately launch the result for
local testing. They use the development app identity, so they do not overwrite
or share preferences with an installed production `MasterData Editor`.

```text
MasterData Editor Dev
com.kamahir0.masterdata.editor.dev
```

## macOS

Run from Finder or Terminal:

```bash
tools/osx/build-install-open.command
```

The script builds the app, copies the generated `.app` into `/Applications`,
removes the quarantine attribute, and opens `/Applications/MasterData Editor Dev.app`.

To remove only the development app and its local state:

```bash
tools/osx/clean-dev-state.command
```

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

To remove only the development app state:

```powershell
.\tools\windows\clean-dev-state.ps1
```
