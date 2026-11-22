// Cloudflare Pages Functions 全体で共有する環境変数の型・KV 読み書き・画像後片付けの処理です。
import {
  homePhotoSlots,
  isManagedImagePath,
  isUploadedPhotoPath,
  MAX_IMAGE_ALT_LENGTH,
  parseAvailabilityRows,
  parseEventsPayload,
  type Availability,
  type DynamicSiteContent,
  type HomePhotoSlot,
  type Photo,
  type SchoolEvent,
} from "../../src/content.ts"

// Cloudflare ダッシュボード（Pages の設定）で紐づけるバインディングと環境変数です。
export interface Env {
  SITE_KV: KVNamespace
  SITE_PHOTOS: R2Bucket
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  ALLOW_LOCAL_ADMIN_BYPASS?: string
}

// KV に保存するときのキー名です。将来の形式変更に備えて :v1 を付けています。
export const AVAILABILITY_KEY = "availability:v1"
export const EVENTS_KEY = "events:v1"
export const HOME_PHOTOS_KEY = "home-photos:v1"

// /api/photos/<key> の <key> 部分に使える形式です（UUID と拡張子）。
export const PHOTO_KEY_PATTERN = /^[a-z0-9-]+\.(jpg|webp|png)$/

// 今回保存した確定データ（イベント一覧またはトップ写真）を表す型です。
// 不要画像の削除時に、更新した側を KV から再読み取りせず確定データで参照判定するために使います。
export type UpdatedPhotoReferences =
  | { kind: "events"; events: readonly SchoolEvent[] }
  | { kind: "homePhotos"; homePhotos: Record<HomePhotoSlot, Photo> }

// JSON レスポンスを共通のヘッダー付きで返します。
// 最新の状態をすぐ反映するため、キャッシュしない設定（no-store）を付けます。
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

// リクエストの JSON 本文を安全に読み取ります。壊れた JSON のときは例外を投げます。
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    throw new Error("送信されたデータの形式（JSON）が正しくありません。")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("送信されたデータはオブジェクト形式（{ }）にしてください。")
  }
  return parsed as Record<string, unknown>
}

// /api/photos/<key> から R2 の保存キー（<key>）だけを取り出します。
// 内容フォルダの静的写真（/images/...）や空文字のときは null を返します。
export function extractUploadedPhotoKey(url: string): string | null {
  if (!isUploadedPhotoPath(url)) return null
  return url.slice("/api/photos/".length)
}

// イベント一覧から参照されている R2 写真キーの集合を集めます。
export function collectEventPhotoKeys(events: readonly SchoolEvent[]): Set<string> {
  const keys = new Set<string>()
  for (const event of events) {
    const key = extractUploadedPhotoKey(event.image)
    if (key) keys.add(key)
  }
  return keys
}

// トップ写真データから参照されている R2 写真キーの集合を集めます。
export function collectHomePhotoKeys(homePhotos: Partial<Record<HomePhotoSlot, Photo>> | null | undefined): Set<string> {
  const keys = new Set<string>()
  if (!homePhotos) return keys
  for (const slot of homePhotoSlots) {
    const photo = homePhotos[slot]
    if (!photo) continue
    const key = extractUploadedPhotoKey(photo.image)
    if (key) keys.add(key)
  }
  return keys
}

function parseStoredAvailability(raw: string | null): Availability | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const rows = parseAvailabilityRows(record.rows)
    const updatedAt = record.updatedAt
    if (updatedAt !== null && (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)))) {
      return null
    }
    return { rows, updatedAt }
  } catch {
    return null
  }
}

function parseStoredEvents(raw: string | null): DynamicSiteContent["events"] {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parseEventsPayload(parsed)
  } catch {
    return null
  }
}

function parseStoredHomePhotos(raw: string | null): Partial<Record<HomePhotoSlot, Photo>> | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const result: Partial<Record<HomePhotoSlot, Photo>> = {}
    let count = 0

    for (const slot of homePhotoSlots) {
      const entry = record[slot]
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const photo = entry as Record<string, unknown>
      if (typeof photo.image !== "string" || typeof photo.imageAlt !== "string") continue
      const image = photo.image.trim()
      const imageAlt = photo.imageAlt.trim()
      if (!isManagedImagePath(image) || !imageAlt || imageAlt.length > MAX_IMAGE_ALT_LENGTH) continue
      result[slot] = { image, imageAlt }
      count += 1
    }

    return count > 0 ? result : null
  } catch {
    return null
  }
}

