# 見本の内容フォルダ

このフォルダは、サイトの動作を確かめるための見本の内容です。文章・料金・空き状況・イベント・写真はすべて架空のもので、実際の教室の内容ではありません。各ページの上には「このサイトは見本です」という帯が出ます。

`npm run dev` と `npm run build` は、このフォルダの内容でサイトを組み立てます。

## ファイルの役割

| パス | 内容 |
| --- | --- |
| `site.json` | 教室全体の情報（地区、空き状況の時間帯、SNS と地図のリンク）と、各ページの題名・説明文 |
| `data.json` | トップの写真、空き状況の既定値、イベントの一覧 |
| `pages/home.html` など | 各ページの `<main id="main">` の内側の本文 |
| `images/` | 見本の写真（SVG）。サイトでは `/images/ファイル名` で表示されます |

各項目の詳しい形式は [docs/content-folder.md](../docs/content-folder.md) に書いてあります。

## 実際の内容への切り替え方

実際の内容は、非公開リポジトリ `website_content` にあります。このリポジトリ（`website`）の兄弟フォルダ `../website_content` に置き、次のコマンドを使います。

```sh
npm run dev:real     # 開発サーバー
npm run build:real   # ビルド
```

ほかの場所に置いた場合は、環境変数 `SITE_CONTENT_DIR` に内容フォルダのパスを指定します（例：`SITE_CONTENT_DIR=/path/to/website_content npm run dev`）。実際の内容をこのリポジトリの中に置くとエラーになります。
