# Changelog

## 0.1.0

### Breaking Changes

- The project is now distributed as the standalone `MasterData` repository.
- Generated C# comments, editor display names, builder namespaces, and release URLs use `MasterData`.
- The managed sync marker changed from `.lilja-master-data-generated` to `.master-data-generated`.
- The temporary work directory changed from `.lilja/temp` to `.master-data/temp`.
- Existing projects using pre-split generated directories must run `sync --init` or `convert --init` once with the new converter.
