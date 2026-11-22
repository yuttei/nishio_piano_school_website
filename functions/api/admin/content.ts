// 管理画面が現在の KV データを取得する API（GET /api/admin/content）です。
import { jsonResponse, readDynamicContent, type Env } from "../../_lib/env.ts"

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const content = await readDynamicContent(env)
  return jsonResponse(content)
}
