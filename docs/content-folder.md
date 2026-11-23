# 内容フォルダの形式

サイトの文章・料金・空き状況・イベント・リンク・写真は、コードとは別の「内容フォルダ」（非公開リポジトリ `website_content`）に置く。ビルドと開発サーバーは、骨組みの HTML（`index.html` など）に内容フォルダの本文や部品を差し込み、公開 4 ページ（ホーム・レッスン・イベント・無料体験）を作る。管理画面（`/admin/`）で保存した更新内容の扱いは [管理画面と Cloudflare Pages Functions の設計](admin-architecture.md) を参照すること。

- 既定の置き場所：`website` の兄弟フォルダ（`../website_content`）
- 使い方：内容フォルダを用意し、`npm run dev`・`npm run build` を実行
- この文書の形式の版は `formatVersion: 1`

## フォルダの構成

```text
website_content/
├── site.json          教室全体の情報とリンク、各ページの題名と説明文
├── data.json          トップの写真、空き状況の既定値、イベントの一覧
├── pages/
│   ├── home.html      各ページの <main id="main"> の内側
│   ├── lessons.html
│   ├── events.html
│   └── trial.html
└── images/            写真（/images/ファイル名 で配信）
```

非公開リポジトリには、このほかに `check/forbidden-words.txt`（混入の検査で探す語）、`docs/`、`README.md` などを置く。サイトの組み立てには使わない。

## 内容フォルダの指定

- 環境変数 `SITE_CONTENT_DIR` で指定し、未指定なら兄弟フォルダ `../website_content`
- 相対パスはプロジェクトのフォルダ（`vite.config.ts` のあるフォルダ）から解決
- `.env` ファイルにも書けるが、コマンドの前に付けた環境変数のほうが優先
- 起動時に `内容フォルダ: （フォルダの絶対パス）` を表示
- 内容フォルダが見つからない場合はエラー
- シンボリックリンクをたどった実際の場所が、プロジェクト（`website`）の中にあるフォルダならすべてエラー（非公開の内容を公開リポジトリに入れないため）

## site.json

| 項目 | 型 | 説明 |
| --- | --- | --- |
| `formatVersion` | 数値 | 形式の版。`1` だけを受け付ける |
| `storageKeyPrefix` | 文字列 | 開発サーバー（`npm run dev`）で管理画面がブラウザー（`localStorage`）に保存するときのキー名の先頭。小文字の英字・数字・`-` だけ |
| `notice` | 文字列 | ヘッダーの上に出すお知らせの帯。空文字なら帯を出さない |
| `area` | 文字列 | フッターに出す所在地（地区）。空にできない |
| `availabilityDemoNote` | 文字列 | 開発サーバーで、空き状況の更新日がないときに表の上に出す説明。空文字なら公式 LINE への案内を出す |
| `timeSlots` | 文字列 2 つの配列 | 空き状況の時間帯。1 つ目が午前、2 つ目が午後 |
| `links` | オブジェクト | 外部サイトへのリンク（下の表） |
| `pages` | オブジェクト | `home`・`lessons`・`events`・`trial` ごとの `title`（`<title>`）と `description`（`<meta name="description">`）。どちらも空にできない |

`links` の各項目は、`https://` で始まる文字列か空文字にする。空文字の項目は表示しない。外部サイトへのリンク（`line`・`instagram`・`blog`・`map`）は、フッター・地図・ページ本文のいずれでも新規タブで開くよう `target="_blank" rel="noopener noreferrer"` を付与する。

| 項目 | 使う場所 | 空文字のとき |
| --- | --- | --- |
| `line` | フッター、ページ本文の `[LINE_URL]` | フッターのリンクと、`[LINE_URL]` を使う `<a>` を出さない |
| `instagram` | フッター、ページ本文の `[INSTAGRAM_URL]` | 同上 |
| `blog` | フッター、ページ本文の `[BLOG_URL]` | 同上 |
| `map` | 地図の下の「Google マップで開く」 | リンクを出さない |
| `mapEmbed` | 地図の埋め込み（`<iframe>`） | 地図の埋め込みを出さない |

開発サーバー（`npm run dev`）で `storageKeyPrefix` から作られる `localStorage` のキー名（例：`nishio-piano` のとき）：

