# 技術的な SEO 対策の設計

にしおピアノ教室の Web サイトにおける技術的な Search Engine Optimization（以下 SEO）対策の仕組み、ビルド時に自動出力される要素、および Cloudflare Pages Functions（以下 Functions）によるインデックス制御の仕様をまとめる。

## 目的と対象範囲

公開 4 ページを検索エンジンおよび SNS 共有で正しく認識させると同時に、管理画面や Cloudflare Pages のデプロイ固有 URL が検索結果へ混入することを防ぐ。

- 検索エンジンのインデックス対象：公開 4 ページ（`/`・`/lessons/`・`/events/`・`/trial/`）
- インデックス除外対象：管理画面（`/admin`・`/admin/*`）、管理 API（`/api/admin`・`/api/admin/*`）、およびデプロイ固有 URL・非正規ホストへのアクセス
- 除外対象外とする公開 API：公開ページの表示に使う `/api/content` および `/api/photos/*`（本番の正規ホストでは `noindex` を付与しない）

## `siteUrl` の役割と未設定時の挙動

公開サイトの基準 URL は、内容フォルダ（`website_content`）の `site.json` にある任意項目 `siteUrl` で指定する。検証と正規化は `src/content.ts` の `parseSiteInfo` が行う。

- 入力形式：`https://` で始まるオリジン URL（例：`https://nishio-piano-school.pages.dev`）。ユーザー情報・パス・クエリ・ハッシュは不可
- 正規化規則：前後の空白を除き、末尾の `/` を取り除いたオリジン形式（`URL.origin`）に統一（例：`https://example.com/` は `https://example.com` に変換）
- 不正値の扱い：文字列以外の型、`http://`、パス付き URL（例：`https://example.com/sub`）などはビルド・起動時に日本語のエラーを出して停止
- 未設定・空文字の挙動：後方互換性のため `siteUrl` が省略されている場合や空文字の場合は空文字 `""` として扱い、`<meta name="description">` と `<title>` だけを出力。`canonical`・Open Graph Protocol（以下 OGP）・Twitter Card・構造化データ JavaScript Object Notation for Linked Data（以下 JSON-LD）・`dist/sitemap.xml`・`dist/robots.txt` 内の `Sitemap:` 行は出力しない

## 自動出力される要素一覧

### HTML `<head>` 内のメタタグと構造化データ

公開 4 ページの `<!-- PAGE_META -->` は、`vite.config.ts` から `src/render.ts` の `renderPageMeta` を呼び出して置換する。`og:image`・`twitter:image`・JSON-LD の `image` には、トップページのピアノ写真（`content.homePhotos.piano.image`）を使用する。サイト内パス（`/images/...` のように先頭が `/` で `//` ではない値）は `${siteUrl}${ogImagePath}` に変換し、`https://` で始まる値はそのまま絶対 URL として使用する。空文字や `data:` URL の場合は画像タグを出力しない。

| 要素 | 出力条件 | 出力内容 |
| --- | --- | --- |
| `<meta name="description">`・`<title>` | 常に全公開 4 ページ | `site.json` の `pages[page].description` と `pages[page].title` |
| `<link rel="canonical">` | `siteUrl` 設定時、全公開 4 ページ | `${siteUrl}${pages[page].path}` |
| OGP タグ | `siteUrl` 設定時、全公開 4 ページ | `og:type`（`website`）、`og:site_name`（`にしおピアノ教室`）、`og:locale`（`ja_JP`）、`og:title`、`og:description`、`og:url`、および画像 URL がある場合のみ `og:image` |
| Twitter Card タグ | `siteUrl` 設定時、全公開 4 ページ | `twitter:card`（画像 URL ありなら `summary_large_image`、なければ `summary`）、`twitter:title`、`twitter:description`、および画像 URL がある場合のみ `twitter:image` |
| 構造化データ JSON-LD | `siteUrl` 設定時、トップページ（`home`）のみ | `<script type="application/ld+json">` に `schema.org` の `MusicSchool` データを出力 |

トップページの JSON-LD に含める項目は次のとおりである。`<script>` 内に安全に埋め込むため、JSON 文字列内の `<`・`>`・`&`・`\u2028`・`\u2029` は Unicode エスケープ（`\u003c` など）へ変換する。

| プロパティ | 値の出典・出力条件 |
| --- | --- |
| `@context` | 固定値 `"https://schema.org"` |
| `@type` | 固定値 `"MusicSchool"` |
| `name` | 固定値 `"にしおピアノ教室"` |
| `url` | `${siteUrl}/` |
| `description` | `site.pages.home.description` |
| `image` | 解決済みの OG 画像 URL（空文字のときは省略） |
| `areaServed` | `site.area` |
| `sameAs` | `[site.links.instagram, site.links.blog, site.links.line]` から空文字を除いた配列（1 件以上あるときのみ出力） |

