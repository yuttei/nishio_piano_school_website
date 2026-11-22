// 写真を R2 にアップロードする管理 API（POST /api/admin/photos）です。
// ファイル名や拡張子をうのみにせず、先頭バイト（マジックバイト）で画像形式を厳密に確かめます。
import { jsonResponse, type Env } from "../../_lib/env.ts"

// 受け付けるファイルサイズの上限（2MB）です。
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

interface DetectedImageType {
  ext: "jpg" | "png" | "webp"
  contentType: "image/jpeg" | "image/png" | "image/webp"
}

// 画像データの先頭バイトを見て、JPEG・PNG・WebP のどれかを判定します。
function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" }
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" }
  }

  // WebP: 0..3 が "RIFF"、8..11 が "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", contentType: "image/webp" }
  }

  return null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: "写真の送信形式（multipart/form-data）が正しくありません。" }, 400)
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return jsonResponse({ error: "写真ファイルを選んでください。" }, 400)
  }

  if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
    return jsonResponse({ error: "写真は 2MB 以下の画像ファイルを選んでください。" }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PHOTO_BYTES) {
    return jsonResponse({ error: "写真は 2MB 以下の画像ファイルを選んでください。" }, 400)
  }

  const detected = detectImageType(bytes)
  if (!detected) {
    return jsonResponse({ error: "JPEG・PNG・WebP 形式の画像ファイルを選んでください。" }, 400)
  }

  const key = `${crypto.randomUUID()}.${detected.ext}`
  await env.SITE_PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: detected.contentType },
  })

  return jsonResponse({ url: `/api/photos/${key}` }, 201)
}
