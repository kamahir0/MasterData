# MasterData Editor

Tauri-based editor for MasterData projects.

## Editing

Table columns can be reordered by dragging the column header or schema row. The
visual/schema order changes, while the `Key N` badge keeps the generated
MessagePack `[Key(n)]` stable through each field's `fixedIndex`. Right-click a
column header for move/insert/duplicate/delete actions and advanced MessagePack
Key editing.

## Development

```bash
npm install
npm run tauri:dev
```

Development builds use a separate app identity:

```text
MasterData Editor Dev
com.kamahir0.masterdata.editor.dev
```

This keeps the development app, WebView data, and editor preferences separate
from an installed production `MasterData Editor`.

To build the production desktop app explicitly:

```bash
npm run tauri:build
```

To build the development desktop app explicitly:

```bash
npm run tauri:build:dev
```

## Unsigned macOS Build

Release builds are distributed as unsigned `.dmg` files. Open the `.dmg`, drag
`MasterData Editor.app` into `Applications`, then run once if Gatekeeper blocks
the first launch:

```bash
xattr -dr com.apple.quarantine "/Applications/MasterData Editor.app"
open "/Applications/MasterData Editor.app"
```

## Unsigned Windows Build

Release builds are distributed as an unsigned NSIS setup executable and an
optional portable zip. If using the portable zip, unblock the downloaded archive
before extracting:

```powershell
Unblock-File .\MasterDataEditor-windows-x64-portable.zip
```
