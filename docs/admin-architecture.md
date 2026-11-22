# 管理画面と Cloudflare Pages Functions の設計

にしおピアノ教室の Web サイトに組み込んだ自作管理画面（`/admin/`）と、その後ろ側で動く Cloudflare Pages Functions（以下 Functions）の構成・API 仕様・セキュリティ設計・必要な設定をまとめる。

## 全体構成

本サイトは Cloudflare Pages で静的 HTML と Functions を一体運用し、データ保存に Cloudflare Workers KV（以下 KV）、画像保存に Cloudflare R2（以下 R2）、認証に Cloudflare Access を使用する。

| 構成要素 | 役割 |
| --- | --- |
| 静的 HTML（`dist/`） | `npm run build` で生成する公開 4 ページ（ホーム・レッスン・イベント・無料体験）と管理画面（`/admin/`）。ビルド時の内容フォルダ（`website_content`）の値を既定表示として埋め込む |
| 公開ページの即時反映（`src/live-content.ts`） | 公開ページの読み込み時に `GET /api/content` を取得し、KV に保存済みの項目だけ DOM を差し替え。通信失敗時やオフライン時はビルド済みの静的 HTML をそのまま表示 |
| 管理画面（`admin/index.html`・`src/editor.ts`・`src/content-store.ts`） | スマートフォンから空き状況・イベント（追加・編集・削除・並び替え）・写真を更新する画面。本番ビルドでは `/api/admin/*`、開発サーバー（`npm run dev`）ではブラウザーの `localStorage` を保存先に切り替え |
| Cloudflare Pages Functions（`functions/`） | 公開向けデータ配信（`/api/content`・`/api/photos/:key`）と、認証付き管理 API（`/api/admin/*`）を処理 |
| Cloudflare Workers KV（`SITE_KV`） | 空き状況・イベント一覧・トップページ写真 3 枠の JSON データを保存 |
| Cloudflare R2（`SITE_PHOTOS`） | 管理画面からアップロードされた画像ファイル本体を保存 |
| Cloudflare Access | `/admin/*` と `/api/admin/*` へのアクセス前にログイン認証を強制し、認証済みリクエストに JSON Web Token（以下 JWT）を付与 |

公開ページ 4 ページの HTML には `/admin/` へのリンクを出力しない。管理画面は URL を知っている運用者だけがアクセスし、Cloudflare Access で保護する。

## エンドポイント一覧

すべての JSON レスポンスには `Content-Type: application/json; charset=utf-8` と `Cache-Control: no-store` を付与する。

### 公開 API

認証なしで公開ページから参照するエンドポイントである。

| メソッド | パス | 入力 | 正常出力 | 主なエラーコード |
| --- | --- | --- | --- | --- |
| `GET` | `/api/content` | なし | `200`：`{ availability, events, homePhotos }`（KV 未保存または不正な項目は `null`） | なし |
| `GET` | `/api/photos/:key` | パス変数 `key`（`^[a-z0-9-]+\.(jpg\|webp\|png)$`） | `200`：R2 の画像バイナリ（ホワイトリスト済みの `Content-Type`、`X-Content-Type-Options: nosniff`、`Cache-Control: public, max-age=31536000, immutable`、`ETag` を付与） | `400`（キー形式不正）、`404`（画像なし） |

### 管理 API

`/api/admin/*` のすべてのリクエストは、事前に `functions/api/admin/_middleware.ts` で Cross-Site Request Forgery（以下 CSRF）対策と認証検証を通過する必要がある。

| メソッド | パス | 入力 | 正常出力 | 主なエラーコード |
| --- | --- | --- | --- | --- |
| `GET` | `/api/admin/content` | なし | `200`：`{ availability, events, homePhotos }` | `401`・`403`・`503`（認証・設定エラー） |
| `PUT` | `/api/admin/availability` | JSON：`{ rows: Status[][] }` | `200`：`{ rows, updatedAt }`（`updatedAt` はサーバー側で ISO 8601 日時を設定） | `400`（形式・値不正）、`401`・`403`・`503` |
| `PUT` | `/api/admin/events` | JSON：`{ events: SchoolEvent[] }` | `200`：`{ events }`（更新後に未参照の R2 画像を自動削除） | `400`（件数・文字数・ID 重複・画像パス不正）、`401`・`403`・`503` |
| `PUT` | `/api/admin/home-photos` | JSON：`{ homePhotos: Record<HomePhotoSlot, Photo> }` | `200`：`{ homePhotos }`（更新後に未参照の R2 画像を自動削除） | `400`（枠不足・画像パス・代替テキスト不正）、`401`・`403`・`503` |
| `POST` | `/api/admin/photos` | `multipart/form-data`（フィールド名 `file`、1 バイト以上 2MB 以下の JPEG・PNG・WebP） | `201`：`{ url: "/api/photos/<UUID>.<拡張子>" }` | `400`（ファイル未指定・サイズ超過・形式不正）、`401`・`403`・`503` |

## 認証・セキュリティ設計

管理 API は Cloudflare Access の設定だけに依存せず、Functions 側でも検証を行う多層防御を採用している。

### Cloudflare Access と JWT 署名検証

- `CF_ACCESS_TEAM_DOMAIN` と `CF_ACCESS_AUD` が設定されている場合、`cf-access-jwt-assertion` リクエストヘッダーを必須とし、未付与なら `401` を返却
- `CF_ACCESS_TEAM_DOMAIN` は末尾の `/` を除いたうえで `https://` で始まることを検証し、不正なら `503` を返却
- ライブラリ `jose` の `createRemoteJWKSet` で `${teamDomain}/cdn-cgi/access/certs` から公開鍵セットを取得し、`teamDomain` ごとにモジュール内でキャッシュ
- `jwtVerify` により署名・発行者（`issuer`）・対象（`audience`）・有効期限を検証し、失敗時は `403` を返却

