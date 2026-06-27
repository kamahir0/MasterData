# Lilja.MasterData Editor 仕様書

この文書は、Lilja.MasterData Editor のユーザー向け仕様を定義する。実装技術そのものには依存せず、同等のエディタを作り直すために必要な画面、操作、状態、保存、検証、ビルドの振る舞いを記述する。

## 1. 目的

Lilja.MasterData Editor は、Lilja.MasterData プロジェクト内の YAML 定義を編集するためのデスクトップエディタである。

主な目的は次の通り。

- enum、struct、table の YAML 定義を、手書き YAML より安全かつ高速に編集できるようにする。
- table は Excel に近い表形式で編集できるようにしつつ、列定義、キー、参照、タグなどのマスターデータ固有情報を明確に扱えるようにする。
- YAML を永続的な source of truth とし、保存時には canonical な YAML へ正規化する。
- validate、generate、build、sync、clean などの Lilja.MasterData CLI 相当の操作をエディタから実行できるようにする。
- 表示状態、最近開いたプロジェクト、ズーム、ペイン表示などはエディタ全体の preference として保存し、マスターデータ本体には混ぜない。

## 2. 対象プラットフォーム

エディタは Windows と macOS を対象とする。

配布物は unsigned / unnotarized の開発者向けアプリでよい。一般ユーザー向けに警告ゼロで配布することは v1 の必須要件ではない。

利用者がアプリを使うだけであれば、フロントエンド開発用の npm などは不要である。ただし、Lilja.MasterData の build/generate 系処理が内部で必要とする外部コマンド、特に `dotnet` は利用環境に存在する必要がある。

## 3. プロジェクトモデル

### 3.1 プロジェクトルート

Lilja.MasterData プロジェクトは、`project-settings.yaml` を持つディレクトリをプロジェクトルートとする。

ユーザーがプロジェクトを開く時は、`project-settings.yaml` があるディレクトリを選択する。ただし、選択されたディレクトリやファイルがプロジェクト配下であれば、親方向へ探索して `project-settings.yaml` を持つディレクトリをプロジェクトルートとして扱ってよい。

### 3.2 master ディレクトリ

プロジェクト設定の `master.input` が master 定義ディレクトリを示す。既定値は `master` である。

master ディレクトリ配下には、enum、struct、table の YAML ファイルを任意のフォルダ構成で配置できる。フォルダ構成は生成結果の型名には影響しない。ただし、Unity 側などへ同期する時は、必要に応じてフォルダ構成が維持される。

### 3.3 永続データ

エディタで編集される永続データは主に次の3種類である。

- `project-settings.yaml`: プロジェクト単位の設定。
- `master/**/*.yaml` または `master/**/*.yml`: enum、struct、table の定義ファイル。
- `<definition-name>.config.json`: 表示専用 sidecar。列幅、列順、色、フィルタなど、マスターデータ本体に含めるべきでない UI 情報を保存する。

YAML コメントの保持は必須ではない。保存時は、エディタが扱うモデルから canonical YAML を生成して上書き保存する。

## 4. アプリ全体の画面構成

画面は次の領域で構成される。

- 上部ツールバー
- 左ペインのファイルエクスプローラ
- 中央のエディタ領域
- 下部の Problems / Build Log パネル
- 下部パネル非表示時のステータスストリップ

### 4.1 上部ツールバー

上部ツールバーには次の操作を配置する。

- 左ペイン表示切替
- アプリ名表示
- `File / Open Project`
- Undo
- Redo
- Save
- Validate
- Generate
- Build
- Sync
- Clean
- Project Settings
- Editor Settings
- Zoom out
- 現在ズーム率
- Zoom in
- 下部パネル表示切替

各ボタンはアイコンボタンを基本とし、ホバー時に操作名が分かる tooltip を持つ。

### 4.2 ウェルカムページ

プロジェクト未選択時は、中央にウェルカムページを表示する。

ウェルカムページには次を表示する。

- アプリ名
- `project-settings.yaml` を持つプロジェクトルートを開く旨の短い説明
- `Open Project...` ボタン
- 最近開いたプロジェクト一覧

