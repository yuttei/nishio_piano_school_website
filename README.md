# にしおピアノ教室 Webサイト

個人のピアノ教室「にしおピアノ教室」の Web サイトのコードである。レッスン内容・料金・空き状況・イベントを紹介する公開 4 ページ（ホーム・レッスン・イベント・無料体験）と、スマートフォンから空き状況・イベント・写真を更新する自作管理画面（`/admin/`）、およびその後ろ側で動く Cloudflare Pages Functions を含む。

サイトは HTML・CSS・TypeScript と Vite で構築し、ビルド時に各ページを静的な HTML として出力する。公開ページは読み込み時に `/api/content` から最新の更新内容を取得して表示に反映し、通信失敗時や未更新時はビルド時の静的 HTML をそのまま表示する。ビルド時のデータ取得先として microCMS を併用することもできる。

このリポジトリにはサイトのコード（骨組み・スタイル・スクリプト・管理画面・Cloudflare Pages Functions）だけを入れている。教室の文章・料金・写真などの実際の内容は非公開リポジトリ `website_content` に分けて管理しており、ビルド時に組み合わせて公開している。

- 公開中のサイト：<https://nishio-piano-school.pages.dev>
- [内容フォルダの形式](docs/content-folder.md)
- [管理画面と Cloudflare Pages Functions の設計](docs/admin-architecture.md)

## 管理画面でできる操作

- 空き状況の更新（曜日・時間帯ごとの選択と更新日時の自動記録）
- イベントの追加・編集・削除
- イベントの表示順の並び替え
- トップページ 3 枠（ピアノ写真・教室紹介写真・イベント紹介写真）およびイベント写真の差し替え

本番環境では `/admin/` と `/api/admin/*` を Cloudflare Access で保護し、公開 4 ページのフッターには `/admin/` へのリンクを出力しない。

## ローカル開発（Vite 開発サーバー）

非公開リポジトリをこのディレクトリの兄弟フォルダ `../website_content` に置いたうえで、このディレクトリで次を実行する。初回は `nix develop path:.` で開発環境を準備する。

```sh
nix develop path:.
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

- [教室サイト](http://127.0.0.1:4173/)
- [管理画面](http://127.0.0.1:4173/admin/)

`npm run dev` は既定で兄弟フォルダ `../website_content` を使う。別の場所に置いた場合は、環境変数 `SITE_CONTENT_DIR` で内容フォルダを指定する。内容フォルダはこのリポジトリの外に置く（中に置くとエラーになる）。

`npm run dev` 中の管理画面はブラウザー内の `localStorage` に保存する開発モードで動き、同じブラウザーのトップ・レッスン・イベントページで変更結果をすぐ確認できる。

## Pages Functions 込みのローカル確認

ビルド後の静的ファイルと Cloudflare Pages Functions（Workers KV・R2・認証ミドルウェア）をまとめて手元で動作確認するには、次を実行する。

```sh
npm run build && npm run dev:pages
```

`npm run dev:pages` はローカル用の KV（`SITE_KV`）・R2（`SITE_PHOTOS`）と `ALLOW_LOCAL_ADMIN_BYPASS=true` を付けて `wrangler pages dev dist` を起動する。ローカルバイパスは `localhost` と `127.0.0.1` でのみ有効であり、認証設定が未完了の本番環境では管理 API が `503` で停止する。

## ビルドとデプロイ

兄弟フォルダ `../website_content`（別の場所なら `SITE_CONTENT_DIR` で指定したフォルダ）を用意して `npm run build` を実行すると、フロントエンドと Functions の型チェック（`npm run check`）後に公開 4 ページと管理画面を `dist/` へ出力する。

Cloudflare Pages へのデプロイは次を実行する。本番の KV Namespace ID や R2 バケット設定、Cloudflare Access の環境変数は公開リポジトリに置かないため、`wrangler.toml` は作成せず Cloudflare ダッシュボード側で管理する。

```sh
npx wrangler pages deploy dist --project-name nishio-piano-school
```

必要なバインディングと環境変数の一覧は [管理画面と Cloudflare Pages Functions の設計](docs/admin-architecture.md) を参照すること。

## ビルド時の microCMS 連携（任意）

ビルド時の静的 HTML に microCMS のデータを取り込む場合は、ビルド環境に `MICROCMS_SERVICE_DOMAIN` と `MICROCMS_API_KEY` を設定する。API キーはデータ取得用として設定し、内容は公開用の HTML に出力しない。未設定時のビルドは内容フォルダの `data.json` を使用する。

| API | 形式とフィールド |
| --- | --- |
| `availability` | オブジェクト形式。`mon_morning`、`mon_afternoon` のように、`mon` から `sun` の 7 曜日と `morning`・`afternoon` を組み合わせた 14 個の単一選択。選択肢は「余裕あり」「残りわずか」「空きなし」「休み」。`morning` は内容フォルダの `site.json` の `timeSlots` の 1 つ目、`afternoon` は 2 つ目の時間帯として表示 |
| `events` | リスト形式。`title` はテキスト、`description` はテキストエリア。任意で `month`（`YYYY-MM` のテキスト）、`image`（画像）、`imageAlt`（代替テキスト） |
| `site-photos` | トップの写真を更新する場合に使用するオブジェクト形式。`piano`、`stickers`、`recital` は画像。`piano_alt`、`stickers_alt`、`recital_alt` は各写真の代替テキスト |

トップの写真も microCMS で管理する場合は、`site-photos` を作成して公開し、ビルド環境に `MICROCMS_HOME_PHOTOS_API=site-photos` を設定する。環境変数や個別の画像を省略した箇所には、内容フォルダの写真を使用する。

## 検査と CI

コミットの前には、pre-commit（`.githooks/pre-commit`）が次の 2 つを自動で検査する。

- 実際の内容（文章・リンク・写真）がコミットに混ざっていないかを、内容フォルダがあるときだけ `scripts/check-private-content.mjs` で確認（既定の場所はメイン作業ツリーの兄弟フォルダ `website_content`、`SITE_CONTENT_DIR` で変更可能）
- API キーやパスワードなどが含まれていないかを `gitleaks` で確認

`main` へのプルリクエストでは、GitHub Actions（`.github/workflows/check.yml`）が次を確認する。

- 公開してよい画像（マスコットと SNS のアイコン）以外の画像が入っていないこと
- 制作計画案が入っていないこと
- TypeScript の型チェック（`npm run check`：フロントエンドと Functions の両方）が通ること

実際の内容と組み合わせたビルドと、このリポジトリのすべての履歴への混入の検査は、非公開リポジトリの CI が行う。
