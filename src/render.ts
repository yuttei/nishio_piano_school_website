// ページの部品（ヘッダー、フッター、空き状況の表など）のHTMLを作ります。
// 教室ごとの文章やリンクは、内容フォルダの site.json・data.json から引数で受け取ります。
import { DAYS, isContentImagePath, isUploadedPhotoPath, type Availability, type HomePhotoDefault, type HomePhotoSlot, type PageMeta, type Photo, type SchoolEvent, type SiteInfo, type SiteLinks, type Status } from "./content.ts"

export const pages = {
  home: { path: "/", title: "ホーム" },
  lessons: { path: "/lessons/", title: "レッスン" },
  events: { path: "/events/", title: "イベント" },
  trial: { path: "/trial/", title: "無料体験" },
}

// HTMLの中で特別な意味を持つ文字（< や " など）を、文字として表示される形に変えます。
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

function isImageUrl(url: string): boolean {
  // 編集画面が保存する画像（R2 配信パスや開発時の data URL）と、公開用の画像URLだけを画像要素に渡します。
  return isContentImagePath(url) || isUploadedPhotoPath(url) || /^https:\/\//i.test(url) ||
    /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(url)
}

const homePhotoSizes: Record<HomePhotoSlot, { width: number; height: number }> = {
  piano: { width: 1250, height: 915 },
  stickers: { width: 637, height: 663 },
  recital: { width: 800, height: 800 },
}

// 写真の下の説明文です。既定の写真なら caption、差し替えた写真なら replacedCaption を使います。
// fallback は data.json に書いたその場所の既定の写真です。
export function homePhotoCaption(photo: Photo, fallback: HomePhotoDefault): string {
  return photo.image === fallback.image ? fallback.caption : fallback.replacedCaption
}

export function renderHomePhoto(slot: HomePhotoSlot, photo: Photo, fallback: HomePhotoDefault): string {
  const displayPhoto = isImageUrl(photo.image) ? photo : fallback
  const { width, height } = homePhotoSizes[slot]
  const priority = slot === "piano" ? 'fetchpriority="high"' : 'loading="lazy"'
  const image = `<img data-home-photo="${slot}" src="${escapeHtml(displayPhoto.image)}" width="${width}" height="${height}" alt="${escapeHtml(displayPhoto.imageAlt)}" ${priority}>`
  const caption = homePhotoCaption(displayPhoto, fallback)
  if (!caption) return image

  const decoration = slot === "piano" ? ' <span aria-hidden="true">♪</span>' : ""
  return `${image}<figcaption><span data-home-photo-caption="${slot}">${escapeHtml(caption)}</span>${decoration}</figcaption>`
}

// <head> に入れる説明文とページ名です。
export function renderPageMeta(meta: PageMeta): string {
  return `<meta name="description" content="${escapeHtml(meta.description)}">
  <title>${escapeHtml(meta.title)}</title>`
}

// notice が空でなければ、ヘッダーの上にお知らせの帯を出します。
export function renderHeader(currentPage: string, notice: string): string {
  const navigation = Object.entries(pages).map(([id, page]) => {
    const current = currentPage === id ? ' aria-current="page"' : ""
    return `<li><a href="${page.path}"${current}>${page.title}</a></li>`
  }).join("")

  const noticeBar = notice ? `<p class="site-notice">${escapeHtml(notice)}</p>` : ""
  return `<a class="skip-link" href="#main">本文に移動</a>${noticeBar}
    <header class="site-header"><div class="wrap header-inner">
      <a class="brand" href="/"><img class="brand-mascot" src="/images/school-mascot.png" width="38" height="38" alt=""><span>にしおピアノ教室</span></a>
      <nav id="site-nav" aria-label="メインメニュー"><ul>${navigation}</ul></nav>
    </div></header>`
}

const socialIcons = {
  // Instagramのホーム画面用アイコン、Amebaブログのファビコン、LINE配布のブランドアイコンです。
  instagram: "instagram.webp",
  blog: "ameba.png",
  line: "line.png",
}

export function renderSocialIcon(service: keyof typeof socialIcons): string {
  return `<img class="social-icon" src="/images/social/${socialIcons[service]}" width="24" height="24" alt="">`
}