`Open Project...` を押すと OS のディレクトリ選択ダイアログを開く。最近開いたプロジェクトをクリックすると、そのプロジェクトを直接開く。

### 4.3 エラー帯

処理中にアプリ全体のエラーが発生した場合、ツールバー直下にエラー帯を表示する。エラー帯には警告アイコンとエラーメッセージを表示する。

## 5. ファイルエクスプローラ

左ペインは master ディレクトリ配下の YAML ファイルとフォルダを表示する。

### 5.1 表示

左ペインのタイトルは `Master` とする。

ファイルツリーは実際のフォルダ階層をインデント付きで表示する。フォルダ配下のファイルを `directory/file.yaml` のように平坦化して表示してはならない。

各行には次を表示する。

- フォルダまたはファイル種別アイコン
- ファイル名またはフォルダ名
- dirty 状態がある場合のマーカー
- エラーがある場合のエラーマーカー
- 移動用ドラッグハンドル

ファイル種別アイコンは table、enum、struct、invalid を区別できるようにする。

### 5.2 ソート

ファイルツリー上部にソート UI を表示する。

ソート条件は次の2軸で指定できる。

- `File Name`
- `Updated`

ソート方向は次を選択できる。

- `Asc`
- `Desc`

フォルダとファイルが同じ階層にある場合、フォルダを先に表示する。

### 5.3 開く操作

ファイルは単クリックで開く。ダブルクリックを必須にしてはならない。

フォルダはクリックで折り畳み / 展開する。

### 5.4 作成操作

左ペイン上部には `+` ボタンを1つだけ表示する。

`+` ボタンを押すと、master ディレクトリ直下を作成先とする作成メニューを開く。

フォルダ行を右クリックした場合、そのフォルダ直下を作成先とする作成メニューを開く。ファイルツリーの空白部分を右クリックした場合、master ディレクトリ直下を作成先とする。

作成メニューは次の階層構造にする。

- `Create`
  - `Folder`
  - `Table`
  - `Enum`
  - `Struct`

デスクトップアプリとして実行している場合、可能な限り OS 標準のコンテキストメニューを使う。ブラウザ開発実行など OS 標準メニューが使えない環境では、同じ階層に見える独自メニューで代替する。

作成時は、作成先パスを入力させる。YAML 定義ファイルの場合、拡張子が省略されていれば `.yaml` として扱う。

既定の新規ファイル名は次の通り。

- Table: `NewMaster.yaml`
- Enum: `NewEnum.yaml`
- Struct: `NewStruct.yaml`

同名ファイルや同名フォルダが既に存在する場合は、末尾に連番を付けた候補名を提示する。

### 5.5 移動操作

ファイルやフォルダは、行全体ではなく専用のドラッグハンドルからのみ移動できる。クリックによるファイル選択とドラッグ移動が競合してはならない。

ドラッグアンドドロップでできることは、所属フォルダの変更である。ファイル同士の順番入れ替えは行わない。表示順は常にソート条件で決まる。

フォルダを自分自身または自分の子孫フォルダへ移動することは禁止する。

未保存の変更があるファイル、または未保存ファイルを含むフォルダは、保存されるまで移動できない。

## 6. 中央エディタ領域

中央エディタ領域は、選択中のファイル種別に応じて table editor、enum editor、struct editor を切り替える。

ファイル未選択時は、YAML 定義を選ぶよう促す empty state を表示する。

すべての editor header には次を表示する。

- 定義種別
- 型名
- master ディレクトリ基準の相対パス

table editor のみタグフィルタを表示する。enum editor と struct editor ではタグフィルタを表示しない。

## 7. Table Editor

Table Editor は、テーブル定義とレコードを編集するための画面である。

画面は上から次の順に構成する。

- Editor Header
- 折り畳み式 Table Settings
- Records

### 7.1 Table Header

Records の上部に固定表示される列ヘッダーは、スクロールしてもレコード行と幅がずれてはならない。列ヘッダーとレコードセルは同じ列モデル、同じ幅、同じ水平スクロール領域で描画する。

列ヘッダーは、従来の Schema 領域の機能を兼ねる。独立した Schema 領域は設けない。

