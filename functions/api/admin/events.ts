// イベント一覧（追加・編集・並び替え・削除）を KV に保存する管理 API（PUT /api/admin/events）です。
import { parseEventsPayload, type SchoolEvent } from "../../../src/content.ts"
import {
  cleanupUnusedPhotos,
  EVENTS_KEY,
  extractUploadedPhotoKey,
  jsonResponse,
  readDynamicContent,
  readJsonBody,
  type Env,
} from "../../_lib/env.ts"

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let events: SchoolEvent[]
  try {
    const body = await readJsonBody(request)
    events = parseEventsPayload(body.events)
  } catch (error) {
    const message = error instanceof Error ? error.message : "イベントの入力が正しくありません。"
    return jsonResponse({ error: message }, 400)
  }

  // 保存前のイベントで使っていたアップロード写真のキーを集め、不要になったものを後片付けします。
  const previous = await readDynamicContent(env)
  const candidateKeys: string[] = []
  for (const event of previous.events ?? []) {
    const key = extractUploadedPhotoKey(event.image)
    if (key) candidateKeys.push(key)
  }

  await env.SITE_KV.put(EVENTS_KEY, JSON.stringify(events))
  await cleanupUnusedPhotos(env, candidateKeys)

  return jsonResponse({ events })
}
