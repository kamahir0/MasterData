# Lilja.MasterData 詰まりポイントメモ

このメモは、Lilja.MasterData と Tauri エディタの設計・実装について、これまでの議論で特に詰まった点、判断に時間がかかった点、後から読み返すべき注意点をまとめたもの。

仕様書や README は「使い方」「完成形」を説明する文書で、このメモは「なぜそうなったか」「同じところで再び迷わないための記録」を目的にする。

## 全体像

Lilja.MasterData は、Unity ゲーム向けのマスターデータを YAML で管理し、C# 型定義と MasterMemory バイナリを生成するためのツール群。

大きく分けると、以下の2つに分かれる。

- 事前コンパイル済みのコンバータ
- 毎回生成型を含めてコンパイルされる MasterMemory ビルダー

この分離がかなり重要だった。

事前コンパイル済みコンバータは、ユーザーが直接叩く入口。Rust 製の単体バイナリとして配布し、`dotnet` コマンドを内部で呼び出して、生成 C# 型とビルダー C# コードを一時的にコンパイル・実行する。

毎回コンパイルされるビルダーは、生成されたマスター型を実際に含める必要がある。これは、MasterMemory に渡すデータが実型の配列・リストである必要があり、完全に事前コンパイルされた汎用バイナリだけでは解決できないため。

## UPM パッケージではない問題

最初は従来の Lilja パッケージと同じく UPM パッケージ的な見方をしていたが、Lilja.MasterData は Unity 側に置くランタイムコードが極端に薄い、またはゼロになりうる。

理由:

- YAML から C# を生成するのは Unity 外部でよい
- MasterMemory バイナリも Unity 外部でビルドできる
- ロード処理はプロジェクトごとに事情が違う
- Unity 側には生成済み `.cs` と `.bytes` などがコピーされればよい

そのため、本体は UPM パッケージというより、モノレポ内の `masterdata` プロジェクトに配置する外部ツールに近い。

想定配置:

```text
repo/
  client/
    Assets/
  masterdata/
    Converter/
      MasterDataConverter-osx
      MasterDataConverter-windows.exe
    project-settings.yaml
    master/
    dist/
```

ユーザーがパッケージ由来で自分のリポジトリにコミットするものは、基本的に converter バイナリのみ、という考え方が出発点になった。

## 配布方法で詰まった点

最初は NuGet、Scoop、dotnet tool なども候補に上がったが、ユーザー目線では少し重い。

結論として、Rust または Go で単体実行バイナリを配布する方針に傾いた。

ただし、MasterMemory バイナリのビルドには `dotnet` が必要なので、完全にランタイム不要になるわけではない。ここでの「依存が少ない」は、ユーザーが直接叩く入口が1バイナリで済む、という意味。

重要な整理:

- ユーザーが叩くのは converter バイナリ1つ
- converter 内部で `dotnet` を呼ぶ
- 生成型を含む C# ビルダーは一時ディレクトリに展開してコンパイルする
- 使うだけなら Rust/Go の実行環境は不要
- ただし `dotnet` コマンドは必要

Tauri エディタを将来的に作る前提では、Rust に寄せるメリットがさらに大きくなった。

理由:

- Tauri backend が Rust
- core crate を converter と editor で共有しやすい
- YAML の読み書き、検証、プロジェクト scan などを共通化できる
- 配布単位も Rust/Tauri と相性がよい

## ビルダー C# コードの扱い

「配布物を1バイナリだけにするなら、毎回コンパイルする C# ビルダーの実体ファイルはどうするのか」が詰まった。

結論:

- converter バイナリ内に C# ビルダーコードを埋め込む
- 実行時に `.lilja/temp` などへ展開する
- 生成済み C# 型と一緒に dotnet build/run する

Rust 側では `include_str!` のような形で C# コードを埋め込める。ビルド時の環境変数に C# コード全体を持つ、というより、ソースファイルとして repository に置いたものを Rust バイナリへ埋め込む方が自然。

## MasterMemory ビルドで詰まった点

大きな論点は、「型定義だけ生成すれば、事前用意の汎用コンバータで YAML を読んで append できるのか」だった。

結論:

- 生成されたマスター型コードは必ずコンパイル対象に含める必要がある
- ただし、テーブルごとの `BuildProgram.g.cs` のようなコード生成は必須ではない
- 汎用ビルダーが YAML のメタ情報から型の完全修飾名を組み立て、reflection でインスタンス生成・値設定できる

