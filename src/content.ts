// Node（ビルド・開発サーバー）とブラウザーの両方から使う、型と共通の定義です。
// 教室ごとの文章や写真などのデータは、このファイルには持たせません。
// 実際のデータは非公開の内容フォルダ（既定は ../website_content）の
// site.json と data.json に書き、parseSiteInfo・parseSiteData で形を確かめてから使います。

export const DAYS = ["月", "火", "水", "木", "金", "土", "日"] as const
export const STATUSES = ["余裕あり", "残りわずか", "空きなし", "休み"] as const
export type Status = (typeof STATUSES)[number]

export interface Availability {
  rows: Status[][]
  updatedAt: string | null
}

export interface Photo {
  image: string
  imageAlt: string
}

export interface SchoolEvent extends Photo {
  id: string
  title: string
  month: string
  description: string
}

export const homePhotoSlots = ["piano", "stickers", "recital"] as const
export type HomePhotoSlot = (typeof homePhotoSlots)[number]

export const homePhotoLabels: Record<HomePhotoSlot, string> = {
  piano: "トップのピアノ写真",
  stickers: "教室紹介の写真",
  recital: "トップのイベント紹介写真",
}

export const pageIds = ["home", "lessons", "events", "trial"] as const
export type PageId = (typeof pageIds)[number]

// 各ページの <title> と <meta name="description"> に入れる文章です。
export interface PageMeta {
  title: string
  description: string
}

// 外部サイトへのリンクです。空文字のときは、そのリンクや地図を表示しません。
export interface SiteLinks {
  line: string
  instagram: string
  blog: string
  map: string
  mapEmbed: string
}

// site.json の中身です。
export interface SiteInfo {
  formatVersion: 1
  storageKeyPrefix: string
  notice: string
  area: string
  availabilityDemoNote: string
  // 空き状況の時間帯（午前・午後の2つ）。microCMS の morning・afternoon に対応します。
  timeSlots: [string, string]
  links: SiteLinks
  pages: Record<PageId, PageMeta>
}

// トップの写真の既定値です。caption は既定の写真のとき、replacedCaption は差し替えたときの説明文です。
export interface HomePhotoDefault extends Photo {
  caption: string
  replacedCaption: string
}

// data.json の中身です。
export interface SiteData {
  homePhotos: Record<HomePhotoSlot, HomePhotoDefault>
  availability: Availability
  events: SchoolEvent[]
}

export interface SiteContent {
  site: SiteInfo
  data: SiteData
}

// Cloudflare Pages Functions（KV）から公開ページ・管理画面へ渡す動的データです。
// KV にまだ保存されていない項目は null になり、静的データ（data.json）の既定値を使います。
export interface DynamicSiteContent {
  availability: Availability | null
  events: SchoolEvent[] | null
  homePhotos: Partial<Record<HomePhotoSlot, Photo>> | null
}

// イベント一覧・各項目の入力上限です。フロントと API の両方で同じ値を使います。
export const MAX_EVENTS_COUNT = 200
export const MAX_EVENT_ID_LENGTH = 80
export const MAX_EVENT_TITLE_LENGTH = 120
export const MAX_EVENT_DESCRIPTION_LENGTH = 2000
export const MAX_IMAGE_ALT_LENGTH = 200

export function isStatus(value: unknown): value is Status {
  return STATUSES.some((status) => status === value)
}

// 内容フォルダの images/ にある写真のパス（/images/名前）かどうかを調べます。
export function isContentImagePath(value: string): boolean {
  return /^\/images\/[a-z0-9.-]+$/i.test(value)
}

// 管理画面から R2 にアップロードされた写真のパス（/api/photos/ID.拡張子）かどうかを調べます。
export function isUploadedPhotoPath(value: string): boolean {
  return /^\/api\/photos\/[a-z0-9-]+\.(jpg|webp|png)$/.test(value)
}

