// Vite が用意する仮想モジュール "virtual:site-content" の型です。
// 開発サーバー・本番ビルドの両方で、内容フォルダの site.json と data.json の既定値を渡します（vite.config.ts の siteContent プラグインが作ります）。
// トップレベルに import を書くとこのファイルがモジュール扱いになり、宣言が効かなくなるため、
// import("./content.ts") の形で型を参照しています。
declare module "virtual:site-content" {
  const siteContent: import("./content.ts").SiteContent
  export default siteContent
}