// クリーンアップ用に、反対側のトップ写真 KV から参照キーを厳密に読み取ります。
// 未保存（null）なら空集合、値があるのに壊れている・型不正な場合は誤削除防止のため null を返します。
function parseHomePhotosForCleanup(raw: string | null): Set<string> | null {
  if (raw === null) return new Set<string>()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const keys = new Set<string>()

    for (const [slot, entry] of Object.entries(record)) {
      if (!homePhotoSlots.includes(slot as HomePhotoSlot)) return null
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
      const photo = entry as Record<string, unknown>
      if (typeof photo.image !== "string" || typeof photo.imageAlt !== "string") return null
      const image = photo.image.trim()
      if (!isManagedImagePath(image)) return null
      const key = extractUploadedPhotoKey(image)
      if (key) keys.add(key)
    }

    return keys
  } catch {
    return null
  }
}

// クリーンアップ用に、反対側のイベント KV から参照キーを厳密に読み取ります。
// 未保存（null）なら空集合、値があるのに壊れている・型不正な場合は誤削除防止のため null を返します。
function parseEventsForCleanup(raw: string | null): Set<string> | null {
  if (raw === null) return new Set<string>()
  const parsed = parseStoredEvents(raw)
  if (parsed === null) return null
  return collectEventPhotoKeys(parsed)
}

// KV から空き状況・イベント・トップ写真の3つを並列で取得します。
// まだ保存されていない項目や壊れたデータは、画面が落ちないよう安全に null 扱いにします。
export async function readDynamicContent(env: Env): Promise<DynamicSiteContent> {
  const [availabilityRaw, eventsRaw, homePhotosRaw] = await Promise.all([
    env.SITE_KV.get(AVAILABILITY_KEY),
    env.SITE_KV.get(EVENTS_KEY),
    env.SITE_KV.get(HOME_PHOTOS_KEY),
  ])

  return {
    availability: parseStoredAvailability(availabilityRaw),
    events: parseStoredEvents(eventsRaw),
    homePhotos: parseStoredHomePhotos(homePhotosRaw),
  }
}

// 差し替えや削除で不要になった R2 の写真を後片付けします。
// - 更新した側の使用中キーは、KV の結果整合性の影響を受けないよう今回保存した確定データから算出します。
// - 反対側の KV は読み取り・検証に失敗した場合、誤削除を防ぐため何も削除せず安全に終了します。
export async function cleanupUnusedPhotos(
  env: Env,
  candidateKeys: Iterable<string>,
  updated: UpdatedPhotoReferences,
): Promise<void> {
  const uniqueCandidates = new Set<string>()
  for (const key of candidateKeys) {
    if (PHOTO_KEY_PATTERN.test(key)) {
      uniqueCandidates.add(key)
    }
  }
  if (uniqueCandidates.size === 0) return

  const referencedKeys = updated.kind === "events"
    ? collectEventPhotoKeys(updated.events)
    : collectHomePhotoKeys(updated.homePhotos)

  let otherKeys: Set<string> | null
  try {
    if (updated.kind === "events") {
      const homePhotosRaw = await env.SITE_KV.get(HOME_PHOTOS_KEY)
      otherKeys = parseHomePhotosForCleanup(homePhotosRaw)
    } else {
      const eventsRaw = await env.SITE_KV.get(EVENTS_KEY)
      otherKeys = parseEventsForCleanup(eventsRaw)
    }
  } catch {
    // 反対側の参照先を確認できないときは、誤削除を防ぐため何も消さずに終了します。
    return
  }

  // 反対側の KV に値が存在するにもかかわらずパース・検証に失敗した場合は、誤削除防止のため中止します。
  if (otherKeys === null) return

  for (const key of otherKeys) {
    referencedKeys.add(key)
  }

  for (const key of uniqueCandidates) {
    if (referencedKeys.has(key)) continue
    try {
      await env.SITE_PHOTOS.delete(key)
    } catch {
      // 削除に失敗しても、すでに保存した本体の応答は成功のまま返します。
    }
  }
}
