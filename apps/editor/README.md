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

This app is intended for developer use and is not notarized. After copying the
app to `/Applications`, run once:

```bash
xattr -dr com.apple.quarantine /Applications/MasterData Editor.app
```

## Unsigned Windows Build

The Windows build is unsigned. If distributed as a zip, unblock the downloaded
archive before extracting:

```powershell
Unblock-File .\MasterDataEditor-windows-x64.zip
```