| キー名 | 保存する内容 |
| --- | --- |
| `nishio-piano-availability-v1` | 空き状況 |
| `nishio-piano-event-list-v1` | 追加・編集・並び替え・削除を反映したイベント一覧全体 |
| `nishio-piano-home-photos-v1` | トップの写真の差し替え |
| `nishio-piano-events-v1` | 旧形式の追加イベント（`event-list-v1` 未保存時の互換読み取り用） |
| `nishio-piano-event-photos-v1` | 旧形式のイベント変更（`event-list-v1` 未保存時の互換読み取り用） |

本番ビルドおよび `wrangler pages dev` では `localStorage` を使わず、Cloudflare Workers KV（`SITE_KV`）と Cloudflare R2（`SITE_PHOTOS`）に保存する。

## data.json

`data.json` は静的ビルド時の初期表示および管理画面の既定値として使われる。本番環境で管理画面から KV に更新内容が保存されている場合、公開ページは読み込み時に `/api/content` の内容で該当箇所を上書き表示する。

| 項目 | 型 | 説明 |
| --- | --- | --- |
| `homePhotos` | オブジェクト | トップの写真。`piano`（ピアノ写真）・`stickers`（教室紹介）・`recital`（イベント紹介）の 3 つ |
| `availability` | オブジェクト | 空き状況の既定値。KV や microCMS に更新がないときの表示 |
| `events` | 配列 | イベントの一覧の既定値。KV や microCMS に更新がないときの表示 |

`homePhotos` の各写真：

| 項目 | 説明 |
| --- | --- |
| `image` | 内容フォルダでは `/images/ファイル名`（`images/` に実在すること）。管理画面から差し替えた写真は R2 配信パス（`/api/photos/<UUID>.<拡張子>`）として KV に保存 |
| `imageAlt` | 写真の説明（代替テキスト）。空にできない |
| `caption` | この既定の写真を表示しているときの写真の下の説明文。空文字なら出さない |
| `replacedCaption` | 管理画面や microCMS で写真を差し替えたときの説明文。空文字なら出さない |

`availability`：

| 項目 | 説明 |
| --- | --- |
| `rows` | `timeSlots` と同じ数（2 行）の配列。各行は月曜から日曜までの 7 つで、値は「余裕あり」「残りわずか」「空きなし」「休み」のどれか |
| `updatedAt` | 更新日時の文字列か `null` |

`events` の各イベント：

| 項目 | 説明 |
| --- | --- |
| `id` | イベントを見分ける名前。ほかのイベントと重ならないこと |
| `title` | 見出し。空にできない |
| `month` | 開催年月（`2026-11` の形）か空文字 |
| `description` | 紹介文。空にできない |
| `image` | 内容フォルダでは `/images/ファイル名` か空文字（写真なし）。管理画面からアップロードした写真は `/api/photos/<UUID>.<拡張子>` として KV に保存 |
| `imageAlt` | 写真の説明（代替テキスト） |

## pages/*.html

- 各ページの `<main id="main">` の内側だけを書く（`<head>` やヘッダー・フッターは骨組みの HTML と `src/render.ts` が作る）
- 字下げと末尾の改行は、そのまま出力に入る
- CSS のクラス名は `src/styles.css` に合わせる

ページの中に書く目印と、置き換わる内容：

| 目印 | 置き換わる内容 | 必須のページ |
| --- | --- | --- |
| `<!-- HOME_PHOTO_piano -->`<br>`<!-- HOME_PHOTO_stickers -->`<br>`<!-- HOME_PHOTO_recital -->` | トップの写真（と説明文） | `home` |
| `<div id="availability-content"><!-- AVAILABILITY --></div>` | 空き状況の表 | `lessons` |
| `<div id="event-content"><!-- EVENT_LIST --></div>` | イベントの一覧 | `events` |
| `<!-- ACCESS_MAP -->` | 地図と「Google マップで開く」 | なし |
| `[LINE_URL]`・`[INSTAGRAM_URL]`・`[BLOG_URL]` | `site.json` の `links` の URL | なし |
| `[LINE_ICON]`・`[INSTAGRAM_ICON]`・`[BLOG_ICON]` | SNS のアイコン画像 | なし |

