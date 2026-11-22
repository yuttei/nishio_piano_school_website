// 開発サーバーでだけ各ページに読み込まれ、編集画面で保存した内容を表示に反映します。
import siteContent from "virtual:site-content"
import { homePhotoSlots } from "./content.ts"
import { readAvailability, readDemoEvents, readDemoHomePhotos } from "./demo-storage.ts"
import { homePhotoCaption, renderAvailability, renderEvents } from "./render.ts"

const { site, data } = siteContent

function refreshPreview(): void {
  const schedule = document.getElementById("availability-content")
  if (schedule) schedule.innerHTML = renderAvailability(readAvailability(), site.timeSlots, site.availabilityDemoNote || null)

  const events = document.getElementById("event-content")
  if (events) events.innerHTML = renderEvents(readDemoEvents())

  const photos = readDemoHomePhotos()
  for (const slot of homePhotoSlots) {
    const element = document.querySelector<HTMLImageElement>(`[data-home-photo="${slot}"]`)
    if (!element) continue
    element.src = photos[slot].image
    element.alt = photos[slot].imageAlt
    const caption = document.querySelector(`[data-home-photo-caption="${slot}"]`)
    if (caption) caption.textContent = homePhotoCaption(photos[slot], data.homePhotos[slot])
  }
}

// 別タブの保存と、戻る操作で再表示したときにも編集結果を反映します。
refreshPreview()
window.addEventListener("storage", refreshPreview)
window.addEventListener("pageshow", refreshPreview)