### フェイルクローズとローカルバイパス条件

- `CF_ACCESS_TEAM_DOMAIN` と `CF_ACCESS_AUD` の両方が揃っていない環境では、原則として `503 Service Unavailable` を返して管理 API を停止（フェイルクローズ）
- 例外として、`CF_ACCESS_TEAM_DOMAIN` と `CF_ACCESS_AUD` がどちらも未設定であり、`ALLOW_LOCAL_ADMIN_BYPASS` が `"true"`、かつリクエスト URL のホスト名が `"localhost"` または `"127.0.0.1"` の場合のみローカル検証用に認証を通過
- 本番ドメインでは `ALLOW_LOCAL_ADMIN_BYPASS` の値にかかわらずバイパスを許可しない

### CSRF 対策

- `GET`・`HEAD`・`OPTIONS` 以外のメソッドで、`Origin` ヘッダーが存在する場合はリクエスト URL のオリジン（`new URL(request.url).origin`）との完全一致を検証し、不一致なら `403` を返却
- `Sec-Fetch-Site` ヘッダーが `cross-site` の場合は `403` を返却

### 画像アップロードと配信の安全性

- `POST /api/admin/photos` はファイル名や MIME タイプの自己申告を信用せず、先頭バイト（マジックバイト）を検査して JPEG（`FF D8 FF`）・PNG（`89 50 4E 47 0D 0A 1A 0A`）・WebP（先頭 `RIFF` かつ 8〜11 バイト目が `WEBP`）のみ受理
- 保存キーは `crypto.randomUUID()` と検証済み拡張子から生成し、ユーザー入力のファイル名を R2 のキーに使用しない
- `GET /api/photos/:key` はキー形式を `^[a-z0-9-]+\.(jpg|webp|png)$` に限定し、レスポンスの `Content-Type` は `image/jpeg`・`image/webp`・`image/png` のホワイトリストのみを許可して `X-Content-Type-Options: nosniff` を付与

## KV データ形式と R2 画像管理

### KV キー一覧と入力制約

入力検証は `src/content.ts` に集約し、管理画面と Functions で同じ規則を共有する。

| KV キー | 保存形式 | 入力制約 |
| --- | --- | --- |
| `availability:v1` | `{ rows: Status[][], updatedAt: string \| null }` | `rows` は 2 行 × 7 曜日。各値は「余裕あり」「残りわずか」「空きなし」「休み」の 4 種のみ |
| `events:v1` | `SchoolEvent[]` | 最大 200 件。`id` は空不可・重複不可・80 文字以内、`title` は空不可・120 文字以内、`month` は空文字または `YYYY-MM`、`description` は空不可・2000 文字以内、`image` は空文字または管理対象画像パス（`/images/...` または `/api/photos/...`）、`imageAlt` は 200 文字以内 |
| `home-photos:v1` | `Record<HomePhotoSlot, Photo>` | `piano`・`stickers`・`recital` の全 3 枠が必須。各枠の `image` は管理対象画像パス、`imageAlt` は空不可・200 文字以内 |

### 画像サイズ制約と不要画像の自動削除

- 管理画面は選択された画像をアップロード前にブラウザーの `<canvas>` で長辺最大 1200 ピクセルへ縮小し、品質 `0.82` の JPEG（`canvas.toBlob`）に変換して送信
- API 側の上限サイズは 1 ファイルあたり 2MB（2,097,152 バイト）
- `PUT /api/admin/events` と `PUT /api/admin/home-photos` は、保存前に旧データから `/api/photos/<key>` 形式のキーを収集
- 新データの KV 保存後、`events:v1` と `home-photos:v1` のどちらからも参照されなくなったキーだけを `SITE_PHOTOS.delete(key)` で削除
- 不要画像の削除に失敗しても、KV への本体保存が成功していればリクエスト自体は正常終了として返却

## バインディングと環境変数

本番環境のアカウント ID・KV Namespace ID・Access の値は公開リポジトリに含めない。リポジトリには `wrangler.toml` を置かず、以下のバインディングと環境変数は Cloudflare ダッシュボード（Pages プロジェクトの設定）で管理する。

| 種別 | 名前 | 用途 | 必須環境 |
| --- | --- | --- | --- |
| KV バインディング | `SITE_KV` | 空き状況・イベント・トップ写真の保存先 | 本番・プレビュー・ローカル Pages 検証 |
| R2 バインディング | `SITE_PHOTOS` | アップロード写真の保存先 | 本番・プレビュー・ローカル Pages 検証 |
| 環境変数 | `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access のチームドメイン（例：`https://example.cloudflareaccess.com`） | 本番・認証付きプレビュー |
| 環境変数 | `CF_ACCESS_AUD` | Cloudflare Access アプリケーションの AUD タグ | 本番・認証付きプレビュー |
| 環境変数 | `ALLOW_LOCAL_ADMIN_BYPASS` | ローカル検証で `"true"` を指定したときだけ `localhost` / `127.0.0.1` の認証を省略 | ローカル Pages 検証のみ（本番には設定しない） |

## ローカル検証とデプロイ

開発環境（`nix develop path:.`）で次のコマンドを使用する。

- 型チェック（フロントエンドと Functions の両方）：`npm run check`
- ビルド（静的 4 ページと管理画面を `dist/` へ出力）：`npm run build`
- Functions・KV・R2 込みのローカル確認：`npm run build && npm run dev:pages`
- Cloudflare Pages へのデプロイ：`npx wrangler pages deploy dist --project-name nishio-piano-school`
