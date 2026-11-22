// R2 に保存された写真を配信する公開 API（GET /api/photos/:key）です。
import { jsonResponse, PHOTO_KEY_PATTERN, type Env } from "../../_lib/env.ts"

// 配信を許可する画像形式（MIME タイプ）のホワイトリストです。
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/webp", "image/png"])

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const key = typeof params.key === "string" ? params.key : ""
  if (!PHOTO_KEY_PATTERN.test(key)) {
    return jsonResponse({ error: "写真の指定が正しくありません。" }, 400)
  }

  const object = await env.SITE_PHOTOS.get(key)
  if (!object) {
    return jsonResponse({ error: "写真が見つかりません。" }, 404)
  }

  const ext = key.slice(key.lastIndexOf(".") + 1)
  const metadataType = object.httpMetadata?.contentType
  // ホワイトリストに一致する画像形式だけを Content-Type に設定します。
  const contentType = metadataType && ALLOWED_CONTENT_TYPES.has(metadataType)
    ? metadataType
    : EXTENSION_CONTENT_TYPES[ext]

  const headers = new Headers({
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
  })
  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag)
  }

  return new Response(object.body, { status: 200, headers })
}
