// 空き状況の表を KV に保存する管理 API（PUT /api/admin/availability）です。
import { parseAvailabilityRows, type Availability } from "../../../src/content.ts"
import { AVAILABILITY_KEY, jsonResponse, readJsonBody, type Env } from "../../_lib/env.ts"

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let rows: Availability["rows"]
  try {
    const body = await readJsonBody(request)
    rows = parseAvailabilityRows(body.rows)
  } catch (error) {
    const message = error instanceof Error ? error.message : "空き状況の入力が正しくありません。"
    return jsonResponse({ error: message }, 400)
  }

  const availability: Availability = {
    rows,
    updatedAt: new Date().toISOString(),
  }
  await env.SITE_KV.put(AVAILABILITY_KEY, JSON.stringify(availability))
  return jsonResponse(availability)
}
