# MasterData

MasterData は Unity ゲーム向けのマスターデータ変換ツールチェーンです。

テキストベースの YAML としてマスターデータを管理し、MasterMemory 向けの
C# ソースコードを生成し、MasterMemory バイナリをビルドします。必要に応じて
生成物を Unity クライアントプロジェクトへ同期できます。

このパッケージは Unity ランタイムフレームワークを提供しません。生成された
`MemoryDatabase` のロード方法やライフタイム管理は、各プロジェクト側で決める
前提です。

## パッケージの役割

MasterData は 3 つの層に分かれています。

- `MasterDataInit-{platform}`: プロジェクトテンプレートを作成し、converter
  バイナリをプロジェクトへ導入する初期化ツール。
- `MasterDataConverter-{platform}`: `validate`、`generate`、`build`、
  `convert`、`sync`、`clean` を日常的に実行する、プロジェクトローカルの
  converter。
- `master_data_core`: CLI ツールと Tauri エディタで共有する Rust ライブラリ。

`MasterDataConverter` は `init` を提供しません。初期化を別ツールに分けることで、
プロジェクトにコミットされる converter は再現可能な変換処理だけに集中します。

## 開発リポジトリ構成

```text
crates/
  master_data_core/        共有モデル、検証、コード生成、build/sync ロジック。
    assets/                埋め込み C# builder と組み込み C# テンプレート。
  master_data_converter/   日常利用する変換 CLI。
  master_data_init/        プロジェクト初期化 CLI。

apps/
  editor/                  Tauri ベースのビジュアルエディタ。

docs/
  architecture-notes.md    設計メモと実装上の判断。
```

## 要件

- `dotnet` として利用できる .NET SDK
- 生成コードが必要とする Unity プロジェクト側のランタイム依存:
  - MasterMemory 3.0.4
  - MessagePack 3.1.6
  - System.Collections.Immutable 8.0.0

配布されるツールはネイティブバイナリです。利用者の環境に Rust は不要です。

## リリース成果物

各リリースでは、利用者が直接使う init バイナリと converter バイナリだけを公開します。

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

`MasterDataInit` は GitHub API 経由で GitHub Release の asset 一覧を読み、
同じリリースバージョンから converter asset をダウンロードします。GitHub が返す
SHA-256 asset digest を検証したうえで、`Converter/` に書き込みます。

リリースは GitHub Actions で自動化されています。手動で tag を push する場合は、
workspace package version と完全に一致する tag を使います。

```bash
git tag v0.1.1
git push origin v0.1.1
```

release workflow は GitHub-hosted Linux、Windows、macOS runner 上で CLI 成果物を
ビルドし、GitHub Release を作成または更新します。既存 tag を指定して手動再実行も
できます。

通常のリリースでは、GitHub Actions の `Bump Release` workflow を実行し、
`patch`、`minor`、`major` のいずれかを選びます。この workflow はリポジトリ内の
version file を更新し、version bump commit を作成し、対応する `vX.Y.Z` tag を
作成して、release workflow を自動で dispatch します。

## 想定プロジェクト構成

推奨する monorepo 構成です。

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

プロジェクトルートは `project-settings.yaml` が置かれているディレクトリです。
設定ファイル内の相対パスは、すべてプロジェクトルートから解決されます。

## 初期化

対象 platform の init バイナリを実行します。

```bash
MasterDataInit-osx-arm64 ./masterdata
MasterDataInit-osx-arm64 ./masterdata --force
MasterDataInit-osx-arm64 ./masterdata --no-download
```

`MasterDataInit` はターミナルから実行された場合、対話形式で C# namespace、
YAML 入力ディレクトリ、ローカル出力先、Unity 同期先を質問します。非対話環境では
デフォルト値を使います。

`--no-download` を指定すると、converter バイナリをダウンロードせずに
`project-settings.yaml`、`master/`、`Converter/` だけを作成します。

## 変換コマンド

日常的な変換では、プロジェクトローカルの converter を使います。

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

サブコマンドを省略した場合は `convert` が実行されます。`convert` は `build` を実行し、
設定に `sync` セクションがある場合は続けて `sync` を実行します。

`validate`、`build`、`convert` では `--profile <name>` を指定できます。これにより、
設定済みの build profile tag に基づいて row を絞り込みます。

converter は現在のディレクトリから上方向に `project-settings.yaml` を探します。
実行時には `tool.version` を確認し、プロジェクトが要求する MasterData version と
一致しない場合は失敗します。

## 設定ファイル

`project-settings.yaml` の例です。