// サイトで管理している写真パス（内容フォルダの写真またはアップロード写真）かどうかを調べます。
export function isManagedImagePath(value: string): boolean {
  return isContentImagePath(value) || isUploadedPhotoPath(value)
}

// ここから下は、JSON の形を確かめる処理です。
// 間違いがあれば「どのファイルのどの項目か」を日本語でエラーにします。

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function fail(file: string, path: string, message: string): never {
  throw new Error(`${file} の ${path} ${message}`)
}

function readObject(value: unknown, file: string, path: string): JsonObject {
  if (!isObject(value)) fail(file, path, "はオブジェクト（{ }）にしてください。")
  return value
}

function readText(object: JsonObject, key: string, file: string, path: string): string {
  const value = object[key]
  if (typeof value !== "string") fail(file, `${path}.${key}`.replace(/^\./, ""), "は文字列にしてください。")
  return value
}

function readRequiredText(object: JsonObject, key: string, file: string, path: string): string {
  const value = readText(object, key, file, path)
  if (!value.trim()) fail(file, `${path}.${key}`.replace(/^\./, ""), "を空にしないでください。")
  return value
}

export function parseSiteInfo(value: unknown, file: string): SiteInfo {
  const site = readObject(value, file, "全体")
  if (site.formatVersion !== 1) fail(file, "formatVersion", "は 1 にしてください（この版のサイトが読める形式は 1 です）。")

  const storageKeyPrefix = readRequiredText(site, "storageKeyPrefix", file, "")
  if (!/^[a-z0-9-]+$/.test(storageKeyPrefix)) fail(file, "storageKeyPrefix", "は小文字の英字・数字・- だけにしてください。")

  const timeSlots = site.timeSlots
  if (!Array.isArray(timeSlots) || timeSlots.length !== 2 || !timeSlots.every((slot) => typeof slot === "string" && slot.trim())) {
    fail(file, "timeSlots", "は空でない文字列2つの配列にしてください（例：[\"午前の時間帯\", \"午後の時間帯\"]）。")
  }

  const linkObject = readObject(site.links, file, "links")
  const links: SiteLinks = { line: "", instagram: "", blog: "", map: "", mapEmbed: "" }
  for (const key of Object.keys(links) as (keyof SiteLinks)[]) {
    const url = readText(linkObject, key, file, "links")
    if (url && !url.startsWith("https://")) fail(file, `links.${key}`, "は https:// で始まるURLか、空文字にしてください。")
    links[key] = url
  }

  const pageObject = readObject(site.pages, file, "pages")
  const pages = {} as Record<PageId, PageMeta>
  for (const id of pageIds) {
    const page = readObject(pageObject[id], file, `pages.${id}`)
    pages[id] = {
      title: readRequiredText(page, "title", file, `pages.${id}`),
      description: readRequiredText(page, "description", file, `pages.${id}`),
    }
  }

  return {
    formatVersion: 1,
    storageKeyPrefix,
    notice: readText(site, "notice", file, ""),
    area: readRequiredText(site, "area", file, ""),
    availabilityDemoNote: readText(site, "availabilityDemoNote", file, ""),
    timeSlots: [timeSlots[0], timeSlots[1]],
    links,
    pages,
  }
}

function readPhotoPath(object: JsonObject, file: string, path: string, allowEmpty: boolean): string {
  const image = readText(object, "image", file, path)
  if (allowEmpty && image === "") return image
  if (!isContentImagePath(image)) {
    fail(file, `${path}.image`, `は「/images/名前」の形にしてください${allowEmpty ? "（写真がなければ空文字）" : ""}。`)
  }
  return image
}