- `id="availability-content"` と `id="event-content"` は、開発サーバーでのプレビュー反映（`src/demo.ts`）および本番ビルドでの公開ページ即時反映（`src/live-content.ts`）の両方で表示を書き換える対象として使う
- `[LINE_URL]`・`[INSTAGRAM_URL]`・`[BLOG_URL]` を `href` に持つ `<a>` タグには、URL の置換時に `target="_blank"` と `rel="noopener noreferrer"` の不足分を自動で付与する
- ビルドでは、置き換わらずに残った目印（`<!-- 大文字で始まる名前 -->` と `[〇〇_URL]`・`[〇〇_ICON]`）があるとエラー

## images/

- ファイル名は小文字の英字・数字・`.`・`-` だけ
- 使える種類：`.jpg`・`.jpeg`・`.png`・`.webp`・`.svg`
- `.` で始まるファイル（`.DS_Store` など）は無視
- `public/images/` にあるファイル（マスコットなど）と同じ名前は使えない
- 開発サーバーでは `/images/ファイル名` で配信（一覧にある名前だけを返し、`Cache-Control: no-cache` を付ける）
- ビルドでは `dist/images/ファイル名` に書き出し
- 管理画面からアップロードされた画像は内容フォルダではなく Cloudflare R2 に保存され、`/api/photos/<UUID>.<拡張子>` で配信（`src/render.ts` は `/images/...` と `/api/photos/...` の両方を許可）

## 読み込みと検査

`src/content-files.ts` が内容フォルダを読み込み、次を検査する。間違いがあれば、どのファイルのどの項目かを日本語で示して止まる。

- `site.json`・`data.json` が JSON として読めること
- `formatVersion` が `1` であること
- 上の表の項目と型、空にできない項目、URL の形
- `data.json` の `/images/…` が `images/` に実在すること
- `images/` の名前と種類、`public/images/` との名前の重なり
- `pages/` の 4 ファイルがあり、必須の目印を含むこと

仮想モジュール `virtual:site-content` と開発サーバーの動作：

- 仮想モジュール `virtual:site-content`（`site.json` と `data.json` の中身）は、開発サーバーと本番ビルドの両方で解決
- 本番ビルドでは、管理画面（`src/content-store.ts`）と公開ページの即時反映（`src/live-content.ts`）が既定値（時間帯名・トップ写真の既定説明文・KV 未保存時の初期データ）として `virtual:site-content` を参照
- 開発サーバーでは内容フォルダの変更を見張り、変わったら読み直してブラウザーを再読み込み

## 混入の検査

`scripts/check-private-content.mjs` は、実際の内容が公開リポジトリに紛れ込んでいないかを調べる。

```sh
node scripts/check-private-content.mjs ../website_content            # 作業ツリーのファイル
node scripts/check-private-content.mjs ../website_content --staged   # ステージ済みの内容（pre-commit）
node scripts/check-private-content.mjs website_content --repo website --history  # すべての履歴（非公開リポジトリのCI）
```

探す語：

- `site.json` の `area`、`area` を URL 用に変換した文字列、`notice`、`availabilityDemoNote`、`timeSlots` の各値、`links` の空でない値、各ページの `title`・`description`
- `data.json` のイベントの `title`・`description`・`imageAlt`、トップの写真の `imageAlt`・`caption`・`replacedCaption`
- `pages/*.html` からタグと目印を除いた本文を「。」と改行で区切った、12 文字以上の文
- `check/forbidden-words.txt` の各行（`#` で始まる行と空の行は除く）

調べる範囲：

| 指定 | 文字列を探す範囲 | 写真を比べる相手 |
| --- | --- | --- |
| なし | 追跡中のファイルと、`.gitignore` で除外されていない新しいファイル | 同じファイル |
| `--staged` | ステージ済みの内容（`git grep --cached`） | ステージ済みのファイル |
| `--history` | すべてのコミットの中身とコミットメッセージ | リポジトリにあるすべての blob |

- 文字列はそのままの形で探す（正規表現として扱わない）
- 大文字・小文字は区別しない
- 写真は `git hash-object` で得た blob の ID で、中身が同じかを比べる
- 見つかった場合は場所と語を表示して終了コード 1、見つからなければ「見つかりませんでした」と表示して終了コード 0
