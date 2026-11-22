// トップページの3枠の写真を KV に保存する管理 API（PUT /api/admin/home-photos）です。
import { parseHomePhotosPayload, type HomePhotoSlot, type Photo } from "../../../src/content.ts"
import {
  cleanupUnusedPhotos,
  collectHomePhotoKeys,
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

  // 旧データにあって今回保存する新データには含まれないアップロード写真キーだけを、削除候補にします。
  const previous = await readDynamicContent(env)
  const previousKeys = collectHomePhotoKeys(previous.homePhotos)
  const nextKeys = collectHomePhotoKeys(homePhotos)
  const candidateKeys: string[] = []
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) {
      candidateKeys.push(key)
    }
  }

  await env.SITE_KV.put(HOME_PHOTOS_KEY, JSON.stringify(homePhotos))
  await cleanupUnusedPhotos(env, candidateKeys, { kind: "homePhotos", homePhotos })

  return jsonResponse({ homePhotos })
}