// timeSlots は site.json の時間帯です。空き状況の行の数を、時間帯の数と比べます。
export function parseSiteData(value: unknown, file: string, timeSlots: readonly string[]): SiteData {
  const data = readObject(value, file, "全体")

  const photoObject = readObject(data.homePhotos, file, "homePhotos")
  const homePhotos = {} as Record<HomePhotoSlot, HomePhotoDefault>
  for (const slot of homePhotoSlots) {
    const path = `homePhotos.${slot}`
    const photo = readObject(photoObject[slot], file, path)
    homePhotos[slot] = {
      image: readPhotoPath(photo, file, path, false),
      imageAlt: readRequiredText(photo, "imageAlt", file, path),
      caption: readText(photo, "caption", file, path),
      replacedCaption: readText(photo, "replacedCaption", file, path),
    }
  }

  const availabilityObject = readObject(data.availability, file, "availability")
  const rows = availabilityObject.rows
  if (!Array.isArray(rows) || rows.length !== timeSlots.length) {
    fail(file, "availability.rows", `は時間帯の数（${timeSlots.length}行）の配列にしてください。`)
  }
  rows.forEach((row: unknown, rowIndex) => {
    if (!Array.isArray(row) || row.length !== DAYS.length || !row.every(isStatus)) {
      fail(file, `availability.rows[${rowIndex}]`, `は7曜日分の「${STATUSES.join("」「")}」のどれかにしてください。`)
    }
  })
  const updatedAt = availabilityObject.updatedAt
  if (updatedAt !== null && (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)))) {
    fail(file, "availability.updatedAt", "は null か、日時の文字列にしてください。")
  }

  if (!Array.isArray(data.events)) fail(file, "events", "は配列（[ ]）にしてください。")
  const ids = new Set<string>()
  const events = data.events.map((value: unknown, index): SchoolEvent => {
    const path = `events[${index}]`
    const event = readObject(value, file, path)
    const id = readRequiredText(event, "id", file, path)
    if (ids.has(id)) fail(file, `${path}.id`, `の「${id}」がほかのイベントと重なっています。`)
    ids.add(id)
    const month = readText(event, "month", file, path)
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(file, `${path}.month`, "は「2026-11」の形か、空文字にしてください。")
    return {
      id,
      title: readRequiredText(event, "title", file, path),
      month,
      description: readRequiredText(event, "description", file, path),
      image: readPhotoPath(event, file, path, true),
      imageAlt: readText(event, "imageAlt", file, path),
    }
  })

  return {
    homePhotos,
    availability: { rows: rows as Status[][], updatedAt: updatedAt as string | null },
    events,
  }
}

// ここから下は、管理画面と Cloudflare Pages Functions で共有する入力チェックです。
// 不正なデータが来たときは、原因が分かる日本語のエラーを投げます。

// 空き状況の表（時間帯 × 7曜日）の配列を検証して返します。
export function parseAvailabilityRows(value: unknown, expectedRows = 2): Status[][] {
  if (!Array.isArray(value) || value.length !== expectedRows) {
    throw new Error(`空き状況は時間帯の数（${expectedRows}行）の配列にしてください。`)
  }

  const parsedRows: Status[][] = []
  for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
    const row = value[rowIndex]
    if (!Array.isArray(row) || row.length !== DAYS.length || !row.every(isStatus)) {
      throw new Error(`空き状況の ${rowIndex + 1} 行目は、7曜日分の「${STATUSES.join("」「")}」のどれかにしてください。`)
    }
    parsedRows.push([...row])
  }
  return parsedRows
}