```yaml
tool:
  version: 0.1.1

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

設定項目:

| 項目 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `tool.version` | はい | | 必須 converter/core version。 |
| `csharp.namespace` | はい | | 生成される master 型と MasterMemory 生成 API の namespace。 |
| `csharp.output` | いいえ | `dist/cs` | ローカルの生成 C# 出力ディレクトリ。 |
| `csharp.templates.table` | いいえ | 組み込み | カスタム table template path。 |
| `csharp.templates.struct` | いいえ | 組み込み | カスタム struct template path。 |
| `csharp.templates.enum` | いいえ | 組み込み | カスタム enum template path。 |
| `master.input` | いいえ | `master` | YAML 定義の入力ディレクトリ。 |
| `memory.output` | いいえ | `dist/master-memory` | ローカルの MasterMemory バイナリ出力ディレクトリ。 |
| `memory.fileName` | いいえ | `master-data.bytes` | MasterMemory バイナリファイル名。 |
| `tags.allowed` | いいえ | なし | row build tag の許可リスト。省略時は任意の tag を許可します。 |
| `buildProfiles` | いいえ | なし | `--profile` で使う名前付き row filter。 |
| `sync.cs` | いいえ | | 生成 C# のコピー先。 |
| `sync.memory` | いいえ | | MasterMemory バイナリのコピー先。 |

## master ディレクトリ

`master.input` 配下の `.yaml` と `.yml` ファイルを再帰的に読み込みます。
`master/` 配下のディレクトリ構成は利用者が自由に決められます。生成される型名や
table 名には影響しません。

各 YAML ファイルは、必ず 1 つの item を定義します。

- `kind: enum`
- `kind: struct`
- `kind: table`

対応している scalar type は `bool`、`int`、`long`、`float`、`double`、`string` です。
`T[]` は `System.Collections.Immutable.ImmutableArray<T>` として生成されます。

## Table 定義

table は単一 primary key、複合 primary key、unique secondary key、non-unique
secondary key、複合 secondary key、rows、`refs` をサポートします。

例:

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

生成 C# は `MemoryTable`、`MessagePackObject`、MasterMemory の key attribute を使います。
MasterMemory source generation により、table API は次の namespace 配下に作られます。

```text
{csharp.namespace}.Tables
```

`fixedIndex` は生成される MessagePack `[Key(n)]` の値を制御します。`fields` の並び順を
変更すると YAML、editor、C# property の表示順は変わりますが、`fixedIndex` が変わらない
限り binary compatibility は維持されます。既存ファイルでは `fixedIndex` を省略できます。
その場合は現在の field order が fallback key order として使われます。

row は必ず `data` / `meta` 形式で記述します。`data` には master-data field value を
入れます。`meta` は任意で、現在は `tags` をサポートしています。

```yaml
rows:
  - data:
      Id: 1
      tags: [item-tag]
    meta:
      tags: [dev]
```

`data.tags` は通常の field value です。`meta.tags` は MasterData が build filter にだけ
使う build tag であり、生成 C# や MasterMemory バイナリには出力されません。

build profile の filter ルール:

- `--profile` がない場合、すべての row を含めます。
- `excludeTags` は `includeTags` より優先されます。
- 空の `includeTags` は、除外されていないすべての row を含めます。
- 空でない `includeTags` は、指定 tag のいずれかを持つ row を含めます。
- `includeUntagged: true` の場合、`meta.tags` を持たない row も含めます。
- key uniqueness と MasterRef 解決は profile filtering 後に検証されます。

## MasterRef

`refs` は table record 間の関係を解決する helper method を生成します。ref helper は
一時的な binary builder compile から除外するため、`#if !MASTER_DATA_BUILD` で囲まれます。

ルール:

- `target` は table の `typeName` でなければなりません。
- `targetKey.primary: true` は primary key を対象にします。
- `targetKey.fields` は secondary key、または明示的な primary key field list を対象にします。
- mapping の数と順序は、target key field order と一致する必要があります。
- local field と target field の型は一致する必要があります。
- list-valued local field が対象にできるのは unique key だけです。
- 1 つの MasterRef 内で list-valued にできる local field は最大 1 つです。

## sync の安全性

`sync` の出力先は管理対象ディレクトリとして扱われます。converter は marker file を
書き込みます。

```text
.master-data-generated
```

ディレクトリが marker 付きになった後、sync は出力先の既存 non-`.meta` file を削除し、
ローカルの `dist` ディレクトリから生成物をコピーします。Unity の `.meta` file は保持されるため、
生成 asset の GUID は安定します。

出力先が存在していて marker がない場合、`--init` を指定しない限り `sync` は失敗します。
`--init` は MasterData が完全に管理してよいディレクトリに対してだけ使ってください。

## 生成されるローカルファイル

converter は master-data project 内に次のローカルディレクトリを作成する場合があります。

```text
dist/
.master-data/
```

これらは生成物であり、commit しない想定です。

利用者のリポジトリでは次を commit します。

- `master/` 配下の YAML source
- `project-settings.yaml`
- `Converter/MasterDataConverter-{platform}`

同期済みの生成 C# と `.bytes` を commit するかどうかは、各プロジェクトの運用方針です。
Unity プロジェクトでは、生成 C# と binary asset を commit する運用が実用的なことも多いです。

## Taskfile

`Taskfile.yml` は任意です。薄いローカル wrapper として使えます。

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

converter は直接実行できるため、`task` は必須ではありません。

## Tauri エディタ

Tauri エディタは `MasterDataConverter` をシェル経由で呼び出すのではなく、
`master_data_core` を直接呼び出す方針です。想定フローは次のとおりです。

```text
Tauri UI
  -> core::load_project
  -> core::validate_project
  -> core::generate_project
  -> core::build_project
  -> core::sync_project
```

diagnostics は code、severity、path、message を持つ構造化データです。GUI は stdout や
stderr を解析せずに validation feedback を表示できます。

## 開発

ローカルバイナリをビルドします。

```bash
cargo build --bin MasterDataInit
cargo build --bin MasterDataConverter
```

リリースダウンロードなしで fixture を初期化します。

```bash
cargo run --bin MasterDataInit -- /tmp/masterdata --no-download --yes
```

master-data project に対して validation を実行します。

```bash
cargo run --bin MasterDataConverter -- validate path/to/masterdata
```

check を実行します。

```bash
cargo check
cargo test
```
