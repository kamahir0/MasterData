# Lilja.MasterData Editor

Tauri-based editor for Lilja.MasterData projects.

## Editing

Table columns can be reordered by dragging the column header or schema row. The
visual/schema order changes, while the `Key N` badge keeps the generated
MessagePack `[Key(n)]` stable through each field's `fixedIndex`. Right-click a
column header for move/insert/duplicate/delete actions and advanced MessagePack
Key editing.

## Development

```bash
npm install
npm run tauri dev
```

## Unsigned macOS Build

This app is intended for developer use and is not notarized. After copying the
app to `/Applications`, run once:

```bash
xattr -dr com.apple.quarantine /Applications/LiljaMasterDataEditor.app
```

## Unsigned Windows Build

The Windows build is unsigned. If distributed as a zip, unblock the downloaded
archive before extracting:

```powershell
Unblock-File .\LiljaMasterDataEditor-windows-x64.zip
```