`Activator.CreateInstance(type)` の静的型は `object` になる。これ自体は問題ではない。MasterMemory 側にも、reflection で `FormatterServices.GetUninitializedObject(table.DataType)` してプロパティを設定するようなコードが存在するため、実型がコンパイル済みアセンブリ内に存在していれば、汎用処理で進められる。

ただし、完全修飾名は必要。

ここから導かれた仕様:

- C# namespace は明示的に project settings で指定させる
- YAML の `typeName` と namespace から完全修飾名を作る
- 生成 C# 型は builder と一緒に毎回コンパイルする

## namespace とテンプレート

「namespace を設定項目にするのか、テンプレートで自由に書けるようにするのか」で迷った。

結論:

- 完全修飾名を作るため、namespace 設定自体は必要
- ただし C# 出力の見た目や周辺コードはテンプレートでカスタムできるとよい

テンプレートファイル内に namespace を直接書ければ、見た目上は namespace 指定機能にも見える。しかし builder 側で型解決するには、ツールが機械的に namespace を知っている必要がある。

そのため、以下の切り分けが必要。

- 型解決用 namespace: project settings に明示
- 出力コードの形: テンプレートでカスタム可能

プロパティ本体や key 属性など、ツールが整合性を保証すべき部分は `{body}` のような差し込みにして、ユーザーが直接壊しにくくする方針になった。

## YAML schema で詰まった点

当初は row のメタデータを `_tags` のようなキーにする案があった。

しかしマスターデータのカラムには `name` や `tags` のような普通の名前がありえる。ツール用メタキーとデータ本体のキーが同じ階層に存在すると、予約語や prefix ルールの説明が増える。

結論:

```yaml
rows:
  - data:
      Id: 1
      Name: Sword
      tags: [weapon]
    meta:
      tags: [prod]
```

`data` と `meta` を分離する。

これにより、以下が成立する。

- `data.tags` と `meta.tags` は100%競合しない
- ユーザーのカラム名に制約をほぼ増やさなくてよい
- ツール用メタデータの拡張先が明確になる

v1 からフラット row 互換は切る方針になった。早い段階で schema を厳しくした方が、後の互換性負債が少ない。

## タグビルドで詰まった点

タグは `row.meta.tags` のみを対象にする。

C# 生成は常に全定義から行い、MasterMemory バイナリに含める rows だけを profile で絞り込む。

この切り分けが重要。

理由:

- 型定義は profile によって変わるべきではない
- build profile はデータ内容の選別であり、schema の選別ではない
- Unity 側 C# が profile ごとに変わると破綻しやすい

タグ指定の入口は、CLI の `--profile` と `project-settings.yaml` の `buildProfiles` に限定した。直接 `--include-tags` のような CLI は v1 では入れない。

## includeTags と untagged の仕様

ここは何度も整理した。

最終的な意味:

- `excludeTags` は常に最優先
- `includeTags` が空なら、除外されない全 row を含める
- `includeTags` が非空なら、指定タグに一致する row のみ含める
- `includeTags` が非空のとき、未タグ row は含めない
- 未タグ row を明示的に含めたい場合だけ、疑似タグ `untagged` を使う
- `excludeTags: [untagged]` なら未タグ row を除外する
- 実タグとしての `untagged` は禁止
- `includeUntagged` は互換読み取りのみの deprecated 扱い

特に重要なのは、`untagged` は実データのタグ名ではなく、フィルタ・profile の中だけで使える疑似タグであること。

## Validation の分離

タグ profile 導入で、検証を2段階に分ける必要が出た。

構造検証:

- YAML の形
- `rows[].data` 必須
- `meta.tags` の型
- 未宣言タグ
- 型名
- フィールド定義
- 値型
- Key 定義
- MasterRef 定義

profile 適用後検証:

- primary key 重複
- unique secondary key 重複
- MasterRef 解決

profile によって参照先 row が除外されると、全 row では通っていた MasterRef が profile build では壊れる。このため `validate --profile production` は profile 適用後の整合性まで見る必要がある。

## enum / struct / 複合キー / secondary key

v1 で広げたい範囲として以下が入った。

- enum 生成
- custom struct 生成
- master data 内で enum / struct を使う
- 複合 primary key
- secondary key
- unique / non unique secondary key

enum と struct は、1ファイル1型定義が基本。

理由:

- Git diff が読みやすい
- ファイルツリーと型の対応が明確
- 将来の editor で扱いやすい
- rename / move / delete の粒度が自然

まとめ定義は便利に見えるが、エディタや差分管理の複雑さが増える。