列ヘッダーには次を表示する。

- ドラッグハンドル
- MessagePack Key バッジ
- PK バッジ
- SK バッジ
- REF バッジ
- フィールド名入力
- 型選択ドロップダウン

MessagePack Key バッジは、生成される C# の `[Key(n)]` に相当する固定 index を表す。列の見た目上の順番を入れ替えても、各フィールドの fixed index は維持される。

fixed index が重複している場合は、Key バッジをエラー状態として表示する。

### 7.2 型選択

型選択ドロップダウンは、次のグループに分けて表示する。

- `Primitive`: `bool`, `int`, `long`, `float`, `double`, `string`
- `Enum`: 読み込まれている enum 型
- `Struct`: 読み込まれている struct 型
- `List`: primitive、enum、struct それぞれに対する `list<T>`

現在の型が候補に存在しない場合、現在値を失わないよう `Current` グループとして表示する。

### 7.3 列の追加・削除・複製・移動

Records 見出しには `Add Field` ボタンを表示する。押すと末尾に新しい string 型フィールドを追加し、既存レコードには既定値を入れる。

列ヘッダーを右クリックすると列コンテキストメニューを表示する。メニューには次を含める。

- `Move Left`
- `Move Right`
- `Move to First`
- `Move to Last`
- `Insert Field Left`
- `Insert Field Right`
- `Duplicate Field`
- `Delete Field`
- `Advanced: Edit MessagePack Key`

列削除時は確認ダイアログを表示する。削除すると、フィールド定義、全レコードの該当データ、primary key、secondary key、MasterRef の local mapping から該当フィールドを削除する。

列複製時は、元の型とセル値をコピーし、フィールド名は重複しない名前にする。fixed index は新しい未使用値を割り当てる。

### 7.4 列ドラッグによる入れ替え

列ヘッダーのドラッグハンドルをドラッグすると、カーソル位置に応じて列と列の間に太い縦線の gap marker を表示する。

マウスを離すと、ドラッグ元の列を gap marker の位置へ挿入する。移動はスライド式であり、列同士を単純交換する操作ではない。

列の見た目上の順番は変わるが、各フィールドの fixed index は変わらない。

### 7.5 Table Settings

Table Settings は Editor Header と Records の間に配置する。初期状態では折り畳まれている。

Table Settings では次を編集できる。

- Primary Key
- Secondary Keys
- MasterRef

#### 7.5.1 Primary Key

Primary Key は、フィールド選択の ordered list として編集する。複合キーの場合、並び順がキー順序となる。

各キー構成要素は次の操作ができる。

- フィールド選択
- 上へ移動
- 下へ移動
- 削除
- フィールド追加

Primary Key は最低1フィールドを持つ。

#### 7.5.2 Secondary Keys

Secondary Key は複数持てる。

各 Secondary Key は次を持つ。

- `unique` チェックボックス
- ordered fields

`unique` が true の場合、そのキー値は profile 適用後のビルド対象行で一意でなければならない。false の場合は non-unique key として扱う。

#### 7.5.3 MasterRef

MasterRef は、ある table のフィールドから他の table の key へ参照関係を定義する機能である。

MasterRef の編集 UI では次を指定する。

- ref 名
- 参照先 table
- 参照先 key
- 参照先 key field ごとの local field mapping

参照先 key の候補は、参照先 table の primary key と secondary key から生成する。

参照先 key が複合キーの場合、参照先 key の各 field に対応する local field を同数指定する。

MasterRef に使われている local field は、Records の列ヘッダーに `REF` バッジを表示する。

### 7.6 Records

Records には table の `rows` を表形式で表示する。

左から次の列を表示する。

- 行番号列
- `tags` 列
- table fields

行番号列は選択対象ではない。

`tags` 列は、行の `meta.tags` を編集する列である。表示名は `tags` とし、タグアイコンを併記する。タグ未設定の行は `untagged` と表示する。

### 7.7 行の追加・削除

Records 見出しには `Add Row` ボタンを表示する。押すと末尾に新しい行を追加する。

新規行の各フィールド値は型に応じた既定値にする。

- `bool`: `false`
- 整数・浮動小数: `0`
- `list<T>`: 空配列
- その他: 空文字

