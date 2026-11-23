// サイト全体のリクエストに通るルートミドルウェアです。
// 検索エンジンに載せたくないデプロイ固有 URL・非正規ホストや管理画面・管理 API のレスポンスに
// X-Robots-Tag: noindex, nofollow ヘッダーを付与します。
import type { Env } from "./_lib/env.ts"

// 検索エンジンのインデックス対象から外すべきアクセスかどうかを判定します。
function shouldAddNoindexHeader(url: URL, canonicalHost?: string): boolean {
  const hostname = url.hostname.toLowerCase()
  const pathname = url.pathname

  // 1. 管理画面（/admin, /admin/*）および管理用 API（/api/admin, /api/admin/*）は常に除外します。
  //    公開ページが使う /api/content や /api/photos/* は対象外です。
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  ) {
    return true
  }

  // 2. 正規ホスト名（CANONICAL_HOST）が設定されている場合は、それ以外のホスト名をすべて除外します。
  const normalizedCanonicalHost = canonicalHost?.trim().toLowerCase()
  if (normalizedCanonicalHost) {
    return hostname !== normalizedCanonicalHost
  }

  // 3. CANONICAL_HOST が未設定のときは、Cloudflare Pages のデプロイ固有 URL やブランチプレビュー URL
  //    （例：<hash>.nishio-piano-school.pages.dev のように 4 ラベル以上の *.pages.dev）だけを除外します。
  //    本番 URL（nishio-piano-school.pages.dev：3 ラベル）やローカル開発（localhost 等）には付けません。
  return hostname.endsWith(".pages.dev") && hostname.split(".").length > 3
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next()

  // WebSocket のアップグレード応答（101）などはヘッダーを書き換えずにそのまま返します。
  if (response.status === 101) {
    return response
  }

  const url = new URL(context.request.url)
  if (!shouldAddNoindexHeader(url, context.env.CANONICAL_HOST)) {
    return response
  }

  // 元のレスポンスヘッダーをコピーしてから X-Robots-Tag を追加します。
  const headers = new Headers(response.headers)
  headers.set("X-Robots-Tag", "noindex, nofollow")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
