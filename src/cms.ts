import { DAYS, homePhotoSlots, isStatus, type Availability, type HomePhotoSlot, type Photo, type SchoolEvent, type Status } from "./content.ts"

type JsonObject = Record<string, unknown>

function readString(object: JsonObject, key: string): string {
  return typeof object[key] === "string" ? object[key] : ""
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// fallbackPhotos は、microCMS に写真が設定されていない場所に使う写真（内容フォルダの data.json の値）です。
// timeSlots は空き状況の時間帯（site.json の値）で、1つ目が morning、2つ目が afternoon に対応します。
export async function loadCmsContent(
  domain: string,
  apiKey: string,
  homePhotosApi: string | undefined,
  fallbackPhotos: Record<HomePhotoSlot, Photo>,
  timeSlots: readonly [string, string],
): Promise<{
  availability: Availability
  events: SchoolEvent[]
  homePhotos: Record<HomePhotoSlot, Photo>
}> {
  if (!/^[a-z0-9-]+$/.test(domain)) throw new Error("MICROCMS_SERVICE_DOMAIN にはサービスIDを指定してください。")
  if (homePhotosApi && !/^[a-z0-9_-]+$/.test(homePhotosApi)) {
    throw new Error("MICROCMS_HOME_PHOTOS_API には写真設定のAPI IDを指定してください。")
  }

  // APIキーはビルド時だけ使います。ブラウザからmicroCMSへ直接アクセスする必要はありません。
  async function get(path: string): Promise<JsonObject> {
    const response = await fetch(`https://${domain}.microcms.io/api/v1/${path}`, {
      headers: { "X-MICROCMS-API-KEY": apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`microCMSのデータを取得できませんでした (${response.status})。`)
    const body: unknown = await response.json()
    if (!isObject(body)) throw new Error("microCMSのレスポンス形式を確認してください。")
    return body
  }

  async function getEvents(): Promise<SchoolEvent[]> {
    const result: SchoolEvent[] = []
    const pageSize = 100
    for (let offset = 0; ; offset += pageSize) {
      const page = await get(`events?limit=${pageSize}&offset=${offset}&orders=-publishedAt`)
      if (!Array.isArray(page.contents)) throw new Error("microCMSのイベント一覧を確認してください。")

      for (const item of page.contents) {
        if (!isObject(item)) throw new Error("microCMSのイベント記事を確認してください。")
        const title = readString(item, "title")
        if (!title || !readString(item, "description")) throw new Error("イベントの見出しと紹介文を入力してください。")
        const photo = item.image
        result.push({
          id: readString(item, "id"),
          title,
          month: readString(item, "month"),
          description: readString(item, "description"),
          image: isObject(photo) ? readString(photo, "url") : "",
          imageAlt: readString(item, "imageAlt") || title,
        })
      }

      if (page.contents.length < pageSize) return result
    }
  }

  async function getHomePhotos(): Promise<Record<HomePhotoSlot, Photo>> {
    const photos = { ...fallbackPhotos }
    if (!homePhotosApi) return photos

    const settings = await get(homePhotosApi)
    for (const slot of homePhotoSlots) {
      const image = settings[slot]
      const url = isObject(image) ? readString(image, "url") : ""
      // 写真が未設定の場所は、内容フォルダの写真を使います。
      if (url.startsWith("https://")) {
        photos[slot] = { image: url, imageAlt: readString(settings, `${slot}_alt`) }
      }
    }
    return photos
  }

  const [schedule, events, homePhotos] = await Promise.all([get("availability"), getEvents(), getHomePhotos()])
  const weekdayFields = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

  const rows = timeSlots.map((time, rowIndex) => DAYS.map((day, dayIndex): Status => {
    const field = `${weekdayFields[dayIndex]}_${rowIndex === 0 ? "morning" : "afternoon"}`
    const selection = schedule[field]
    const status: unknown = Array.isArray(selection) ? selection[0] : selection
    if (!isStatus(status)) throw new Error(`${day}曜日 ${time} の空き状況を確認してください。`)
    return status
  }))

  const lastModified = readString(schedule, "revisedAt") || readString(schedule, "updatedAt")
  const updatedAt = Number.isFinite(Date.parse(lastModified)) ? lastModified : null
  return { availability: { rows, updatedAt }, events, homePhotos }
}