各行の削除ボタンは常時表示しない。マウスカーソルがその行にある時、または行にフォーカスがある時だけ表示する。

### 7.8 セル選択と編集状態

セルには「選択状態」と「入力状態」がある。

選択状態では、セル外縁がフォーカスされ、矢印キーや Tab によるセル移動が行われる。

入力状態では、セル内部の入力フィールドがフォーカスされ、文字入力や左右カーソル移動は入力フィールド内で行われる。

セルをクリックした場合、クリック位置が外縁なら選択状態、内部の入力領域なら入力状態に入る。ダブルクリック、Enter、F2 でも入力状態に入る。

Escape を押すと入力状態を抜けてセル選択状態に戻る。

### 7.9 キーボード操作

選択状態では次の操作を行う。

- `ArrowUp`: 上の表示行へ移動
- `ArrowDown`: 下の表示行へ移動
- `ArrowLeft`: 左のセルへ移動
- `ArrowRight`: 右のセルへ移動
- `Tab`: 右のセルへ移動
- `Shift+Tab`: 左のセルへ移動
- `Enter`: 入力状態に入る
- `Shift+Enter`: 上の表示行へ移動
- `F2`: 入力状態に入る

右端セルで `ArrowRight` または `Tab` を押した場合、次の表示行の一番左の選択対象セルへ移動する。最終行の右端ではその場に留まる。

左端セルで `ArrowLeft` または `Shift+Tab` を押した場合、前の表示行の一番右のセルへ移動する。先頭行の左端ではその場に留まる。

入力状態では次の操作を行う。

- `Enter`: 下の表示行へ移動
- `Shift+Enter`: 上の表示行へ移動
- `Tab`: 右のセルへ移動
- `Shift+Tab`: 左のセルへ移動
- `Escape`: 選択状態へ戻る

通常の文字入力中、左右矢印は入力フィールド内カーソル移動を優先する。

### 7.10 横スクロール

Shift を押しながらマウスホイールを縦方向に回すと、Records を横スクロールする。

### 7.11 TSV ペースト

通常セルの入力状態で TSV 形式のテキストをペーストした場合、現在セルを左上として複数セルへ貼り付ける。

貼り付け値は各列の型に合わせて変換する。

- `bool`: `true` または `1` を true、それ以外を false とする。
- `int` / `long`: 整数として解釈できる場合は数値、できない場合は入力文字列を維持する。
- `float` / `double`: 数値として解釈できる場合は数値、できない場合は入力文字列を維持する。
- `list<T>`: カンマ区切りを trim して配列にする。
- その他: 文字列として扱う。

### 7.12 Enum セル入力

フィールド型が enum の場合、通常の文字入力に加えて候補リストを表示する。

入力中は、現在の入力文字列に部分一致する enum member を入力欄の下に表示する。候補をクリックすると、その値をセルへ入力する。

enum が Flags として定義されている場合、カンマ区切りで複数 member を指定できる。候補選択時は、最後のカンマ区切り要素だけを置き換える。

### 7.13 Struct セル入力

フィールド型が自作 struct の場合、そのセルを選択または入力対象にすると、セル左上に吸着するフロート入力 UI を表示する。

フロート入力 UI は対象セルと一緒にスクロールし、セルの位置に追従する。

フロート入力 UI には struct の直下フィールドごとの入力欄を縦に並べる。

struct field の入力 UI は型に応じて次のようにする。

- `bool`: `true` / `false` の select
- enum: enum member の select
- scalar: 通常 input
- `list<T>`: JSON textarea
- nested struct: JSON textarea

空欄や未設定値は型に応じた既定値で初期化する。

Escape または閉じるボタンでフロート入力 UI を閉じる。

## 8. Tag Token Input

タグを入力する UI は、エディタ内のすべてのタグ入力箇所で統一する。

対象箇所は次の通り。

- table のタグフィルタ
- table row の `meta.tags`
- Project Settings の `Allowed Tags`
- Project Settings の build profile `includeTags`
- Project Settings の build profile `excludeTags`

### 8.1 タグ名ルール

