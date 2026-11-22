// ブラウザー専用。開発サーバー（npm run dev）で編集した内容を、このブラウザーの localStorage に保存します。
// 公開サイト（Cloudflare KV / R2）のデータは変更しません。
// 既定値（何も保存していないときの表示）は、内容フォルダの data.json を
// Vite が仮想モジュール "virtual:site-content" として渡したものを使います。
import siteContent from "virtual:site-content"
import {
  DAYS,
  homePhotoSlots,
  isContentImagePath,
  isStatus,
  isUploadedPhotoPath,
  type Availability,
  type HomePhotoSlot,
  type Photo,
  type SchoolEvent,
} from "./content.ts"

type EventDetails = Pick<SchoolEvent, "title" | "month" | "description">
type EventEdit = Partial<EventDetails> & Partial<Photo>

const { site, data } = siteContent

// 保存先のキー名は、内容フォルダごとに site.json の storageKeyPrefix で分けます。
const availabilityKey = `${site.storageKeyPrefix}-availability-v1`
const eventsKey = `${site.storageKeyPrefix}-events-v1`
const eventListKey = `${site.storageKeyPrefix}-event-list-v1`
const homePhotosKey = `${site.storageKeyPrefix}-home-photos-v1`
// 以前の試作版で使っていたキー（互換性のため読み取り時に参照します）。
const eventEditsKey = `${site.storageKeyPrefix}-event-photos-v1`
const demoPhotoDataUrl = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i

function isAllowedDemoImage(url: string): boolean {
  return isContentImagePath(url) || isUploadedPhotoPath(url) || demoPhotoDataUrl.test(url)
}

function readStoredValue(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value === null ? null : JSON.parse(value)
  } catch {
    return null
  }
}

function isAvailability(value: unknown): value is Availability {
  if (!value || typeof value !== "object" || !("rows" in value) || !("updatedAt" in value)) return false
  if (!Array.isArray(value.rows) || value.rows.length !== site.timeSlots.length) return false

  return value.rows.every((row) => Array.isArray(row) && row.length === DAYS.length && row.every(isStatus)) &&
    (value.updatedAt === null || (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))))
}

function isSchoolEvent(value: unknown): value is SchoolEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!["id", "title", "month", "description", "image", "imageAlt"].every((field) => typeof record[field] === "string")) {
    return false
  }
  const image = record.image as string
  return image === "" || isAllowedDemoImage(image)
}

export function readAvailability(): Availability {
  const value = readStoredValue(availabilityKey)
  return isAvailability(value) ? value : structuredClone(data.availability)
}

export function saveAvailability(availability: Availability): void {
  localStorage.setItem(availabilityKey, JSON.stringify(availability))
}

function readAddedEvents(): SchoolEvent[] {
  const value = readStoredValue(eventsKey)
  return Array.isArray(value) ? value.filter(isSchoolEvent) : []
}

function readSavedPhotos(key: string): Partial<Record<HomePhotoSlot, Photo>> {
  const value = readStoredValue(key)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const record = value as Record<string, unknown>
  const photos: Partial<Record<HomePhotoSlot, Photo>> = {}
  for (const slot of homePhotoSlots) {
    const photo = record[slot]
    if (!photo || typeof photo !== "object" || Array.isArray(photo)) continue
    const item = photo as Record<string, unknown>
    if (typeof item.image === "string" && isAllowedDemoImage(item.image) && typeof item.imageAlt === "string") {
      photos[slot] = { image: item.image, imageAlt: item.imageAlt }
    }
  }
  return photos
}

export function readDemoHomePhotos(): Record<HomePhotoSlot, Photo> {
  const saved = readSavedPhotos(homePhotosKey)
  const result = {} as Record<HomePhotoSlot, Photo>
  for (const slot of homePhotoSlots) {
    result[slot] = saved[slot] ?? {
      image: data.homePhotos[slot].image,
      imageAlt: data.homePhotos[slot].imageAlt,
    }
  }
  return result
}

export function saveDemoHomePhotos(homePhotos: Record<HomePhotoSlot, Photo>): void {
  localStorage.setItem(homePhotosKey, JSON.stringify(homePhotos))
}

function readSavedEventEdits(): Map<string, EventEdit> {
  const edits = new Map<string, EventEdit>()
  const value = readStoredValue(eventEditsKey)
  if (!value || typeof value !== "object" || Array.isArray(value)) return edits

  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const { title, month, description, image, imageAlt }: Record<string, unknown> = entry
    const edit: EventEdit = {}
    if (typeof title === "string" && typeof month === "string" && typeof description === "string") {
      Object.assign(edit, { title, month, description })
    }
    if (typeof image === "string" && isAllowedDemoImage(image)) {
      edit.image = image
    }
    if (typeof imageAlt === "string") edit.imageAlt = imageAlt
    edits.set(id, edit)
  }
  return edits
}

export function readDemoEvents(): SchoolEvent[] {
  // 並び替えや削除を含む完全なイベント一覧が保存されていれば、それをそのまま使います。
  const savedList = readStoredValue(eventListKey)
  if (Array.isArray(savedList) && savedList.every(isSchoolEvent)) {
    return savedList.map((event) => ({ ...event }))
  }

  const edits = readSavedEventEdits()
  return [...readAddedEvents(), ...data.events].map((event) => ({ ...event, ...edits.get(event.id) }))
}

// 追加・編集・並び替え・削除の結果をまとめて localStorage に保存します。
export function saveDemoEvents(events: SchoolEvent[]): void {
  localStorage.setItem(eventListKey, JSON.stringify(events))
}
