// 管理画面の読み書きを統一するモジュールです。
// - 開発サーバー（npm run dev）では、ブラウザー内の localStorage（demo-storage.ts）に保存します。
// - 本番・wrangler pages dev では、Cloudflare Pages Functions の /api/admin/* と通信します。
import siteContent from "virtual:site-content"
import {
  homePhotoSlots,
  isManagedImagePath,
  isUploadedPhotoPath,
  parseAvailabilityRows,
  parseEventsPayload,
  parseHomePhotosPayload,
  type Availability,
  type DynamicSiteContent,
  type HomePhotoSlot,
  type Photo,
  type SchoolEvent,
  type Status,
} from "./content.ts"
import {
  readAvailability,
  readDemoEvents,
  readDemoHomePhotos,
  saveAvailability,
  saveDemoEvents,
  saveDemoHomePhotos,
} from "./demo-storage.ts"

const { site, data } = siteContent

export const isLocalDemoMode = import.meta.env.DEV

export interface AdminSiteState {
  availability: Availability
  events: SchoolEvent[]
  homePhotos: Record<HomePhotoSlot, Photo>
}

// ビルド時の data.json から、管理画面の初期表示に使う既定データを作ります。
function createDefaultHomePhotos(): Record<HomePhotoSlot, Photo> {
  const result = {} as Record<HomePhotoSlot, Photo>
  for (const slot of homePhotoSlots) {
    result[slot] = {
      image: data.homePhotos[slot].image,
      imageAlt: data.homePhotos[slot].imageAlt,
    }
  }
  return result
}

// Blob を data URL（data:image/jpeg;base64,...）に変換します（開発モードの localStorage 保存用）。
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error("写真を変換できませんでした。"))
      }
    })
    reader.addEventListener("error", () => reject(new Error("写真を読み込めませんでした。")))
    reader.readAsDataURL(blob)
  })
}

// HTTP ステータスごとに、管理画面の利用者へ分かりやすい日本語のエラーメッセージを返します。
function formatApiError(status: number, serverMessage: string): string {
  if (status === 401) {
    return "ログインの確認ができませんでした。ページを再読み込みして、もう一度ログインしてください。"
  }
  if (status === 403) {
    return "この操作は許可されていません。ページを再読み込みしてから、もう一度お試しください。"
  }
  if (status === 503) {
    return "現在、管理画面の認証設定が完了していないため利用できません。管理者にお問い合わせください。"
  }
  if (status === 400) {
    return serverMessage || "入力内容に誤りがあります。内容をご確認のうえ、もう一度お試しください。"
  }
  return serverMessage || "サーバーでエラーが発生しました。時間をおいてもう一度お試しください。"
}

// 管理 API へリクエストを送り、JSON レスポンスを返します。
async function requestAdminApi<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
    })
  } catch {
    throw new Error("通信に失敗しました。インターネット接続をご確認のうえ、もう一度お試しください。")
  }

  const body: unknown = await response.json().catch(() => null)
  const serverMessage =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).error === "string"
      ? (body as Record<string, unknown>).error as string
      : ""

  if (!response.ok) {
    throw new Error(formatApiError(response.status, serverMessage))
  }

  // 200 OK でも Cloudflare Access のセッション切れ等で HTML が返った場合は、分かりやすい日本語エラーにします。
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("サーバーからの応答を読み取れませんでした。ページを再読み込みしてログインし直してください。")
  }

  return body as T
}

function mergeHomePhotos(dynamicPhotos: DynamicSiteContent["homePhotos"]): Record<HomePhotoSlot, Photo> {
  const merged = createDefaultHomePhotos()
  if (!dynamicPhotos) return merged

  for (const slot of homePhotoSlots) {
    const photo = dynamicPhotos[slot]
    if (photo && typeof photo.image === "string" && isManagedImagePath(photo.image) && typeof photo.imageAlt === "string") {
      merged[slot] = { image: photo.image, imageAlt: photo.imageAlt }
    }
  }
  return merged
}

// 管理画面の初期表示に使う全データ（空き状況・イベント一覧・トップ写真）を読み込みます。
export async function loadAdminState(): Promise<AdminSiteState> {
  if (isLocalDemoMode) {
    return {
      availability: readAvailability(),
      events: readDemoEvents(),
      homePhotos: readDemoHomePhotos(),
    }
  }

  const dynamic = await requestAdminApi<DynamicSiteContent>("/api/admin/content", { method: "GET" })
  return {
    availability: dynamic.availability ?? structuredClone(data.availability),
    events: dynamic.events ?? structuredClone(data.events),
    homePhotos: mergeHomePhotos(dynamic.homePhotos),
  }
}

// 空き状況を保存します。
export async function saveAdminAvailability(rows: Status[][]): Promise<Availability> {
  const validRows = parseAvailabilityRows(rows, site.timeSlots.length)
  if (isLocalDemoMode) {
    const saved: Availability = { rows: validRows, updatedAt: new Date().toISOString() }
    try {
      saveAvailability(saved)
    } catch {
      throw new Error("保存できませんでした。ブラウザーの保存設定をご確認ください。")
    }
    return saved
  }

  return requestAdminApi<Availability>("/api/admin/availability", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: validRows }),
  })
}

// イベント一覧（追加・編集・並び替え・削除の結果）を保存します。
export async function saveAdminEvents(events: SchoolEvent[]): Promise<SchoolEvent[]> {
  if (isLocalDemoMode) {
    try {
      saveDemoEvents(events)
    } catch {
      throw new Error("保存できませんでした。写真のサイズやブラウザーの空き容量をご確認ください。")
    }
    return events.map((event) => ({ ...event }))
  }

  const validEvents = parseEventsPayload(events)
  const response = await requestAdminApi<{ events: SchoolEvent[] }>("/api/admin/events", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: validEvents }),
  })
  return response.events
}

// トップページの3枠の写真を保存します。
export async function saveAdminHomePhotos(homePhotos: Record<HomePhotoSlot, Photo>): Promise<Record<HomePhotoSlot, Photo>> {
  if (isLocalDemoMode) {
    try {
      saveDemoHomePhotos(homePhotos)
    } catch {
      throw new Error("保存できませんでした。写真のサイズやブラウザーの空き容量をご確認ください。")
    }
    return structuredClone(homePhotos)
  }

  const validHomePhotos = parseHomePhotosPayload(homePhotos)
  const response = await requestAdminApi<{ homePhotos: Record<HomePhotoSlot, Photo> }>("/api/admin/home-photos", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ homePhotos: validHomePhotos }),
  })
  return response.homePhotos
}

// リサイズ済みの写真 Blob をアップロードし、保存用の URL を返します。
// 本番は R2 の配信パス（/api/photos/<uuid>.jpg）、開発モードは data URL を返します。
export async function uploadAdminPhoto(blob: Blob, filename = "photo.jpg"): Promise<string> {
  if (isLocalDemoMode) {
    return blobToDataUrl(blob)
  }

  const formData = new FormData()
  formData.append("file", blob, filename)

  const response = await requestAdminApi<{ url?: unknown }>("/api/admin/photos", {
    method: "POST",
    body: formData,
  })
  if (typeof response.url !== "string" || !isUploadedPhotoPath(response.url)) {
    throw new Error("写真のアップロード結果が正しくありません。もう一度お試しください。")
  }
  return response.url
}
