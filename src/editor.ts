// 管理画面（/admin/）の操作をまとめて制御します。
// 空き状況の更新、イベントの追加・編集・削除・並び替え、トップ写真とイベント写真の差し替えを行います。
import siteContent from "virtual:site-content"
import {
  DAYS,
  STATUSES,
  homePhotoLabels,
  homePhotoSlots,
  type Photo,
  type SchoolEvent,
  type Status,
} from "./content.ts"
import {
  isLocalDemoMode,
  loadAdminState,
  saveAdminAvailability,
  saveAdminEvents,
  saveAdminHomePhotos,
  uploadAdminPhoto,
  type AdminSiteState,
} from "./content-store.ts"

// 空き状況の時間帯（午前・午後）は、内容フォルダの site.json から受け取ります。
const TIME_SLOTS = siteContent.site.timeSlots

// アップロード前に縮小するときの長辺の上限（ピクセル）と JPEG 品質です。
const MAX_PHOTO_SIDE = 1200
const PHOTO_JPEG_QUALITY = 0.82

function showResult(element: HTMLElement, message: string, isError = false): void {
  element.toggleAttribute("data-error", isError)
  element.textContent = message
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// 選んだ画像ファイルをブラウザー上で縮小し、JPEG の Blob に変換します。
async function resizePhotoToBlob(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const photo = new Image()
    photo.src = objectUrl
    await photo.decode()

    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(photo.naturalWidth, photo.naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale))
    const drawing = canvas.getContext("2d")
    if (!drawing) throw new Error("写真を変換できませんでした。")

    // 透明な PNG を JPEG にしても黒くならないよう、白で塗りつぶしてから描きます。
    drawing.fillStyle = "white"
    drawing.fillRect(0, 0, canvas.width, canvas.height)
    drawing.drawImage(photo, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error("写真を変換できませんでした。"))
          }
        },
        "image/jpeg",
        PHOTO_JPEG_QUALITY,
      )
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function setupPhotoPreview(photoInput: HTMLInputElement, photoPreview: HTMLImageElement): () => void {
  let previewUrl: string | undefined
  const clearPreview = (): void => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = undefined
    photoPreview.hidden = true
    photoPreview.removeAttribute("src")
  }

  photoInput.addEventListener("change", () => {
    clearPreview()
    const file = photoInput.files?.[0]
    if (!file) return

    previewUrl = URL.createObjectURL(file)
    photoPreview.src = previewUrl
  })

  photoPreview.addEventListener("load", () => {
    photoPreview.hidden = false
  })
  photoPreview.addEventListener("error", clearPreview)

  return clearPreview
}

function showSavedPhoto(image: HTMLImageElement, empty: HTMLElement, photo?: Photo): void {
  image.hidden = !photo?.image
  empty.hidden = !photo?.image ? false : true
  if (photo?.image) {
    image.src = photo.image
    image.alt = photo.imageAlt
  } else {
    image.removeAttribute("src")
  }
}

// イベント写真の説明（代替テキスト）を決めます。
// 入力欄の値をそのまま使い、空なら「見出し＋の写真」で補います。
function eventPhotoAlt(imageAlt: string, title: string): string {
  return imageAlt || `${title}の写真`
}

function formatMonthLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return ""
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`
}

function setupAvailabilityEditor(state: AdminSiteState): void {
  const form = document.querySelector<HTMLFormElement>("#availability-editor")
  const fields = document.querySelector<HTMLElement>("#availability-fields")
  const result = document.querySelector<HTMLElement>("#availability-status")
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!form || !fields || !result || !button) return

  const selects: HTMLSelectElement[] = []

  // 画面は曜日ごとに並べ、保存データは時間帯ごとの行にまとめます。
  DAYS.forEach((day, dayIndex) => {
    const group = document.createElement("fieldset")
    group.className = "editor-day"
    const heading = document.createElement("legend")
    heading.textContent = `${day}曜日`
    group.append(heading)

    TIME_SLOTS.forEach((time, timeIndex) => {
      const label = document.createElement("label")
      label.textContent = time

      const select = document.createElement("select")
      select.name = `slot-${timeIndex}-${dayIndex}`
      for (const status of STATUSES) {
        select.add(new Option(status, status))
      }
      select.value = state.availability.rows[timeIndex][dayIndex]
      selects.push(select)
      label.append(select)
      group.append(label)
    })

    fields.append(group)
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (button.disabled) return

    const formData = new FormData(form)
    const rows: Status[][] = []

    for (const timeIndex of TIME_SLOTS.keys()) {
      const row: Status[] = []
      for (const dayIndex of DAYS.keys()) {
        const value = formData.get(`slot-${timeIndex}-${dayIndex}`)
        const status = STATUSES.find((option) => option === value)
        if (!status) {
          showResult(result, "すべての時間帯の空き状況を選んでください。", true)
          return
        }
        row.push(status)
      }
      rows.push(row)
    }

    const controls: (HTMLSelectElement | HTMLButtonElement)[] = [...selects, button]
    controls.forEach((control) => { control.disabled = true })
    showResult(result, "保存しています...")

    try {
      state.availability = await saveAdminAvailability(rows)
      showResult(result, "空き状況を保存しました。")
    } catch (error) {
      showResult(result, getErrorMessage(error, "空き状況を保存できませんでした。"), true)
    } finally {
      controls.forEach((control) => { control.disabled = false })
    }
  })
}

interface PhotoTarget {
  photo: Photo
  reviewUrl: string
  reviewLabel: string
  save: (photo: Photo) => Promise<void>
}

function setupPhotoEditor(state: AdminSiteState, onEventsChanged: () => void): () => void {
  const form = document.querySelector<HTMLFormElement>("#photo-editor")
  const targetInput = document.querySelector<HTMLSelectElement>("#replacement-target")
  const currentField = document.querySelector<HTMLElement>("#replacement-current")
  const currentPreview = document.querySelector<HTMLImageElement>("#replacement-current-photo")
  const noPhoto = document.querySelector<HTMLElement>("#replacement-no-photo")
  const photoInput = document.querySelector<HTMLInputElement>("#replacement-photo")
  const photoPreview = document.querySelector<HTMLImageElement>("#replacement-photo-preview")
  const altInput = document.querySelector<HTMLInputElement>("#replacement-alt")
  const review = document.querySelector<HTMLAnchorElement>("#replacement-review")
  const result = document.querySelector<HTMLElement>("#replacement-status")
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!form || !targetInput || !currentField || !currentPreview || !noPhoto || !photoInput || !photoPreview || !altInput || !review || !result || !button) {
    return () => {}
  }

  const targets = new Map<string, PhotoTarget>()
  const clearPreview = setupPhotoPreview(photoInput, photoPreview)

  const showCurrentPhoto = (syncAlt: boolean): void => {
    const target = targets.get(targetInput.value)
    currentField.hidden = !target
    showSavedPhoto(currentPreview, noPhoto, target?.photo)
    if (syncAlt) altInput.value = target?.photo.imageAlt ?? ""
    review.hidden = !target
    if (target) {
      review.href = target.reviewUrl
      review.textContent = target.reviewLabel
    }
  }

  const refreshTargets = (): void => {
    const selected = targetInput.value
    const savedAlt = targets.get(selected)?.photo.imageAlt ?? ""
    const homeGroup = document.createElement("optgroup")
    const eventGroup = document.createElement("optgroup")
    homeGroup.label = "トップページ"
    eventGroup.label = "イベント"
    targets.clear()

    for (const slot of homePhotoSlots) {
      const key = `home:${slot}`
      homeGroup.append(new Option(homePhotoLabels[slot], key))
      targets.set(key, {
        photo: state.homePhotos[slot],
        reviewUrl: "/",
        reviewLabel: "トップページを確認",
        save: async (photo) => {
          const nextHomePhotos = {
            ...state.homePhotos,
            [slot]: photo,
          }
          state.homePhotos = await saveAdminHomePhotos(nextHomePhotos)
        },
      })
    }

    for (const item of state.events) {
      const key = `event:${item.id}`
      eventGroup.append(new Option(item.title, key))
      targets.set(key, {
        photo: item,
        reviewUrl: "/events/",
        reviewLabel: "イベントを確認",
        save: async (photo) => {
          const nextEvents = state.events.map((existing) =>
            existing.id === item.id ? { ...existing, image: photo.image, imageAlt: photo.imageAlt } : existing,
          )
          state.events = await saveAdminEvents(nextEvents)
          onEventsChanged()
        },
      })
    }

    const placeholder = new Option("差し替える場所を選択", "")
    placeholder.disabled = true
    targetInput.replaceChildren(placeholder, homeGroup, eventGroup)
    targetInput.value = targets.has(selected) ? selected : ""
    showCurrentPhoto(altInput.value === savedAlt)
  }

  refreshTargets()
  targetInput.addEventListener("change", () => {
    photoInput.value = ""
    clearPreview()
    showCurrentPhoto(true)
    showResult(result, "")
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (button.disabled) return

    const targetKey = targetInput.value
    const target = targets.get(targetKey)
    const file = photoInput.files?.[0]
    const imageAlt = altInput.value.trim()
    if (!target || !file || !imageAlt) {
      showResult(result, "差し替える場所と新しい写真を選び、写真の説明を入力してください。", true)
      return
    }

    const controls = [targetInput, photoInput, altInput, button]
    controls.forEach((control) => { control.disabled = true })
    showResult(result, "写真を保存しています...")

    try {
      let blob: Blob
      try {
        blob = await resizePhotoToBlob(file)
      } catch {
        showResult(result, "写真を読み込めませんでした。JPEGやPNGの写真をお試しください。", true)
        return
      }

      const image = await uploadAdminPhoto(blob)
      await target.save({ image, imageAlt })

      photoInput.value = ""
      clearPreview()
      refreshTargets()
      showCurrentPhoto(true)
      showResult(result, "写真を差し替えました。")
    } catch (error) {
      showResult(result, getErrorMessage(error, "写真を差し替えできませんでした。"), true)
    } finally {
      controls.forEach((control) => { control.disabled = false })
    }
  })

  return refreshTargets
}

function setupEventReorder(state: AdminSiteState, onOrderSaved: () => void): () => void {
  const listElement = document.querySelector<HTMLOListElement>("#event-order-list")
  const emptyElement = document.querySelector<HTMLElement>("#event-order-empty")
  const saveButton = document.querySelector<HTMLButtonElement>("#event-order-save")
  const result = document.querySelector<HTMLElement>("#event-order-status")
  if (!listElement || !emptyElement || !saveButton || !result) {
    return () => {}
  }

  let draftIds: string[] = []
  let isSaving = false

  const renderList = (): void => {
    const eventsById = new Map(state.events.map((event) => [event.id, event]))
    const orderedEvents: SchoolEvent[] = []
    for (const id of draftIds) {
      const found = eventsById.get(id)
      if (found) orderedEvents.push(found)
    }

    listElement.replaceChildren()
    const hasEvents = orderedEvents.length > 0
    listElement.hidden = !hasEvents
    emptyElement.hidden = hasEvents
    saveButton.disabled = isSaving || orderedEvents.length <= 1

    orderedEvents.forEach((item, index) => {
      const li = document.createElement("li")
      li.className = "editor-order-item"

      const info = document.createElement("div")
      info.className = "editor-order-info"

      const title = document.createElement("span")
      title.className = "editor-order-title"
      title.textContent = `${index + 1}. ${item.title}`
      info.append(title)

      const monthLabel = formatMonthLabel(item.month)
      if (monthLabel) {
        const meta = document.createElement("span")
        meta.className = "editor-order-meta"
        meta.textContent = monthLabel
        info.append(meta)
      }

      const controls = document.createElement("div")
      controls.className = "editor-order-controls"

      const upButton = document.createElement("button")
      upButton.type = "button"
      upButton.className = "editor-order-button"
      upButton.textContent = "↑ 上へ"
      upButton.setAttribute("aria-label", `${item.title}を1つ上へ移動`)
      upButton.disabled = isSaving || index === 0
      upButton.addEventListener("click", () => {
        if (index === 0 || isSaving) return
        const nextIds = [...draftIds]
        ;[nextIds[index - 1], nextIds[index]] = [nextIds[index], nextIds[index - 1]]
        draftIds = nextIds
        renderList()
        showResult(result, "順番を変更しました。「並び順を保存」を押すと反映されます。")
      })

      const downButton = document.createElement("button")
      downButton.type = "button"
      downButton.className = "editor-order-button"
      downButton.textContent = "↓ 下へ"
      downButton.setAttribute("aria-label", `${item.title}を1つ下へ移動`)
      downButton.disabled = isSaving || index === orderedEvents.length - 1
      downButton.addEventListener("click", () => {
        if (index >= orderedEvents.length - 1 || isSaving) return
        const nextIds = [...draftIds]
        ;[nextIds[index], nextIds[index + 1]] = [nextIds[index + 1], nextIds[index]]
        draftIds = nextIds
        renderList()
        showResult(result, "順番を変更しました。「並び順を保存」を押すと反映されます。")
      })

      controls.append(upButton, downButton)
      li.append(info, controls)
      listElement.append(li)
    })
  }

  const syncFromState = (): void => {
    draftIds = state.events.map((event) => event.id)
    renderList()
  }

  syncFromState()

  saveButton.addEventListener("click", async () => {
    if (isSaving || draftIds.length <= 1) return

    const eventsById = new Map(state.events.map((event) => [event.id, event]))
    const orderedEvents: SchoolEvent[] = []
    for (const id of draftIds) {
      const found = eventsById.get(id)
      if (found) orderedEvents.push(found)
    }

    isSaving = true
    renderList()
    showResult(result, "並び順を保存しています...")

    try {
      state.events = await saveAdminEvents(orderedEvents)
      draftIds = state.events.map((event) => event.id)
      onOrderSaved()
      showResult(result, "イベントの並び順を保存しました。")
    } catch (error) {
      showResult(result, getErrorMessage(error, "並び順を保存できませんでした。"), true)
    } finally {
      isSaving = false
      renderList()
    }
  })

  return syncFromState
}

function setupEventEditor(state: AdminSiteState, onEventsChanged: () => void): () => void {
  const form = document.querySelector<HTMLFormElement>("#event-editor")
  const targetInput = document.querySelector<HTMLSelectElement>("#event-target")
  const titleInput = document.querySelector<HTMLInputElement>("#event-title")
  const monthInput = document.querySelector<HTMLInputElement>("#event-month")
  const descriptionInput = document.querySelector<HTMLTextAreaElement>("#event-description")
  const currentField = document.querySelector<HTMLElement>("#event-current")
  const currentPreview = document.querySelector<HTMLImageElement>("#event-current-photo")
  const noPhoto = document.querySelector<HTMLElement>("#event-no-photo")
  const photoInput = document.querySelector<HTMLInputElement>("#event-photo")
  const photoPreview = document.querySelector<HTMLImageElement>("#event-photo-preview")
  const altInput = document.querySelector<HTMLInputElement>("#event-photo-alt")
  const deleteButton = document.querySelector<HTMLButtonElement>("#event-delete")
  const result = document.querySelector<HTMLElement>("#event-status")
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (
    !form || !targetInput || !titleInput || !monthInput || !descriptionInput ||
    !currentField || !currentPreview || !noPhoto || !photoInput || !photoPreview ||
    !altInput || !deleteButton || !result || !submitButton
  ) {
    return () => {}
  }

  const clearPreview = setupPhotoPreview(photoInput, photoPreview)
  let isBusy = false

  const findSelectedEvent = (): SchoolEvent | undefined =>
    state.events.find((event) => event.id === targetInput.value)

  // 写真がないときは説明欄を入力できないようにして、使い道のない入力を防ぎます。
  const updateAltInput = (): void => {
    if (isBusy) return
    const hasPhoto = !!photoInput.files?.[0] || !!findSelectedEvent()?.image
    altInput.disabled = !hasPhoto
    altInput.placeholder = hasPhoto ? "空欄なら「（見出し）の写真」になります" : "写真があるときに入力できます"
  }

  const updateDeleteButton = (current?: SchoolEvent): void => {
    deleteButton.hidden = !current
    deleteButton.disabled = isBusy || !current
  }

  const showCurrentPhoto = (current?: SchoolEvent): void => {
    currentField.hidden = !current
    showSavedPhoto(currentPreview, noPhoto, current)
    updateDeleteButton(current)
    updateAltInput()
  }

  const setFormBusy = (busy: boolean): void => {
    isBusy = busy
    const controls = [targetInput, titleInput, monthInput, descriptionInput, photoInput, altInput, submitButton, deleteButton]
    controls.forEach((control) => { control.disabled = busy })
    if (!busy) {
      updateDeleteButton(findSelectedEvent())
      updateAltInput()
    }
  }

  const refreshTargets = (): void => {
    const selected = targetInput.value
    const savedAlt = findSelectedEvent()?.imageAlt ?? ""
    targetInput.replaceChildren(
      new Option("新しいイベントを追加", ""),
      ...state.events.map((event) => new Option(event.title, event.id)),
    )
    targetInput.value = state.events.some((event) => event.id === selected) ? selected : ""
    const current = findSelectedEvent()
    showCurrentPhoto(current)
    if (!photoInput.files?.[0] && altInput.value === savedAlt) {
      altInput.value = current?.imageAlt ?? ""
    }
  }

  const loadSelectedEvent = (): void => {
    const current = findSelectedEvent()
    titleInput.value = current?.title ?? ""
    monthInput.value = current?.month ?? ""
    descriptionInput.value = current?.description ?? ""
    altInput.value = current?.imageAlt ?? ""
    photoInput.value = ""
    clearPreview()
    showCurrentPhoto(current)
  }

  refreshTargets()
  loadSelectedEvent()

  targetInput.addEventListener("change", () => {
    loadSelectedEvent()
    showResult(result, "")
  })

  photoInput.addEventListener("change", () => {
    altInput.value = photoInput.files?.[0] ? "" : findSelectedEvent()?.imageAlt ?? ""
    updateAltInput()
  })

  // 既存イベントの削除処理です。誤操作を防ぐため確認ダイアログを出します。
  deleteButton.addEventListener("click", async () => {
    if (isBusy) return
    const current = findSelectedEvent()
    if (!current) return

    const confirmed = window.confirm(`「${current.title}」を削除しますか？この操作は取り消せません。`)
    if (!confirmed) return

    setFormBusy(true)
    showResult(result, "イベントを削除しています...")
    try {
      const nextEvents = state.events.filter((event) => event.id !== current.id)
      state.events = await saveAdminEvents(nextEvents)
      targetInput.value = ""
      refreshTargets()
      loadSelectedEvent()
      onEventsChanged()
      showResult(result, "イベントを削除しました。")
    } catch (error) {
      showResult(result, getErrorMessage(error, "イベントを削除できませんでした。"), true)
    } finally {
      setFormBusy(false)
    }
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (isBusy) return

    const current = findSelectedEvent()
    const title = titleInput.value.trim()
    const month = monthInput.value.trim()
    const description = descriptionInput.value.trim()
    const imageAlt = altInput.value.trim()
    const file = photoInput.files?.[0]

    if (!title || !description) {
      showResult(result, "見出しと紹介文を入力してください。", true)
      return
    }
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      showResult(result, "開催年月を「2026-11」のように入力してください。", true)
      return
    }

    setFormBusy(true)
    showResult(result, "イベントを保存しています...")

    try {
      let uploadedImage = ""
      if (file) {
        let blob: Blob
        try {
          blob = await resizePhotoToBlob(file)
        } catch {
          showResult(result, "写真を読み込めませんでした。JPEGやPNGの写真をお試しください。", true)
          return
        }
        uploadedImage = await uploadAdminPhoto(blob)
      }

      let nextEvents: SchoolEvent[]
      if (current) {
        const nextImage = uploadedImage || current.image
        const nextImageAlt = nextImage ? eventPhotoAlt(imageAlt, title) : ""
        nextEvents = state.events.map((existing) =>
          existing.id === current.id
            ? { ...existing, title, month, description, image: nextImage, imageAlt: nextImageAlt }
            : existing,
        )
      } else {
        const newEvent: SchoolEvent = {
          id: globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title,
          month,
          description,
          image: uploadedImage,
          imageAlt: uploadedImage ? eventPhotoAlt(imageAlt, title) : "",
        }
        nextEvents = [newEvent, ...state.events]
      }

      state.events = await saveAdminEvents(nextEvents)
      refreshTargets()
      loadSelectedEvent()
      onEventsChanged()
      showResult(result, "イベントを保存しました。")
    } catch (error) {
      showResult(result, getErrorMessage(error, "イベントを保存できませんでした。"), true)
    } finally {
      setFormBusy(false)
    }
  })

  return refreshTargets
}

async function initAdminPage(): Promise<void> {
  const modeNote = document.querySelector<HTMLElement>("#editor-mode-note")
  const loadStatus = document.querySelector<HTMLElement>("#editor-load-status")
  const panels = document.querySelector<HTMLElement>("#editor-panels")

  if (modeNote) {
    modeNote.textContent = isLocalDemoMode
      ? "開発モードで表示しています。変更はこのブラウザー（localStorage）にのみ保存されます。"
      : "空き状況・イベント・写真を更新できます。保存した内容は公開サイトにすぐ反映されます。"
  }

  if (loadStatus) {
    showResult(loadStatus, "現在のデータを読み込んでいます...")
  }

  let state: AdminSiteState
  try {
    state = await loadAdminState()
  } catch (error) {
    if (loadStatus) {
      showResult(loadStatus, getErrorMessage(error, "データの読み込みに失敗しました。"), true)
    }
    return
  }

  if (loadStatus) showResult(loadStatus, "")
  if (panels) panels.hidden = false

  setupAvailabilityEditor(state)

  let refreshEventEditor: () => void = () => {}
  let refreshEventReorder: () => void = () => {}
  let refreshPhotoEditor: () => void = () => {}

  refreshPhotoEditor = setupPhotoEditor(state, () => {
    refreshEventEditor()
    refreshEventReorder()
  })
  refreshEventReorder = setupEventReorder(state, () => {
    refreshEventEditor()
    refreshPhotoEditor()
  })
  refreshEventEditor = setupEventEditor(state, () => {
    refreshEventReorder()
    refreshPhotoEditor()
  })
}

void initAdminPage()