タグ名は次の形式を満たす必要がある。

```text
^[A-Za-z0-9][A-Za-z0-9_.:-]*$
```

つまり、先頭は英数字、2文字目以降は英数字、`_`、`.`、`:`、`-` を使える。

`untagged` は予約済み疑似タグであり、実タグ名としては使用できない。

`untagged` を入力できるのは、タグフィルタと build profile の include / exclude のみである。row tags や allowed tags では禁止する。

### 8.2 入力体験

タグ入力中は、入力欄の下に候補リストを表示する。

候補リストには、現在の入力内容に部分一致するタグを表示する。候補を選択すると、そのタグは入力文字列ではなく token / block として表示される。

入力中に `,` または Space を押した場合、入力内容が有効なタグとして確定可能なら token 化する。

入力欄の右端には dropdown ボタンを置き、全候補からタグを選択できるようにする。

token は1文字相当のまとまりとして扱う。

- 左右矢印で token 単位に移動する。
- token の右隣にカーソルがある状態で Backspace を押すと token を削除する。
- token 内部にテキストカーソルは入らない。

重複タグは自動的に1つにまとめる。

### 8.3 Allowed Tags がある場合

Project Settings で allowed tags が設定されている場合、row tags は allowed tags 内から選択する。allowed tags が未設定の場合は、row tags のカスタム入力を許可する。

## 9. タグフィルタとプロファイル

### 9.1 Table 表示フィルタ

table editor の header にはタグフィルタを表示する。フィルタは include tags として機能する。

include tags が空の場合、除外条件に一致しないすべての行を表示する。タグ未設定行も表示する。

include tags が空でない場合、指定タグを1つ以上持つ行だけを表示する。タグ未設定行は表示しない。

疑似タグ `untagged` を include tags に含めた場合、タグ未設定行も表示対象に含める。

### 9.2 Build Profile Preview

Editor Settings では default profile / profile preview を選択できる。

profile preview が設定されている場合、table 表示上でその profile の対象外になる行を薄く表示する。対象外行を完全に消すのではなく、存在は分かるようにする。

profile preview は表示上の支援機能であり、YAML の内容そのものを変更しない。

### 9.3 Build Profile のタグ判定

profile のタグ判定は次の順で行う。

1. `excludeTags` に一致するタグを持つ行は除外する。
2. `excludeTags` に `untagged` が含まれ、行がタグ未設定なら除外する。
3. `includeTags` が空なら、除外されなかった行を含める。タグ未設定行も含める。
4. `includeTags` が空でない場合、指定タグを1つ以上持つ行を含める。
5. `includeTags` に `untagged` が含まれる場合、タグ未設定行も含める。

古い `includeUntagged` 設定は互換読み取り対象にしてよいが、v1 の UI では表示しない。新しい判定では `includeTags` / `excludeTags` と疑似タグ `untagged` を使う。

## 10. Enum Editor

Enum Editor は enum 定義を編集する画面である。

画面には次を表示する。

- Editor Header
- Flags チェックボックス
- member list

`Members` のような大きな見出し領域は設けない。

### 10.1 Flags

Flags チェックボックスをオンにすると、その enum は flags enum として扱う。

table の enum セル入力では、flags enum の場合にカンマ区切り複数値を扱える。

### 10.2 Member List

member list の各行には次を表示する。

- member name input
- value input
- delete button

value input が空の場合、その member は明示値なしとして扱う。value input に数値が入っている場合、明示的な enum value として保存する。

リスト末尾には `+` ボタンを表示する。押すと新しい member を末尾に追加し、新しく追加された member name input にフォーカスして全選択する。

member 削除ボタンを押すと、その member を削除する。

## 11. Struct Editor

Struct Editor は custom struct 定義を編集する画面である。

Enum Editor と同じ密度のリスト型 UI とする。大きな見出し領域や余白の大きい操作領域は設けない。

各 field 行には次を表示する。

- field name input
- field type select
- MessagePack Key button
- delete button

field type select は table の列型選択と同じく、Primitive、Enum、Struct、List にグループ化する。

MessagePack Key button を押すと、警告ダイアログを表示した上で fixed index を編集できる。fixed index の変更は既存バイナリ互換性を壊す可能性があるため、必ず確認を挟む。

