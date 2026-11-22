// イベント一覧（追加・編集・並び替え・削除）を KV に保存する管理 API（PUT /api/admin/events）です。
import { parseEventsPayload, type SchoolEvent } from "../../../src/content.ts"
import {
  cleanupUnusedPhotos,
  collectEventPhotoKeys,
  EVENTS_KEY,
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

  // 旧データにあって今回保存する新データには含まれないアップロード写真キーだけを、削除候補にします。
  const previous = await readDynamicContent(env)
  const previousKeys = collectEventPhotoKeys(previous.events ?? [])
  const nextKeys = collectEventPhotoKeys(events)
  const candidateKeys: string[] = []
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) {
      candidateKeys.push(key)
    }
  }

  await env.SITE_KV.put(EVENTS_KEY, JSON.stringify(events))
  await cleanupUnusedPhotos(env, candidateKeys, { kind: "events", events })

  return jsonResponse({ events })
}
