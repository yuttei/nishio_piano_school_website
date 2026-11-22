// Node 専用。ブラウザーから import しない（node:fs などを使うため、ブラウザーでは動きません）。
// vite.config.ts から使い、内容フォルダ（site.json・data.json・pages/・images/）を読み込んで検査します。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { extname, join, relative, resolve, sep } from "node:path"
import { pageIds, parseSiteData, parseSiteInfo, type PageId, type SiteData, type SiteInfo } from "./content.ts"

// 内容フォルダの既定の場所です（website の兄弟フォルダ ../website_content）。
export const DEFAULT_CONTENT_DIR = "../website_content"

export interface ContentFiles {
  site: SiteInfo
  data: SiteData
  // 各ページの <main id="main"> の内側に入れるHTMLです。
  pageMains: Record<PageId, string>
  // images/ にある写真のファイル名の一覧です。
  imageNames: string[]
}

// 写真の拡張子と、配信するときの Content-Type の対応です。
const imageTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

// 各ページの断片に必ず含める目印です。これがないと、写真や空き状況を差し込めません。
const requiredMarkers: Record<PageId, string[]> = {
  home: ["<!-- HOME_PHOTO_piano -->", "<!-- HOME_PHOTO_stickers -->", "<!-- HOME_PHOTO_recital -->"],
  lessons: ['id="availability-content"', "<!-- AVAILABILITY -->"],
  events: ['id="event-content"', "<!-- EVENT_LIST -->"],
  trial: [],
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep)
}

// 環境変数 SITE_CONTENT_DIR の値から、内容フォルダの場所を決めます。
// value が空なら既定の兄弟フォルダ（../website_content）を使い、相対パスは projectRoot から数えます。
// 非公開の内容をうっかり公開リポジトリに入れないよう、プロジェクトの中にあるフォルダは
// すべてエラーにします（シンボリックリンクもたどって調べます）。
export function resolveContentDir(projectRoot: string, value: string | undefined): string {
  const dir = resolve(projectRoot, value || DEFAULT_CONTENT_DIR)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `内容フォルダが見つかりません：${dir}（兄弟フォルダ ${DEFAULT_CONTENT_DIR} を用意するか、環境変数 SITE_CONTENT_DIR で内容フォルダを指定してください）`,
    )
  }

  const realDir = realpathSync(dir)
  const realRoot = realpathSync(projectRoot)
  if (isInside(realRoot, realDir)) {
    throw new Error(`非公開の内容フォルダは website の外に置いてください（例：${DEFAULT_CONTENT_DIR}）。指定されたフォルダ：${realDir}`)
  }
  return realDir
}

function readJson(dir: string, file: string): unknown {
  const path = join(dir, file)
  if (!existsSync(path)) throw new Error(`内容フォルダに ${file} がありません：${path}`)
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`${file} を JSON として読めませんでした：${error instanceof Error ? error.message : String(error)}`)
  }
}

function listImages(dir: string): string[] {
  const imageDir = join(dir, "images")
  if (!existsSync(imageDir)) return []

  const names: string[] = []
  for (const name of readdirSync(imageDir).sort()) {
    // .DS_Store などの隠しファイルは飛ばします。
    if (name.startsWith(".")) continue
    if (!statSync(join(imageDir, name)).isFile()) continue
    if (!/^[a-z0-9.-]+$/.test(name)) {
      throw new Error(`images/${name} の名前は、小文字の英字・数字・. と - だけにしてください。`)
    }
    if (!imageTypes[extname(name)]) {
      throw new Error(`images/${name} は使えない種類です（${Object.keys(imageTypes).join("、")} が使えます）。`)
    }
    names.push(name)
  }
  return names
}

// 内容フォルダを読み込み、形と中身を検査して返します。
// projectRoot は公開側（website）のフォルダで、public/images と写真の名前が重ならないかを調べるのに使います。
export function readContentFiles(dir: string, projectRoot: string): ContentFiles {
  const site = parseSiteInfo(readJson(dir, "site.json"), "site.json")
  const data = parseSiteData(readJson(dir, "data.json"), "data.json", site.timeSlots)
  const imageNames = listImages(dir)

  // public/images にある写真（マスコットなど）と同じ名前は、どちらが配信されるか分からなくなるので禁止します。
  const publicImageDir = join(projectRoot, "public", "images")
  for (const name of imageNames) {
    if (existsSync(join(publicImageDir, name))) {
      throw new Error(`images/${name} は public/images/${name} と同じ名前です。別の名前にしてください。`)
    }
  }

  // data.json に書いた /images/… の写真が、images/ に実在するかを確かめます。
  const usedImages = [
    ...Object.entries(data.homePhotos).map(([slot, photo]) => ({ path: `homePhotos.${slot}.image`, image: photo.image })),
    ...data.events.map((event, index) => ({ path: `events[${index}].image`, image: event.image })),
  ]
  for (const { path, image } of usedImages) {
    if (image && !imageNames.includes(image.slice("/images/".length))) {
      throw new Error(`data.json の ${path} の「${image}」が、内容フォルダの images/ にありません。`)
    }
  }

  const pageMains = {} as Record<PageId, string>
  for (const id of pageIds) {
    const file = `pages/${id}.html`
    const path = join(dir, file)
    if (!existsSync(path)) throw new Error(`内容フォルダに ${file} がありません：${path}`)
    const html = readFileSync(path, "utf8")
    for (const marker of requiredMarkers[id]) {
      if (!html.includes(marker)) throw new Error(`${file} に目印「${marker}」がありません。`)
    }
    pageMains[id] = html
  }

  return { site, data, pageMains, imageNames }
}

// images/ の写真を1枚読み込みます。name は readContentFiles が返した imageNames の中の名前だけを渡してください。
export function readContentImage(dir: string, name: string): { body: Buffer; contentType: string } {
  const path = join(dir, "images", name)
  // 念のため、images/ の外を指していないかも確かめます。
  if (relative(join(dir, "images"), path) !== name) throw new Error(`写真の名前が正しくありません：${name}`)
  const contentType = imageTypes[extname(name)]
  if (!contentType) throw new Error(`使えない種類の写真です：${name}`)
  return { body: readFileSync(path), contentType }
}