リスト末尾には `+` ボタンを表示する。押すと新しい field を末尾に追加し、新しく追加された field name input にフォーカスして全選択する。

field 削除ボタンを押すと、その field を削除する。

## 12. Project Settings

Project Settings は `project-settings.yaml` を編集する画面である。

Project Settings 画面の header には次を表示する。

- `Project Settings`
- `project-settings.yaml` の絶対パス
- Save ボタン

未保存変更がない場合、Save ボタンは disabled にする。

### 12.1 Project

Project セクションでは次を編集する。

- Tool Version
- Master Input

### 12.2 C# Generation

C# Generation セクションでは次を編集する。

- Namespace
- Output
- Table Template
- Struct Template
- Enum Template
- Static DB Accessor enabled
- Static DB Accessor expression

テンプレート欄が空の場合、そのテンプレート設定は削除されたものとして扱う。

Static DB Accessor が enabled の場合、MasterRef などから生成される補助コードが static database accessor を使う前提のコード生成を行える。

### 12.3 Memory / Sync

Memory / Sync セクションでは次を編集する。

- Memory Output
- Memory File Name
- Sync C# To
- Sync Memory To

Sync C# To と Sync Memory To が空の場合、その sync path は未設定として扱う。

### 12.4 Tags

Tags セクションでは Allowed Tags を token input で編集する。

Allowed Tags は実タグのみを受け付ける。`untagged` は指定できない。

### 12.5 Build Profiles

Build Profiles セクションでは、複数の build profile を編集できる。

セクション見出しには Add ボタンを表示する。Add を押すと profile 名を入力し、存在しない名前であれば profile を追加する。

各 profile 行には次を表示する。

- profile name input
- includeTags token input
- excludeTags token input
- delete button

profile name input は blur 時に rename を実行する。既に存在する名前への rename は行わない。

includeTags / excludeTags では `untagged` 疑似タグを入力できる。

## 13. Editor Settings

Editor Settings はエディタ全体の preference を編集する画面である。プロジェクトごとの YAML ではなく、アプリのグローバル設定として保存する。

Editor Settings 画面には次のセクションを表示する。

### 13.1 Appearance

- Theme: `System`, `Light`, `Dark`
- Zoom
- Grid Font Size

Zoom は 75% から 180% の範囲で扱う。Zoom In / Zoom Out は文字サイズだけでなく、grid の行高、ヘッダー高、入力欄高、列幅などにも反映し、画面に収まる情報量が増減するようにする。

Grid Font Size は 10 から 22 の範囲で扱う。

### 13.2 Layout

- Sidebar visible
- Bottom Panel visible
- Bottom Panel Height
- Bottom Panel Active Tab

Bottom Panel Height は 96px 以上、画面高さの 45% 以下に制限する。

### 13.3 Project Defaults

- Default Profile

Default Profile は profile preview や build / validate の既定 profile として使える。空の場合は全 row 対象とする。

### 13.4 Recent Projects

最近開いたプロジェクトを最大12件程度表示する。ここは履歴表示であり、直接編集 UI は必須ではない。

## 14. 下部パネル

下部パネルには `Problems` と `Build Log` の2タブを表示する。

下部パネルは表示 / 非表示を切り替えられる。非表示時は status strip を表示する。

### 14.1 サイズ変更

下部パネル上端には resize handle を配置する。

ドラッグで高さを変更できる。ダブルクリックで既定値 160px に戻す。

高さは 96px 以上、画面高さの 45% 以下に制限する。

### 14.2 Problems

Problems タブには validate / build / generate などで得られた diagnostics を表示する。

各行には次を表示する。

- severity icon
- diagnostic code
- 対象ファイルの短縮パス、または project
- message

diagnostic 行をクリックすると、該当ファイルを中央エディタで開く。該当ファイルが開ける場合は左ペインも表示する。

行やセルなどの詳細位置情報が diagnostic に含まれる場合は、将来的にその位置へフォーカスできるようにする。ただし、最低要件は該当ファイルを開くことである。

### 14.3 Build Log