### ビルド時に生成する静的ファイル

`vite.config.ts` の `siteContent` プラグインは、本番ビルド（`command === "build"`）の `buildStart` で次のファイルを `dist/` へ出力する。

| 出力先 | 生成関数 | 出力条件と内容 |
| --- | --- | --- |
| `dist/robots.txt` | `renderRobotsTxt`（`src/render.ts`） | 毎回出力。`User-agent: *`、`Allow: /`、`Disallow: /admin/`、`Disallow: /api/admin/` を記載し、`siteUrl` 設定時のみ空行を挟んで `Sitemap: ${siteUrl}/sitemap.xml` を追記 |
| `dist/sitemap.xml` | `renderSitemapXml`（`src/render.ts`） | `siteUrl` 設定時のみ出力。`pageIds` の公開 4 ページ（`/`・`/lessons/`・`/events/`・`/trial/`）の `<url><loc>...</loc></url>` を XML エスケープして記載。`/admin/` は含めない |

管理画面（`admin/index.html`）には別途 `<meta name="robots" content="noindex">` を静的に記載している。

## `functions/_middleware.ts` による `X-Robots-Tag` 制御

ルートミドルウェア `functions/_middleware.ts` はすべてのリクエストを通過し、下流のレスポンス（`context.next()`）を受け取ったうえで、除外条件に一致する場合だけヘッダーをコピーして `X-Robots-Tag: noindex, nofollow` を付与する。ステータスコードが `101`（WebSocket 等）のレスポンスや、除外条件に一致しないレスポンスはそのまま返す。

### `X-Robots-Tag: noindex, nofollow` の判定条件

以下のいずれかに該当する場合にヘッダーを付与する。

| 判定条件 | 対象の例 | 動作 |
| --- | --- | --- |
| 管理画面・管理 API のパス（`/admin`・`/admin/*`・`/api/admin`・`/api/admin/*`） | `/admin/`、`/api/admin/content` | ホスト名や環境変数にかかわらず常に付与 |
| 環境変数 `CANONICAL_HOST` が設定済み、かつリクエストのホスト名（小文字正規化後）が一致しない | `CANONICAL_HOST=example.com` のときに `nishio-piano-school.pages.dev` へアクセス | 付与 |
| 環境変数 `CANONICAL_HOST` が未設定、かつホスト名が `.pages.dev` で終わりドット区切りのラベル数が 4 以上 | `abc123.nishio-piano-school.pages.dev`、ブランチプレビュー URL | 付与 |
| 上記以外（本番の `nishio-piano-school.pages.dev` への公開ページ・公開 API アクセス、ローカル開発の `localhost` 等） | `https://nishio-piano-school.pages.dev/`、`/api/content`、`/api/photos/...` | 付与しない |

### 環境変数 `CANONICAL_HOST`（任意）と独自ドメイン移行時の使い方

`CANONICAL_HOST` は `functions/_lib/env.ts` の `Env` に定義した任意項目であり、`pages.dev` だけで運用している間は設定不要である。将来独自ドメイン（例：`example.com`）へ移行したときは、次の 2 箇所を更新する。

- 内容フォルダ（`website_content`）の `site.json` にある `siteUrl` を新しい独自ドメイン（例：`https://example.com`）へ変更し、再ビルド・デプロイを実行
- Cloudflare Pages プロジェクトの環境変数に `CANONICAL_HOST=example.com` を設定し、旧 `nishio-piano-school.pages.dev` やデプロイ固有 URL へのアクセスすべてに `X-Robots-Tag: noindex, nofollow` を付与

## ビルド確認と動作確認

開発環境（`nix develop path:.`）で次の手順を実行し、型チェック・出力ファイル・レスポンスヘッダーを確認する。

```sh
npm run check
npm run build
```

確認する観点は以下のとおりである。

- `dist/robots.txt` に `Disallow: /admin/`・`Disallow: /api/admin/` が出力され、`siteUrl` 設定時は `Sitemap:` 行が含まれることを確認
- `dist/sitemap.xml` に公開 4 ページの URL だけが含まれ、`/admin/` が含まれないことを確認（`siteUrl` 未設定時はファイル自体が出力されないことを確認）
- `dist/index.html` に `canonical`・OGP・Twitter Card・有効な JSON-LD（`MusicSchool`）が出力され、他 3 ページには JSON-LD が出力されないことを確認
- `npm run dev:pages` 起動後、`/admin/` の応答に `X-Robots-Tag: noindex, nofollow` が付き、公開ページや `/api/content` には付かないことを確認
