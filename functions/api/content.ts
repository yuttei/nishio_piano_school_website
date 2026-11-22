// 公開ページが最新の空き状況・イベント・トップ写真を取得するための公開 API（GET /api/content）です。
import { jsonResponse, readDynamicContent, type Env } from "../_lib/env.ts"

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const content = await readDynamicContent(env)
  return jsonResponse(content)
}
