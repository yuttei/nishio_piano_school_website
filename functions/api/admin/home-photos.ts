// トップページの3枠の写真を KV に保存する管理 API（PUT /api/admin/home-photos）です。
import { homePhotoSlots, parseHomePhotosPayload, type HomePhotoSlot, type Photo } from "../../../src/content.ts"
import {
  cleanupUnusedPhotos,
  extractUploadedPhotoKey,
  HOME_PHOTOS_KEY,
  jsonResponse,
  readDynamicContent,
  readJsonBody,
  type Env,
} from "../../_lib/env.ts"

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let homePhotos: Record<HomePhotoSlot, Photo>
  try {
    const body = await readJsonBody(request)
    homePhotos = parseHomePhotosPayload(body.homePhotos)
  } catch (error) {
    const message = error instanceof Error ? error.message : "トップ写真の入力が正しくありません。"
    return jsonResponse({ error: message }, 400)
  }

  // 差し替え前のトップ写真で使っていたアップロード写真のキーを集め、不要になったものを後片付けします。
  const previous = await readDynamicContent(env)
  const candidateKeys: string[] = []
  if (previous.homePhotos) {
    for (const slot of homePhotoSlots) {
      const photo = previous.homePhotos[slot]
      if (!photo) continue
      const key = extractUploadedPhotoKey(photo.image)
      if (key) candidateKeys.push(key)
    }
  }

  await env.SITE_KV.put(HOME_PHOTOS_KEY, JSON.stringify(homePhotos))
  await cleanupUnusedPhotos(env, candidateKeys)

  return jsonResponse({ homePhotos })
}