## record / immutable / ImmutableArray

生成 C# はマスターデータ用途なので、できるだけ immutable に寄せる。

方針:

- master record 型は C# `record`
- custom struct も immutable
- list 的な値は `ImmutableArray<T>`

ただし、ビルダー側では reflection で値を詰める都合がある。コンストラクタ、init-only property、field、formatter 的生成のどれを使うかは、生成コードと builder の相性を常に見る必要がある。

## MessagePack Key と列順

エディタで列順を入れ替えたいが、MessagePack の Key 番号まで変わるとバイナリ互換性が壊れる。

結論:

- 見た目・C# プロパティ定義順は列順を反映してよい
- MessagePack Key は `fixedIndex` で固定できる
- 列入れ替えでは `fixedIndex` を変えない

これは非常に重要。列順変更は UX 上の操作であり、保存形式の互換性を壊す操作ではない。

UI 上も、列コンテキストメニューに `Advanced: Edit MessagePack Key` のような危険操作として分けた。

## MasterRef で詰まった点

MasterRef は、ある field と別テーブルの key を関連付け、生成 C# に便利メソッドを生やす機能。

例:

```csharp
GetHoge(HogeTable table) => table.FindByXX(Piyo);
```

一度、non unique secondary key と list ref の関係で混乱した。

整理:

- 単一参照は target key が unique である必要がある
- `RewardIds` のように複数 ID を持つ場合、各 ID が target の primary/unique key を指す
- この場合、non unique secondary key は関係ない
- non unique secondary key は「条件に合う複数 row を取る」用途であり、ID リストから複数参照を解決する用途とは違う

生成メソッドの引数は基本的に table のみでよい。検索に使う値は自分自身の property から取れる。

さらに、static database accessor を設定して、引数なしプロパティ `.Hoge` のような形で参照できる生成コードも案として出た。

これは便利だがプロジェクト依存が強いので、opt-in の project level 設定にするのが妥当。

## init と project root

converter バイナリは標準配置では `Converter/` 配下にあるが、`init` は普通プロジェクトルートで叩きたい。

ここが UX と配置思想のギャップになった。

整理:

- `project-settings.yaml` が置かれる場所を project root と定義する
- `master/` も project root からの相対
- `init` はプロジェクトルートで実行すると、余計な引数なしで雛形作成
- converter が `Converter/` 配下にあっても、project root を相対指定または対話指定できるようにする

ただし最終的には Tauri エディタも存在するため、CLI の init/convert と editor の project open/init は役割分担になる。

## sync と monorepo

想定ユースケースは、Unity client と masterdata が同じモノレポにある構成。

例:

```text
repo/
  client/
    Assets/
  masterdata/
    project-settings.yaml
    master/
    dist/
```

ビルド後に生成 `.cs` や MasterMemory バイナリを Unity 側へコピーする sync 機能が必要。

相対パスでのコピーが基本になる。

理由:

- CI で絶対パスに依存しない
- 開発者ごとの checkout path が違っても動く
- masterdata project 単体で完結した設定にしやすい

## `.gitignore` と生成物

Rust/Cargo や editor build により、差分ファイルが大量に出る問題があった。

Unity の `.gitignore` をそのまま持ってくるのではなく、Lilja.MasterData パッケージ専用の過不足ない `.gitignore` が必要になった。

無視すべきもの:

- `target/`
- editor frontend build 出力
- node_modules
- 一時生成 `.lilja/temp`
- OS メタファイル

ただし、テンプレートや embedded builder など、パッケージに必要なソースは無視しない。

## Tauri editor の目的

将来的に YAML を可視化・編集する editor を Tauri で作る前提になった。

Obsidian が Markdown の source of truth を保ったまま編集体験を提供するのに近い。

重要な方針:

- 永続 source of truth は YAML
- 編集中 source of truth は frontend の typed document model
- 保存時に canonical YAML として正規化保存
- YAML コメント保持は v1 では目標外

これにより undo/redo は、text diff ではなく document model の transaction として扱える。

## undo / redo

エディタで最重要機能として undo/redo が挙がった。

Excel 的入力では、1セル編集、paste、fill down、row 操作、schema 操作、file 操作などがある。

方針:

- document 編集は `immer` patches で undo/redo
- 1セル編集は1 transaction
- 複数セル paste は1 transaction
- schema 変更は関連 row data / key / ref 変更も含めて1 transaction
- file create / rename / move / delete は project-level history

保存後も undo 可能にする方針。外部変更検知時は conflict dialog を出すが、history を即破棄しない。