// 地図です。埋め込み用のURLが空なら、地図の埋め込みを出しません。
export function renderAccessMap(links: SiteLinks): string {
  const map = links.mapEmbed
    ? `<iframe class="access-map" title="Google マップで見るにしおピアノ教室" src="${escapeHtml(links.mapEmbed)}"
    width="600" height="280" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
    : ""
  const open = links.map ? `
    <a class="text-link" href="${escapeHtml(links.map)}">Google マップで開く</a>` : ""
  return map + open
}

// フッターです。地区は site.area、SNS のリンクは空でないものだけを出します。
export function renderFooter(site: SiteInfo, isDemo: boolean): string {
  const demo = isDemo ? '<a class="demo-link" href="/admin/">編集画面を試す</a>' : ""
  const socialLinks = [
    { url: site.links.instagram, service: "instagram", label: "Instagram" },
    { url: site.links.blog, service: "blog", label: "Amebaブログ" },
    { url: site.links.line, service: "line", label: "公式LINE" },
  ] as const
  const linkHtml = socialLinks.filter((link) => link.url).map((link) => `
      <a class="social-link" href="${escapeHtml(link.url)}">${renderSocialIcon(link.service)}${link.label}</a>`).join("")
  return `<footer class="site-footer"><div class="wrap footer-inner">
    <div><a class="brand" href="/">にしおピアノ教室</a>
    <p>${escapeHtml(site.area)}</p></div>
    <div class="footer-links">${linkHtml}${demo}
    </div>
  </div></footer>`
}

const statusAppearance: Record<Status, { symbol: string; className: string }> = {
  余裕あり: { symbol: "○", className: "open" },
  残りわずか: { symbol: "△", className: "few" },
  空きなし: { symbol: "×", className: "full" },
  休み: { symbol: "休", className: "rest" },
}

// timeSlots は表の行の見出し（時間帯）です。
// demoNote は開発サーバーで、更新日がないときに出す説明です（ビルドでは null）。
export function renderAvailability(availability: Availability, timeSlots: readonly string[], demoNote: string | null): string {
  let freshness = "最新の空き状況は公式LINEでお問い合わせください。"
  if (availability.updatedAt) {
    const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" })
      .format(new Date(availability.updatedAt))
    freshness = `更新日 ${date}`
  } else if (demoNote) {
    freshness = escapeHtml(demoNote)
  }

  const days = DAYS.map((day) => `<th scope="col">${day}</th>`).join("")
  const rows = availability.rows.map((row, index) => {
    const slots = row.map((status) => {
      const appearance = statusAppearance[status]
      return `<td class="slot slot--${appearance.className}"><span aria-hidden="true">${appearance.symbol}</span><span class="visually-hidden">${status}</span></td>`
    }).join("")
    return `<tr><th scope="row">${escapeHtml(timeSlots[index] ?? "")}</th>${slots}</tr>`
  }).join("")

  const legend = Object.entries(statusAppearance).map(([label, style]) =>
    `<li><span class="slot--${style.className}" aria-hidden="true">${style.symbol}</span> ${label}</li>`).join("")

  return `<div class="availability-card"><p class="freshness">${freshness}</p>
    <table class="availability-table" aria-label="曜日ごとのレッスン空き状況">
      <thead><tr><th scope="col">時間帯</th>${days}</tr></thead><tbody>${rows}</tbody>
    </table><ul class="availability-legend" aria-label="空き状況の凡例">${legend}</ul></div>`
}

export function renderEvents(events: SchoolEvent[]): string {
  if (events.length === 0) return '<p class="quiet">イベントの様子は、開催後にこちらでご紹介します。</p>'

  return `<div class="event-grid">${events.map((event) => {
    const date = /^\d{4}-(0[1-9]|1[0-2])$/.test(event.month)
      ? `<time datetime="${event.month}">${event.month.slice(0, 4)}年${Number(event.month.slice(5))}月</time>`
      : ""
    const photo = isImageUrl(event.image)
      ? `<img src="${escapeHtml(event.image)}" alt="${escapeHtml(event.imageAlt)}" loading="lazy" decoding="async">`
      : ""
    return `<article class="event-card">${photo}<div class="event-card-copy">${date}
      <h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.description)}</p></div></article>`
  }).join("")}</div>`
}
