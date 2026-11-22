// 管理用 API（/api/admin/*）のすべてに先立って動く認証・CSRF 対策のミドルウェアです。
// 1. 更新系リクエスト（GET / HEAD / OPTIONS 以外）で外部サイトからの不正送信（CSRF）を遮断
// 2. Cloudflare Access の JWT 署名を検証（未設定の本番環境は安全のため 503 で停止）
import { createRemoteJWKSet, jwtVerify } from "jose"
import { jsonResponse, type Env } from "../../_lib/env.ts"

// 公開鍵セット（JWKS）を teamDomain ごとにキャッシュし、毎回通信しなくて済むようにします。
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(teamDomain)
  if (cached) return cached

  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
  jwksCache.set(teamDomain, jwks)
  return jwks
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url)

  // 1. CSRF 対策：状態を変更するメソッドでは、同じオリジンからの送信かを確かめます。
  const method = request.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = request.headers.get("origin")
    if (origin !== null && origin !== url.origin) {
      return jsonResponse({ error: "不正な送信元からのリクエストです。" }, 403)
    }

    const secFetchSiteHeader = request.headers.get("sec-fetch-site")
    if (secFetchSiteHeader !== null && secFetchSiteHeader.trim().toLowerCase() !== "same-origin") {
      return jsonResponse({ error: "外部サイトからの更新リクエストは許可されていません。" }, 403)
    }
  }

  // 2. 認証チェック（多層防御）：Cloudflare Access の JWT を検証します。
  const rawTeamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim()
  const rawAud = env.CF_ACCESS_AUD?.trim()

  if (rawTeamDomain || rawAud) {
    if (!rawTeamDomain || !rawAud) {
      return jsonResponse({ error: "管理画面の認証設定が完了していません。" }, 503)
    }

    const teamDomain = rawTeamDomain.replace(/\/+$/, "")
    let parsedTeamDomain: URL
    try {
      parsedTeamDomain = new URL(teamDomain)
    } catch {
      return jsonResponse({ error: "管理画面の認証設定が正しくありません。" }, 503)
    }
    if (parsedTeamDomain.protocol !== "https:") {
      return jsonResponse({ error: "管理画面の認証設定が正しくありません。" }, 503)
    }

    const token = request.headers.get("cf-access-jwt-assertion")?.trim()
    if (!token) {
      return jsonResponse({ error: "ログインが必要です。" }, 401)
    }

    try {
      const jwks = getJwks(teamDomain)
      await jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience: rawAud,
      })
    } catch {
      return jsonResponse({ error: "認証の確認に失敗しました。再度ログインしてください。" }, 403)
    }

    return next()
  }

  // ローカル開発（wrangler pages dev）でのみ、明示的な設定かつローカルホストのときに通過させます。
  if (env.ALLOW_LOCAL_ADMIN_BYPASS === "true" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return next()
  }

  // 認証設定が揃っていない場合は、誤って誰でも編集できる状態にならないよう必ず遮断します（フェイルクローズ）。
  return jsonResponse({ error: "管理画面の認証設定が完了していません。" }, 503)
}
