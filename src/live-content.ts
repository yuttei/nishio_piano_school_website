// 本番ビルドされた公開ページで動き、Cloudflare KV に保存された最新の更新内容を表示へ反映します。
// 取得に失敗した場合やオフラインのときはエラーを出さず、ビルド済みの静的 HTML をそのまま表示します。
import siteContent from "virtual:site-content"
import {
  homePhotoSlots,
  isManagedImagePath,
  parseAvailabilityRows,
  parseEventsPayload,
  type Availability,
  type DynamicSiteContent,
  type HomePhotoSlot,
  type Photo,
} from "./content.ts"
import { homePhotoCaption, renderAvailability, renderEvents } from "./render.ts"

const { site, data } = siteContent

function isValidAvailability(value: unknown): value is Availability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  try {
    parseAvailabilityRows(record.rows, site.timeSlots.length)
  } catch {
    return false
  }
  const updatedAt = record.updatedAt
  return updatedAt === null || (typeof updatedAt === "string" && Number.isFinite(Date.parse(updatedAt)))
}

function isValidPhoto(value: unknown): value is Photo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.image === "string" && isManagedImagePath(record.image) &&
    typeof record.imageAlt === "string"
}

function applyDynamicContent(dynamic: DynamicSiteContent): void {
  const schedule = document.getElementById("availability-content")
  if (schedule && dynamic.availability && isValidAvailability(dynamic.availability)) {
    schedule.innerHTML = renderAvailability(dynamic.availability, site.timeSlots, null)
  }

  const eventsElement = document.getElementById("event-content")
  if (eventsElement && Array.isArray(dynamic.events)) {
    try {
      const validEvents = parseEventsPayload(dynamic.events)
      eventsElement.innerHTML = renderEvents(validEvents)
    } catch {
      // 不正なイベントデータの場合は静的 HTML の表示を維持します。
    }
  }

  if (dynamic.homePhotos && typeof dynamic.homePhotos === "object") {
    for (const slot of homePhotoSlots) {
      const photo = dynamic.homePhotos[slot as HomePhotoSlot]
      if (!isValidPhoto(photo)) continue
      const element = document.querySelector<HTMLImageElement>(`[data-home-photo="${slot}"]`)
      if (!element) continue
      element.src = photo.image
      element.alt = photo.imageAlt
      const caption = document.querySelector(`[data-home-photo-caption="${slot}"]`)
      if (caption) {
        caption.textContent = homePhotoCaption(photo, data.homePhotos[slot])
      }
    }
  }
}

async function refreshLiveContent(): Promise<void> {
  try {
    const response = await fetch("/api/content", { cache: "no-store" })
    if (!response.ok) return
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return
    applyDynamicContent(payload as DynamicSiteContent)
  } catch {
    // 通信失敗やオフライン時は静的 HTML のまま表示を続けます。
  }
}

// このページに動的差し替え対象（空き状況・イベント一覧・トップ写真）があるかどうかを調べます。
// 無料体験ページなど差し替え対象がないページでは、不要な API 通信を省略します。
function hasDynamicTarget(): boolean {
  return Boolean(
    document.getElementById("availability-content") ||
      document.getElementById("event-content") ||
      document.querySelector("[data-home-photo]"),
  )
}

if (hasDynamicTarget()) {
  void refreshLiveContent()

  // ブラウザーの「戻る」操作でキャッシュ復元されたときも最新データを取り直します。
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      void refreshLiveContent()
    }
  })
}
