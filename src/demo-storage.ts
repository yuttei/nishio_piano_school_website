// ブラウザー専用。試作の編集画面で変えた内容を、このブラウザーの localStorage に保存します。
// 公開サイトのデータは変更しません。
// 既定値（何も保存していないときの表示）は、内容フォルダの data.json を
// 開発サーバーが仮想モジュール "virtual:site-content" として渡したものを使います。
import siteContent from "virtual:site-content"
import { DAYS, isContentImagePath, isStatus, type Availability, type HomePhotoSlot, type Photo, type SchoolEvent } from "./content.ts"

type EventDetails = Pick<SchoolEvent, "title" | "month" | "description">
type EventEdit = Partial<EventDetails> & Partial<Photo>

const { site, data } = siteContent

// 保存先のキー名は、内容フォルダごとに site.json の storageKeyPrefix で分けます。
const availabilityKey = `${site.storageKeyPrefix}-availability-v1`
const eventsKey = `${site.storageKeyPrefix}-events-v1`
const homePhotosKey = `${site.storageKeyPrefix}-home-photos-v1`
// 写真の差し替えで使っていたキーに、イベント本文の変更も保存します。
const eventEditsKey = `${site.storageKeyPrefix}-event-photos-v1`
const demoPhotoDataUrl = /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i

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
  if (!value || typeof value !== "object") return false
  return ["id", "title", "month", "description", "image", "imageAlt"].every(
    (field) => typeof (value as Record<string, unknown>)[field] === "string",
  )
}

export function readAvailability(): Availability {
  const value = readStoredValue(availabilityKey)
  return isAvailability(value) ? value : structuredClone(data.availability)
}

export function saveAvailability(availability: Availability): void {
  localStorage.setItem(availabilityKey, JSON.stringify(availability))
}

export function readAddedEvents(): SchoolEvent[] {
  const value = readStoredValue(eventsKey)
  return Array.isArray(value) ? value.filter(isSchoolEvent) : []
}

export function saveAddedEvents(events: SchoolEvent[]): void {
  localStorage.setItem(eventsKey, JSON.stringify(events))
}

function readSavedPhotos(key: string): Record<string, Photo> {
  const value = readStoredValue(key)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const photos = Object.entries(value).filter((entry): entry is [string, Photo] => {
    const photo: unknown = entry[1]
    return !!photo && typeof photo === "object" && "image" in photo && "imageAlt" in photo &&
      typeof photo.image === "string" && demoPhotoDataUrl.test(photo.image) &&
      typeof photo.imageAlt === "string"
  })
  return Object.fromEntries(photos)
}

export function readDemoHomePhotos(): Record<HomePhotoSlot, Photo> {
  const saved = readSavedPhotos(homePhotosKey)
  return { ...data.homePhotos, ...saved }
}

export function saveDemoHomePhoto(slot: HomePhotoSlot, photo: Photo): void {
  localStorage.setItem(homePhotosKey, JSON.stringify({ ...readSavedPhotos(homePhotosKey), [slot]: photo }))
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
    if (typeof image === "string" && (isContentImagePath(image) || demoPhotoDataUrl.test(image))) {
      edit.image = image
    }
    if (typeof imageAlt === "string") edit.imageAlt = imageAlt
    edits.set(id, edit)
  }
  return edits
}

export function readDemoEvents(): SchoolEvent[] {
  const edits = readSavedEventEdits()
  return [...readAddedEvents(), ...data.events].map((event) => ({ ...event, ...edits.get(event.id) }))
}

function saveDemoEventChanges(id: string, changes: EventEdit): void {
  const edits = readSavedEventEdits()
  // 変更した項目だけを上書きして、先に保存された本文や写真を残します。
  edits.set(id, { ...edits.get(id), ...changes })
  localStorage.setItem(eventEditsKey, JSON.stringify(Object.fromEntries(edits)))
}

export function saveDemoEventEdit(id: string, details: EventDetails, photo?: Photo | Pick<Photo, "imageAlt">): void {
  saveDemoEventChanges(id, { ...details, ...photo })
}

export function saveDemoEventPhoto(id: string, photo: Photo): void {
  saveDemoEventChanges(id, photo)
}