// イベント一覧の配列を検証して返します。
export function parseEventsPayload(value: unknown): SchoolEvent[] {
  if (!Array.isArray(value)) {
    throw new Error("イベント一覧は配列にしてください。")
  }
  if (value.length > MAX_EVENTS_COUNT) {
    throw new Error(`イベントは最大 ${MAX_EVENTS_COUNT} 件まで登録できます。`)
  }

  const ids = new Set<string>()
  const parsedEvents: SchoolEvent[] = []

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    const label = `${index + 1}件目のイベント`
    if (!isObject(item)) {
      throw new Error(`${label}はオブジェクトにしてください。`)
    }

    if (typeof item.id !== "string") {
      throw new Error(`${label}のIDは文字列にしてください。`)
    }
    const id = item.id.trim()
    if (!id) {
      throw new Error(`${label}のIDを空にしないでください。`)
    }
    if (id.length > MAX_EVENT_ID_LENGTH) {
      throw new Error(`${label}のIDは ${MAX_EVENT_ID_LENGTH} 文字以内にしてください。`)
    }
    if (ids.has(id)) {
      throw new Error(`イベントID「${id}」が重複しています。`)
    }
    ids.add(id)

    if (typeof item.title !== "string") {
      throw new Error(`${label}の見出しは文字列にしてください。`)
    }
    const title = item.title.trim()
    if (!title) {
      throw new Error(`${label}の見出しを入力してください。`)
    }
    if (title.length > MAX_EVENT_TITLE_LENGTH) {
      throw new Error(`${label}の見出しは ${MAX_EVENT_TITLE_LENGTH} 文字以内にしてください。`)
    }

    if (typeof item.month !== "string") {
      throw new Error(`${label}の開催年月は文字列にしてください。`)
    }
    const month = item.month.trim()
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error(`${label}の開催年月は「2026-11」の形か、空文字にしてください。`)
    }

    if (typeof item.description !== "string") {
      throw new Error(`${label}の紹介文は文字列にしてください。`)
    }
    const description = item.description.trim()
    if (!description) {
      throw new Error(`${label}の紹介文を入力してください。`)
    }
    if (description.length > MAX_EVENT_DESCRIPTION_LENGTH) {
      throw new Error(`${label}の紹介文は ${MAX_EVENT_DESCRIPTION_LENGTH} 文字以内にしてください。`)
    }

    if (typeof item.image !== "string") {
      throw new Error(`${label}の写真パスは文字列にしてください。`)
    }
    const image = item.image.trim()
    if (image && !isManagedImagePath(image)) {
      throw new Error(`${label}の写真パスが正しくありません。`)
    }

    if (typeof item.imageAlt !== "string") {
      throw new Error(`${label}の写真の説明は文字列にしてください。`)
    }
    const imageAlt = item.imageAlt.trim()
    if (imageAlt.length > MAX_IMAGE_ALT_LENGTH) {
      throw new Error(`${label}の写真の説明は ${MAX_IMAGE_ALT_LENGTH} 文字以内にしてください。`)
    }

    parsedEvents.push({ id, title, month, description, image, imageAlt })
  }

  return parsedEvents
}

// トップページの3枠の写真（piano・stickers・recital）を検証して返します。
export function parseHomePhotosPayload(value: unknown): Record<HomePhotoSlot, Photo> {
  if (!isObject(value)) {
    throw new Error("トップページの写真はオブジェクトにしてください。")
  }

  const parsed = {} as Record<HomePhotoSlot, Photo>
  for (const slot of homePhotoSlots) {
    const label = homePhotoLabels[slot]
    const item = value[slot]
    if (!isObject(item)) {
      throw new Error(`${label}（${slot}）のデータがありません。`)
    }

    if (typeof item.image !== "string") {
      throw new Error(`${label}の写真パスは文字列にしてください。`)
    }
    const image = item.image.trim()
    if (!isManagedImagePath(image)) {
      throw new Error(`${label}の写真パスが正しくありません。`)
    }

    if (typeof item.imageAlt !== "string") {
      throw new Error(`${label}の写真の説明は文字列にしてください。`)
    }
    const imageAlt = item.imageAlt.trim()
    if (!imageAlt) {
      throw new Error(`${label}の写真の説明を入力してください。`)
    }
    if (imageAlt.length > MAX_IMAGE_ALT_LENGTH) {
      throw new Error(`${label}の写真の説明は ${MAX_IMAGE_ALT_LENGTH} 文字以内にしてください。`)
    }

    parsed[slot] = { image, imageAlt }
  }

  return parsed
}