## グリッド UI で詰まった点

テーブル表示で、ヘッダーと record body の横幅がスクロールに応じてズレる問題が出た。

原因:

- header と body を別 DOM / 別 scroll / 別幅計算で描いていた
- sticky header と virtualized body の構造が噛み合っていなかった

結論:

- header と rows を同じ horizontal scroll container 内に置く
- 同じ `gridTemplateColumns` を使う
- 横方向は仮想化しない
- 縦方向だけ `@tanstack/react-virtual` で仮想化
- header は同じ scroll container 内で sticky

これにより、原理的に列幅ズレが起きにくくなる。

## Schema 領域の廃止

一時期、テーブル表示に Schema 領域と Records 領域を分けていた。

しかし最終的に、Schema 領域は不要になった。

理由:

- カラム設定と record 入力が分断される
- スクロールや列幅管理が複雑になる
- Excel 的に、列ヘッダー自体が field 定義を担う方が自然

現在の考え方:

- Records の sticky column header が field 定義 UI を持つ
- ヘッダー内で field name / type / PK/SK/REF badge / drag handle を扱う
- フィールド追加 `+` は列全体の右端に独立して置く

## 列入れ替え UI

ドラッグ中に cursor 位置から挿入 gap を計算し、カラム間の縦線を強調表示する方式になった。

重要:

- row 全体 draggable にするとクリック操作を阻害する
- table column reorder は dnd-kit の汎用 sortable より、専用 pointer/gap marker の方が挙動を制御しやすい
- drop 時は `moveFieldToGap(fromIndex, gapIndex)` を1 transactionで実行
- `fixedIndex` は変えない

## セル選択とセル入力状態

矢印キーでセル移動を実装した結果、入力中に左右カーソル移動できない問題が出た。

ここで、セルには2状態が必要になった。

- select mode: セル外縁が選択され、矢印キーでセル移動
- edit mode: input に focus が入り、左右キーは文字カーソル移動

クリック判定も分ける必要があった。

- セル外縁クリック: select
- セル内入力 UI クリック: edit

Tab で外縁選択だけ移動して input focus が残るなど、2状態はバグの温床になりやすい。今後もグリッド操作を触るときは、active cell と actual focus の同期に注意する。

## struct セル入力

自作 struct 型を JSON 文字列で手入力するのは厳しい。

方針:

- 自作 struct 型セルを選択したら、セル左上に吸着する floating editor を出す
- 直下 field ごとに input/select を縦に並べる
- nested struct/list は v1 では JSON textarea
- スクロール時も対象セルに追従
- 未入力状態では型ごとの default placeholder を表示

ここも position 計算で詰まりやすい。

scroll container 内の grid 座標と viewport 座標を混同しないこと。

## enum 入力と Flags

enum カラム入力では、文字列手入力だけではなく候補リストが必要。

方針:

- 入力中に候補リストを出す
- 候補を選択すると値を入力
- Flags enum は comma 区切り入力をサポート

enum 定義自体にも Flags 機能を追加した。

## tag token input

タグ入力 UI は複数箇所に出る。

- EditorHeader の tag filter
- row の `meta.tags`
- ProjectSettings の `tags.allowed`
- build profile の include/exclude tags

これらが別 UI だと操作性が破綻するので、共通 `TagTokenInput` に統一した。

操作仕様:

- 入力中に候補リストを表示
- 候補選択で token/block 表示に変化
- `Space` / `,` で完全一致 token 化
- token の右隣で Backspace すると token 削除
- 矢印左右では token を1文字相当として扱う
- dropdown button から候補選択可能

タグ名ルール:

```text
^[A-Za-z0-9][A-Za-z0-9_.:-]*$
```

`untagged` は allowedTags / row tags では禁止。filter/profile の疑似タグとしてのみ許可。

## Table Settings

Schema 領域は廃止したが、PK/SK/MasterRef のような table 全体設定は必要。

方針:

- Records header と record body の間に foldout の `Table Settings`
- 初期 collapsed
- Primary Key: ordered field select
- Secondary Keys: add/delete、ordered fields、unique checkbox
- MasterRef: guided form

横幅が狭い時に Secondary Key の RemoveField と DeleteSecondaryKey が重なる問題が出た。Table Settings は横に詰め込まず、必要なら2段 layout に逃がす方が安定する。

## 左ペイン FileExplorer で詰まった点

FileExplorer は何度も詰まった。

問題:

- ファイルクリックが反応しない
- D&D の drag listener がクリックを奪う
- フォルダ階層が平坦に見える
- 作成ボタンが反応しない
- OS 標準コンテキストメニュー化と React state 更新の接続が難しい
- フォルダ全体クリックで開閉したい
- ファイル/フォルダ全体を掴んでドラッグしたい

現在の方針:

- tree は階層構造として描画し、indent で表現
- sort は name / modified、asc / desc
- D&D はファイル順入れ替えではなく、所属フォルダ移動のみ
- ファイル/フォルダ row 全体を drag activator にする
- PointerSensor に distance threshold を設け、単クリックと drag を分ける
- フォルダ row 全体クリックで開閉
- ファイル row 単クリックで開く
- `.yaml` 拡張子は表示しない

Create/Rename/Delete:

- Create は OS ネイティブメニュー
- メニュー選択後、即ファイルを作らず inline name input を出す
- Enter/blur で create
- Rename も inline input
- Delete は confirm 後に削除

重要な反省:

`window.prompt` は一時的には原因切り分けに役立ったが、最終 UI としては使わない。Tauri では OS ネイティブ menu を Rust 側で出し、menu event を frontend に emit して state 更新する形が安定する。

## OS ネイティブメニュー

右クリックメニューはアプリ全体で OS 標準に統一する方針になった。

対象:

- 左ペイン root create
- 左ペイン folder/file context menu
- table records create
- table column context menu
- record row context menu

Tauri 実行時は Rust 側で menu を作る。frontend の HTML context menu は dev server/browser 実行時の fallback として残す程度。

注意:

- Rust menu item id に action と index/path を埋め込む
- `on_menu_event` で parse して frontend へ emit
- path に `:` が混ざる可能性があるなら split 数に注意
- frontend はイベントを listen して既存 store 操作を呼ぶ

## macOS / Windows 配布

Apple Developer には加入せず、完全無料で開発・使用する前提。

macOS:

- unsigned / unnotarized app になる
- 初回だけ quarantine 解除が必要

```bash
xattr -dr com.apple.quarantine /Applications/LiljaMasterDataEditor.app
```

Windows:

- unsigned portable zip
- SmartScreen やブロック解除が必要な場合がある

```powershell
Unblock-File .\LiljaMasterDataEditor-windows-x64.zip
```

使うだけの人に npm 依存はない。配布済みアプリを使うだけなら frontend build は同梱される。ただし MasterMemory build を実行するなら `dotnet` は必要。

## ウィンドウ close guard

未保存作業がある状態で OS のウィンドウ閉じるボタンを押したとき、確認 dialog を出す機能で詰まった。

問題:

- Discard を押しても閉じない
- そもそも閉じるボタン自体が反応しない状態になった

注意点:

- Tauri の `onCloseRequested` で prevent した後、本当に閉じる経路を別に用意する必要がある
- 再入防止 flag が必要
- `request_app_exit` のような Rust command で app exit する方が明示的
- 保存は自動実行しない。選択肢は Discard / Cancel

close guard は UX 上重要だが、OS ボタンを殺すバグになりやすい。

## OS メニューバー

macOS では File / Edit / View / Window / Help の OS 標準メニューバーが欲しい。

一時期、ウィンドウ内に `File / Open Project` があったが、これは不要になった。

方針:

- ウェルカムページから project open
- OS メニューバーの File に Open Project
- project-settings.yaml を選択して開く

Tauri の default menu を使い、File に Open Project を prepend する形が自然。

## ProjectSettings / EditorSettings

画面として分ける価値がある。

ProjectSettings:

- namespace
- master input dir
- dist output
- sync target
- tags.allowed
- buildProfiles
- templates
- static database accessor

EditorSettings:

- recentProjects
- theme
- zoom
- grid font size
- sidebar visible
- bottom panel visible
- bottom panel height
- active bottom tab

ProjectSettings は project の source of truth として YAML 保存。EditorSettings はグローバル preference として OS の設定ディレクトリに JSON 保存。

## Bottom panel

Problems / Build Log の下部 pane は、固定高さだとかなり邪魔になった。

方針:

- VSCode 風に表示/非表示 toggle
- 高さ drag resize
- min height / max height を設定
- validate/build 後は自動表示
- diagnostics があれば Problems、なければ Build Log

テーブルの record 数が少ない時に bottom panel と grid layout が崩れたため、全体 layout は CSS grid/flex の min-height/minmax をかなり慎重に扱う必要がある。

## zoom

最初の zoom は main area の font size が変わるだけだった。

期待される zoom:

- font size だけでなく、列幅・行高・input 高も変える
- 画面に収まる情報量が増減する
- grid の各寸法は zoom factor から計算

固定 pixel と zoom pixel が混ざるとレイアウトが破綻しやすい。

## record という用語

今後は `Row` より `Record` に寄せる方針。

理由:

- ユーザー視点では master table の1件は record
- UI ラベルとして Row より意味が明確

内部コードには `rows` が残っていてもよいが、UI 表示や操作名は Record に寄せる。

## サンドボックス検証

Unity6.4Sandbox 側に `Assets/MasterDataTest/masterdata~` を作り、実ユースケースに沿って動作確認した。

意図:

- converter バイナリ配置
- project-settings.yaml
- master YAML
- generate/build/sync
- Unity scene playback

これはパッケージ単体テストだけでは見えない integration issue を拾うために重要。

ただし、testdata は削除してよい。サンドボックスプロジェクトは残す。

## Git submodule push 問題

`unity-sandbox.git` へ push しようとした時に、submodule `lilja` の変更が remote に存在しないため push が abort した。

エラー:

```text
The following submodule paths contain changes that can not be found on any remote:
  lilja
```

対処:

- 先に submodule 側 `lilja` を push する
- または `git push --recurse-submodules=on-demand`

親 repo だけ push しても、submodule commit が remote にないと壊れる。

## エディタ削除と復元

一度「tauri エディタの実装のみ全削除」となったが、その後、同日の「完全に元通りに復元して」で復元した。

今後履歴を見るときに混乱しやすい。

注意:

- 現在の方針は Tauri editor を残す
- 削除状態を正としない
- 復元後にさらに UI 修正が積まれている

## 現時点で特に壊しやすい箇所

1. FileExplorer の click / drag / context menu

   D&D と単クリックが干渉しやすい。PointerSensor の activation distance、row 全体 draggable、folder toggle、file select、context menu の stopPropagation を同時に見る必要がある。

2. Table grid の active cell / focus

   select mode と edit mode がずれると、キーボード操作がすぐ壊れる。input focus と activeCell state の同期を必ず確認する。

3. Header / body の column width

   列を追加するときは `gridTemplateColumns`、header cell、row cell、footer、total width を同時に更新する。どれか1つ漏れるとズレる。

4. MessagePack fixedIndex

   列順変更で fixedIndex を変更してはいけない。データ互換性を壊す。

5. Tag `untagged`

   実タグとしては使用禁止。filter/profile の疑似タグとしてだけ許可。UI と core validation の両方で同じルールにする。

6. MasterRef profile validation

   全 row では通るが profile 後に参照先が消えて壊れるケースがある。validate/build profile は必ず profile 適用後整合性を見る。

7. OS native menu events

   Rust menu id と frontend listener の action 名がずれると無反応になる。UI 側だけ見ても原因が分からないので、Rust `on_menu_event` も必ず見る。

8. Close guard

   prevent close した後に本当に close する経路を忘れると、OS close button が死ぬ。

## 今後の実装時チェックリスト

- YAML schema を変える場合、core model / validation / build input / editor save / README を同時に見る
- table field を変える場合、keys / secondary keys / refs / row data の追従を確認する
- grid column を増減する場合、header / row / footer / width 計算を同時に確認する
- tag rule を変える場合、core と frontend の両方を更新する
- OS menu を増やす場合、Rust command / menu id / on_menu_event / frontend listener をセットで実装する
- Unity sync を変える場合、サンドボックスで scene playback まで見る
- converter 配布物を変える場合、macOS / Windows の「使うだけの人」の依存を再確認する

## 最終的な設計判断の要約

- Lilja.MasterData は Unity runtime package というより外部 masterdata tool
- ユーザーが叩く入口は Rust 製 converter バイナリ
- MasterMemory build では生成 C# 型を含めた一時 C# project を毎回 dotnet でコンパイル
- YAML rows は `data/meta` 分離必須
- C# 型生成は常に全定義、build profile は rows のみフィルタ
- `untagged` は疑似タグ
- enum/struct/table は基本 1ファイル1型
- generated C# は immutable 寄り
- list は `ImmutableArray<T>`
- column reorder と MessagePack Key は別物
- Tauri editor は YAML source of truth の declarative editor
- UI は VSCode file explorer + Excel grid だが、マスターデータ専用に field definition と record editing を融合する
- 右クリックメニューは Tauri 実行時 OS ネイティブに統一
- FileExplorer と Table grid は今後も一番バグりやすい領域
