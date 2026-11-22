// 開発サーバーが用意する仮想モジュール "virtual:site-content" の型です。
// 中身は内容フォルダの site.json と data.json です（vite.config.ts の siteContent プラグインが作ります）。
// トップレベルに import を書くとこのファイルがモジュール扱いになり、宣言が効かなくなるため、
// import("./content.ts") の形で型を参照しています。
declare module "virtual:site-content" {
  const siteContent: import("./content.ts").SiteContent
  export default siteContent
}
