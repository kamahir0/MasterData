# MasterData

MasterData is a master-data conversion toolchain for Unity games.

It stores master data as text-based YAML, generates C# source files for
MasterMemory, builds a MasterMemory binary, and optionally synchronizes the
generated files into a Unity client project.

This package does not provide a Unity runtime framework. Loading and lifetime
management of the generated `MemoryDatabase` remain project-specific.

## Package Role

MasterData is split into three layers:

- `MasterDataInit-{platform}`: an initializer that creates the project template
  and installs converter binaries into the project.
- `MasterDataConverter-{platform}`: a project-local converter used for daily
  `validate`, `generate`, `build`, `convert`, `sync`, and `clean` operations.
- `master_data_core`: the Rust library shared by CLI tools and a future
  Tauri editor.

`MasterDataConverter` no longer provides `init`. Initialization is a separate
tool so the committed converter can stay focused on reproducible conversion.

## Development Repository Layout

```text
crates/
  master_data_core/        Shared model, validation, code generation, and build/sync logic.
    assets/                Embedded C# builder and built-in C# templates.
  master_data_converter/   Daily conversion CLI.
  master_data_init/        Project initializer CLI.

apps/
  editor/                  Tauri-based visual editor.

docs/
  architecture-notes.md    Design notes and implementation tradeoffs.
```

## Requirements

- .NET SDK available as `dotnet`
- Unity project with runtime dependencies required by generated code:
  - MasterMemory 3.0.4
  - MessagePack 3.1.6
  - System.Collections.Immutable 8.0.0

The distributed tools are native binaries and do not require Rust on a user's
machine.

## Release Artifacts

Each release should publish only the user-facing init and converter binaries:

```text
MasterDataInit-windows-x64.exe
MasterDataInit-osx-arm64
MasterDataInit-osx-x64
MasterDataInit-linux-x64

MasterDataConverter-windows-x64.exe
MasterDataConverter-osx-arm64
MasterDataConverter-osx-x64
MasterDataConverter-linux-x64
```

`MasterDataInit` reads the GitHub Release asset list through the GitHub API,
downloads converter assets from the same release version, verifies GitHub's
SHA-256 asset digests, and writes them into `Converter/`.

Releases are automated by GitHub Actions. Push a tag that exactly matches the
workspace package version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds the CLI artifacts on GitHub-hosted Linux, Windows,
and macOS runners, then creates or updates the GitHub Release with the binaries.
The workflow can also be rerun manually from an existing tag.

## Intended Repository Layout

Recommended monorepo layout:

```text
repo/
  client/
    Assets/
      MasterData/
        Generated/
        Resources/

  masterdata/
    project-settings.yaml
    master/
      item/
        item_master.yaml
    Converter/
      MasterDataConverter-windows-x64.exe
      MasterDataConverter-osx-arm64
      MasterDataConverter-osx-x64
      MasterDataConverter-linux-x64
```

The project root is the directory containing `project-settings.yaml`. All
relative paths in that file are resolved from the project root.

## Initialization

Run the platform-specific init binary:

```bash
MasterDataInit-osx-arm64 ./masterdata
MasterDataInit-osx-arm64 ./masterdata --force
MasterDataInit-osx-arm64 ./masterdata --no-download
```

`MasterDataInit` is interactive when run from a terminal. It asks for the C#
namespace, YAML input directory, local output paths, and Unity sync
destinations. In non-interactive environments it uses defaults.

Use `--no-download` to create `project-settings.yaml`, `master/`, and
`Converter/` without downloading converter binaries.

## Conversion Commands

Daily conversion uses the project-local converter:

```bash
cd masterdata
./Converter/MasterDataConverter-osx-arm64
./Converter/MasterDataConverter-osx-arm64 convert
./Converter/MasterDataConverter-osx-arm64 convert --init
./Converter/MasterDataConverter-osx-arm64 validate
./Converter/MasterDataConverter-osx-arm64 validate --profile production
./Converter/MasterDataConverter-osx-arm64 generate
./Converter/MasterDataConverter-osx-arm64 build
./Converter/MasterDataConverter-osx-arm64 build --profile production
./Converter/MasterDataConverter-osx-arm64 sync
./Converter/MasterDataConverter-osx-arm64 sync --init
./Converter/MasterDataConverter-osx-arm64 clean
```

When no subcommand is specified, `convert` is used. `convert` runs `build`, then
`sync` when the config has a `sync` section.
`validate`, `build`, and `convert` can use `--profile <name>` to filter rows by
configured build profile tags.

The converter searches upward from the current directory for
`project-settings.yaml`. It checks `tool.version` before running and fails if
the project requires a different MasterData version.

## Config File

Example `project-settings.yaml`:

```yaml
tool:
  version: 0.1.0

csharp:
  namespace: Game.MasterData
  output: dist/cs

master:
  input: master

memory:
  output: dist/master-memory
  fileName: master-data.bytes

tags:
  allowed: [dev, test, prod]

buildProfiles:
  dev:
    includeTags: [dev]
    excludeTags: []
    includeUntagged: true
  production:
    includeTags: []
    excludeTags: [dev, test]
    includeUntagged: true

sync:
  cs: ../client/Assets/MasterData/Generated
  memory: ../client/Assets/MasterData/Resources
```