Build Log タブには、プロジェクトを開いた履歴、保存、ファイル作成、validate、build、generate、sync、clean の結果を時系列で表示する。

表示対象は直近100件程度でよい。

### 14.4 Status Strip

下部パネル非表示時は status strip を表示する。

status strip には次を表示する。

- Problems 件数
- 最新の build log 1行

Problems 件数または build log をクリックすると、下部パネルを開き、対応するタブを表示する。

## 15. コマンド実行

エディタから実行できるプロジェクトコマンドは次の通り。

- Validate
- Generate
- Build
- Sync
- Clean

Validate と Build は、選択中の profile preview / default profile があれば、それを profile として渡せる。profile 未指定時は全 row を対象にする。

Generate、Sync、Clean は profile 非対応でよい。

コマンド実行後は下部パネルを自動表示する。

- diagnostics が1件以上ある場合は Problems タブを開く。
- diagnostics がない場合は Build Log タブを開く。

コマンドは保存済みの YAML ファイルを対象にする。未保存の編集内容は Save されるまでファイルシステムへ反映されないため、build や validate の対象にならない。

## 16. 保存

### 16.1 Document 保存

table、enum、struct の編集内容は、Save を押すまで YAML ファイルへ書き戻されない。

Save 時は、エディタ内部の document model から canonical YAML を生成し、元ファイルへ保存する。

保存が成功した document は dirty 状態を解除する。

### 16.2 Project Settings 保存

Project Settings は通常 document とは別の dirty 状態を持つ。

Project Settings 画面で Save を押すと、`project-settings.yaml` を canonical YAML として保存し、プロジェクトを再読み込みする。

### 16.3 Atomic Save

ファイル保存は可能な限り atomic に行う。保存途中で失敗した場合、既存ファイルを壊さないことを目標とする。

## 17. Undo / Redo

Undo / Redo は v1 の重要機能である。

### 17.1 Document History

table、enum、struct の編集操作は transaction として undo stack に積む。

例:

- セル編集
- row 追加 / 削除
- field 追加 / 削除 / rename / reorder
- key 編集
- MasterRef 編集
- enum member 追加 / 削除 / 編集
- struct field 追加 / 削除 / 編集

1セル編集は1 transaction とする。複数セル paste はまとめて1 transaction とする。

Save 後も Undo は可能である。Undo した場合、その document は dirty になる。

### 17.2 Project-level History

ファイルやフォルダの作成、削除、移動は project-level history として扱う。

document history が存在する場合、Undo / Redo はまず active document の履歴を優先する。active document に戻す操作がない場合、project-level history を対象にする。

未保存のファイルや未保存ファイルを含むフォルダに対して、移動や削除などファイル構造を変える操作を行うことは禁止する。

### 17.3 ショートカット

次のショートカットをサポートする。

- macOS: `Cmd+Z` Undo
- macOS: `Cmd+Shift+Z` Redo
- Windows: `Ctrl+Z` Undo
- Windows: `Ctrl+Y` Redo
- Windows: `Ctrl+Shift+Z` Redo
- `Cmd/Ctrl+S` Save
- `Cmd/Ctrl++` Zoom In
- `Cmd/Ctrl+-` Zoom Out
- `Cmd/Ctrl+0` Reset Zoom

## 18. 未保存変更とウィンドウ終了

未保存変更がある状態で OS 標準のウィンドウ close ボタンを押した場合、確認ダイアログを表示する。

確認ダイアログには少なくとも次の選択肢を持たせる。

- Discard
- Cancel

Discard を選択した場合、未保存変更を破棄してウィンドウを閉じる。Cancel を選択した場合、ウィンドウを閉じない。

未保存変更がない場合は確認なしで閉じる。

未保存判定は次のいずれかが true の場合に true とする。

- dirty document が1つ以上存在する。
- Project Settings が dirty である。

ブラウザ開発実行時は、標準の beforeunload 警告で代替してよい。

## 19. Validation 表示

プロジェクトを開いた時、または validate / build などのコマンドを実行した時、diagnostics を取得して UI に反映する。

ファイルに関連する diagnostic がある場合、左ペインの該当ファイルにエラーマーカーを表示する。フォルダ配下にエラーがある場合、フォルダにもエラーがあることを示す。