Config fields:

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `tool.version` | Yes | | Required converter/core version. |
| `csharp.namespace` | Yes | | Namespace for generated master types and MasterMemory generated API. |
| `csharp.output` | No | `dist/cs` | Local generated C# output directory. |
| `csharp.templates.table` | No | built-in | Custom table template path. |
| `csharp.templates.struct` | No | built-in | Custom struct template path. |
| `csharp.templates.enum` | No | built-in | Custom enum template path. |
| `master.input` | No | `master` | YAML definition input directory. |
| `memory.output` | No | `dist/master-memory` | Local MasterMemory binary output directory. |
| `memory.fileName` | No | `master-data.bytes` | MasterMemory binary file name. |
| `tags.allowed` | No | none | Allowed row build tags. When omitted, any tag is accepted. |
| `buildProfiles` | No | none | Named row filters used by `--profile`. |
| `sync.cs` | No | | Destination for generated C# copy. |
| `sync.memory` | No | | Destination for MasterMemory binary copy. |

## Master Directory

`master.input` is scanned recursively for `.yaml` and `.yml` files. Directory
layout under `master/` is user-defined and does not affect generated type names
or table names.

Each YAML file defines exactly one item:

- `kind: enum`
- `kind: struct`
- `kind: table`

Supported scalar types are `bool`, `int`, `long`, `float`, `double`, and
`string`. `T[]` is generated as
`System.Collections.Immutable.ImmutableArray<T>`.

## Table Definitions

Tables support single and composite primary keys, unique secondary keys,
non-unique secondary keys, composite secondary keys, rows, and `refs`.

Example:

```yaml
kind: table
table: items
typeName: ItemMaster

keys:
  primary:
    fields: [Id]
  secondary:
    - fields: [Code]
      unique: true

fields:
  - name: Id
    type: int
    fixedIndex: 0
  - name: Code
    type: string
    fixedIndex: 1

rows:
  - data:
      Id: 1
      Code: potion
  - data:
      Id: 999
      Code: debug_potion
    meta:
      tags: [dev]
```

Generated C# uses `MemoryTable`, `MessagePackObject`, and MasterMemory key
attributes. MasterMemory source generation creates table APIs under:

```text
{csharp.namespace}.Tables
```

`fixedIndex` controls the generated MessagePack `[Key(n)]` value. Reordering
`fields` changes YAML/editor/C# property order, but does not change binary
compatibility as long as `fixedIndex` values stay unchanged. Existing files may
omit `fixedIndex`; the current field order is then used as the fallback key
order.

Rows must use the `data`/`meta` form. `data` contains master-data field values.
`meta` is optional and currently supports `tags`:

```yaml
rows:
  - data:
      Id: 1
      tags: [item-tag]
    meta:
      tags: [dev]
```

`data.tags` is a normal field value. `meta.tags` is a build tag used only by
MasterData and is not emitted to generated C# or MasterMemory binaries.

Build profile filtering rules:

- Without `--profile`, all rows are included.
- `excludeTags` wins over `includeTags`.
- Empty `includeTags` includes every row not excluded.
- Non-empty `includeTags` includes rows with at least one included tag.
- `includeUntagged: true` also includes rows with no `meta.tags`.
- Key uniqueness and MasterRef resolution are validated after profile filtering.

## MasterRef

`refs` generate helper methods for resolving relationships between table
records. Ref helpers are excluded from temporary binary builder compilation
with `#if !MASTER_DATA_BUILD`.

Rules:

- `target` must be a table `typeName`.
- `targetKey.primary: true` targets the primary key.
- `targetKey.fields` targets a secondary key or an explicit primary key field
  list.
- Mapping count and order must match the target key field order.
- Local and target field types must match.
- A list-valued local field may target only a unique key.
- At most one local field in a MasterRef may be list-valued.

## Sync Safety

`sync` destinations are managed directories. The converter writes a marker file:

```text
.master-data-generated
```

After a directory is marked, sync deletes existing non-`.meta` files in the
destination and copies generated output from local `dist` directories. Unity
`.meta` files are preserved so generated assets keep stable GUIDs.

If a destination exists and is not marked, `sync` fails unless `--init` is used.
Use `--init` only for directories that should be fully managed by
MasterData.

## Generated Local Files

The converter may create these local directories inside the master-data project:

```text
dist/
.master-data/
```

They are generated artifacts and should not be committed.

The user's repository should commit:

- YAML sources under `master/`
- `project-settings.yaml`
- `Converter/MasterDataConverter-{platform}`

Whether synced generated C# and `.bytes` are committed is a project policy
decision. In Unity projects, committing generated C# and binary assets is often
practical because Unity imports them as normal assets.

## Taskfile

`Taskfile.yml` is optional. It can be used as a thin local wrapper:

```yaml
version: '3'

vars:
  CONVERTER: ./Converter/MasterDataConverter-osx-arm64

tasks:
  convert:
    cmds:
      - '{{.CONVERTER}} convert .'
  validate:
    cmds:
      - '{{.CONVERTER}} validate .'
```

`task` is not required because the converter remains directly executable.

## Future Tauri Editor

A future Tauri editor should call `master_data_core` directly instead of
shelling out to `MasterDataConverter`. The intended flow is:

```text
Tauri UI
  -> core::load_project
  -> core::validate_project
  -> core::generate_project
  -> core::build_project
  -> core::sync_project
```

Diagnostics are structured as code, severity, path, and message so a GUI can
render validation feedback without parsing stdout or stderr.

## Development

Build local binaries:

```bash
cargo build --bin MasterDataInit
cargo build --bin MasterDataConverter
```

Initialize a fixture without release downloads:

```bash
cargo run --bin MasterDataInit -- /tmp/masterdata --no-download --yes
```

Run validation against a master-data project:

```bash
cargo run --bin MasterDataConverter -- validate path/to/masterdata
```

Run checks:

```bash
cargo check
cargo test
```