table の primary key 重複は、行番号列にエラーマーカーとして表示する。マーカーに hover すると、重複キーの詳細を tooltip で表示する。

## 20. Sidecar 表示設定

マスターデータ本体に関係ない表示設定は、YAML に混ぜず sidecar JSON に保存する。

sidecar は対象 YAML と同じフォルダに、同じ stem の `.config.json` として保存する。

例:

- `items.yaml`
- `items.config.json`

sidecar に保存し得る情報は次の通り。

- column widths
- column order
- hidden columns
- column colors
- row heights
- cell colors
- freeze columns
- last filter

これらは表示・操作補助情報であり、generate / build / sync の意味論に影響してはならない。

## 21. パス安全性

エディタから作成、保存、移動、削除できるファイルは、プロジェクトの master ディレクトリ配下に限定する。

絶対パス、`..` を含むパス、Windows の drive prefix など、master ディレクトリ外を指す可能性があるパスは拒否する。

定義ファイルとして保存・作成できる拡張子は `.yaml` または `.yml` とする。

## 22. 既定の新規定義

新しい enum を作成した場合、型名はファイル名から PascalCase で推測し、member は空にする。

新しい struct を作成した場合、型名はファイル名から PascalCase で推測し、field は空にする。

新しい table を作成した場合、ファイル名から table 名を推測し、次の既定値を持つ。

- `table`: ファイル名ベース。末尾が `Master` の場合は取り除く。
- `typeName`: `${table}Master`
- primary key: `Id`
- fields:
  - `Id`: `int`, fixed index 0
  - `Name`: `string`, fixed index 1
- rows: 空

## 23. MessagePack Key / fixed index

table field と struct field は fixed index を持つ。

fixed index は、生成される C# の MessagePack `[Key(n)]` に使われる。これはバイナリ互換性に関わるため、見た目上の列順とは独立して扱う。

新しい field を追加する時は、既存 field の fixed index の最大値 + 1 を割り当てる。

fixed index が未設定の古い YAML を読み込んだ場合、読み込みまたは保存時に自動補完してよい。補完時は、既存の明示 fixed index と重複しない値を割り当てる。

ユーザーが advanced 操作で fixed index を変更する場合、必ず「バイナリ互換性が壊れる可能性がある」旨の確認を表示する。

## 24. データ整合性ルール

エディタは入力を即座に完全禁止するのではなく、可能な限り編集を継続できるようにし、validate 結果や UI マーカーで問題を知らせる。

ただし、次の操作は即時拒否してよい。

- master ディレクトリ外へのパス操作
- 既に存在するパスへの作成 / 移動
- 自分自身の子孫へのフォルダ移動
- 未保存変更を含むファイル / フォルダの移動
- invalid なタグ名の token 化
- 実タグとしての `untagged`

validate では少なくとも次を検出する。

- YAML 構造エラー
- 型定義エラー
- 値型エラー
- primary key 重複
- unique secondary key 重複
- MasterRef 解決不能
- allowed tags 未宣言タグ
- 実タグとしての `untagged`

profile 指定時の validate / build では、profile 適用後の row 集合に対して key と MasterRef の整合性を検証する。

## 25. UI 密度と視認性

このエディタはマスターデータ作業用の業務ツールであり、マーケティング的な余白の大きい画面ではなく、情報密度と操作速度を優先する。

ただし、table の列定義、key、ref、tags など意味の違う情報は、色、バッジ、境界線、アイコンで識別できるようにする。

Records は大量行でも操作できるよう、行方向の仮想化を行ってよい。仮想化しても、選択、スクロール、キーボード移動、エラーマーカー、struct popover の位置が破綻してはならない。

## 26. v1 の非目標

v1 では次を必須としない。

- Git 統合
- 複数ユーザー共同編集
- YAML コメント保持
- 高度な差分ビュー
- plugin system
- 一般配布向け code signing / notarization
- Excel と完全同一の全操作再現

ただし、将来の拡張を妨げないよう、YAML 本体と UI sidecar、project settings、editor preferences は明確に分離する。
