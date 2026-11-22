import { resolve, sep } from "node:path"
import { defineConfig, loadEnv, type Plugin } from "vite"
import { loadCmsContent } from "./src/cms.ts"
// 設定ファイルを読み込む時点では alias が効かないため、相対パスで import します。
import { readContentFiles, readContentImage, resolveContentDir, type ContentFiles } from "./src/content-files.ts"
import { homePhotoSlots, type PageId, type SiteLinks } from "./src/content.ts"
import {
  escapeHtml,
  renderAccessMap,
  renderAvailability,
  renderEvents,
  renderFooter,
  renderHeader,
  renderHomePhoto,
  renderPageMeta,
  renderSocialIcon,
} from "./src/render.ts"

// ブラウザー側で使う仮想モジュールの名前です。
// 開発サーバーではデモ編集画面・プレビュー、ビルドでは管理画面とライブ反映スクリプトが import します。
const virtualModuleId = "virtual:site-content"
const resolvedVirtualModuleId = "\0" + virtualModuleId

// ページの断片にある [LINE_URL] などの目印を、site.json のリンクに置き換えます。
// リンクが空文字のときは、その目印を使っている <a>…</a> をまるごと取り除きます。
function fillLinkPlaceholders(html: string, links: SiteLinks): string {
  const placeholders = [
    { url: links.line, name: "LINE" },
    { url: links.blog, name: "BLOG" },
    { url: links.instagram, name: "INSTAGRAM" },
  ]
  let result = html
  for (const { url, name } of placeholders) {
    const marker = `[${name}_URL]`
    if (url) {
      // URL は属性値（href="…"）に入るので、" や & などを HTML 用に変換してから入れます。
      result = result.replaceAll(marker, () => escapeHtml(url))
    } else {
      const linkPattern = new RegExp(`<a\\b[^>]*href="\\[${name}_URL\\]"[^>]*>[\\s\\S]*?</a>`, "g")
      result = result.replace(linkPattern, "")
    }
  }
  return result.replaceAll("[LINE_ICON]", () => renderSocialIcon("line"))
    .replaceAll("[BLOG_ICON]", () => renderSocialIcon("blog"))
    .replaceAll("[INSTAGRAM_ICON]", () => renderSocialIcon("instagram"))
}

export default defineConfig(({ command, mode }) => {
  const isDemo = command === "serve"
  const projectRoot = import.meta.dirname
  // process.env の値が .env ファイルより優先されます。
  const env = loadEnv(mode, projectRoot, ["MICROCMS_", "SITE_"])
  // 内容フォルダの場所。既定は兄弟フォルダ（../website_content）です。
  const contentDir = resolveContentDir(projectRoot, env.SITE_CONTENT_DIR)

  // 内容フォルダの読み込み結果を覚えておきます。開発中にファイルが変わったら消して読み直します。
  let contentFiles: ContentFiles | undefined
  function getContentFiles(): ContentFiles {
    contentFiles ??= readContentFiles(contentDir, projectRoot)
    return contentFiles
  }

  let publishedContent: ReturnType<typeof loadCmsContent> | undefined

  // ページに表示する空き状況・イベント・トップの写真です。
  // 既定は内容フォルダの data.json、ビルド時に microCMS の環境変数があれば microCMS から取得します。
  function getContent(): ReturnType<typeof loadCmsContent> {
    if (publishedContent) return publishedContent

    const { site, data } = getContentFiles()
    const domain = env.MICROCMS_SERVICE_DOMAIN
    const apiKey = env.MICROCMS_API_KEY
    const homePhotosApi = env.MICROCMS_HOME_PHOTOS_API
    if (!isDemo && (domain || apiKey || homePhotosApi)) {
      if (!domain || !apiKey) throw new Error("microCMSのサービスIDとAPIキーの両方を設定してください。")
      publishedContent = loadCmsContent(domain, apiKey, homePhotosApi, data.homePhotos, site.timeSlots)
      return publishedContent
    }
    // 開発中は内容フォルダの変更をすぐ反映したいので、data.json の値を覚えずに毎回返します。
    return Promise.resolve({ availability: data.availability, events: data.events, homePhotos: data.homePhotos })
  }

  const siteContent: Plugin = {
    name: "site-content",
    configResolved(config) {
      config.logger.info(`内容フォルダ: ${contentDir}`)
    },
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId
    },
    load(id) {
      // ブラウザー側（管理画面・公開ページのライブ反映・開発時プレビュー）に既定値を渡します。
      if (id !== resolvedVirtualModuleId) return
      const { site, data } = getContentFiles()
      return `export default ${JSON.stringify({ site, data })}`
    },
    buildStart() {
      // ビルドでは、内容フォルダの写真を dist/images/ に書き出します（開発サーバーでは下の配信を使います）。
      if (command !== "build") return
      const { imageNames } = getContentFiles()
      for (const name of imageNames) {
        this.emitFile({ type: "asset", fileName: `images/${name}`, source: readContentImage(contentDir, name).body })
      }
    },
    configureServer(server) {
      // 関数を返さずにここで登録すると、Vite の内部の処理より前に動きます。
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0]
        const match = path.match(/^\/images\/([^/]+)$/)
        // 一覧にある名前だけを返すので、../ などで images/ の外を読まれることはありません。
        if (!match || !getContentFiles().imageNames.includes(match[1])) {
          next()
          return
        }
        const image = readContentImage(contentDir, match[1])
        response.setHeader("Content-Type", image.contentType)
        response.setHeader("Cache-Control", "no-cache")
        response.end(image.body)
      })

      // 内容フォルダの変更を見張り、変わったら読み直してブラウザーを再読み込みします。
      server.watcher.add(contentDir)
      server.watcher.on("all", (_event, file) => {
        const changed = resolve(file)
        if (changed !== contentDir && !changed.startsWith(contentDir + sep)) return
        contentFiles = undefined
        const moduleGraph = server.environments.client.moduleGraph
        const module = moduleGraph.getModuleById(resolvedVirtualModuleId)
        if (module) moduleGraph.invalidateModule(module)
        server.ws.send({ type: "full-reload" })
      })
    },
  }

  const schoolPages: Plugin = {
    name: "school-pages",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        const page = html.match(/data-page="([a-z]+)"/)?.[1] as PageId | undefined
        if (!page) return html

        const { site, data, pageMains } = getContentFiles()
        const pageMain = pageMains[page]
        if (pageMain === undefined) throw new Error(`data-page="${page}" に対応するページの断片がありません。`)
        const content = await getContent()

        // 1. 本文を差し込みます。断片に $ が入っていても特別な置換にならないよう、関数で渡します。
        //    断片は自分の字下げと末尾の改行を持つので、目印の行（前の空白と改行を含む）ごと置き換えます。
        let pageHtml = html.replace(/^[ \t]*<!-- PAGE_MAIN -->[ \t]*\r?\n?/m, () => pageMain)
          // 2. <title> と説明文
          .replace("<!-- PAGE_META -->", () => renderPageMeta(site.pages[page]))
        // 3. 断片の中のリンクと、ページの部品
        pageHtml = fillLinkPlaceholders(pageHtml, site.links)
          .replace(
            "<!-- EDITOR_PREVIEW -->",
            isDemo
              ? '<script type="module" src="/src/demo.ts"></script>'
              : '<script type="module" src="/src/live-content.ts"></script>',
          )
          .replaceAll("<!-- ACCESS_MAP -->", () => renderAccessMap(site.links))
          .replace("<!-- SITE_HEADER -->", () => renderHeader(page, site.notice))
          .replace("<!-- SITE_FOOTER -->", () => renderFooter(site, isDemo))
          .replace("<!-- AVAILABILITY -->", () =>
            renderAvailability(content.availability, site.timeSlots, isDemo ? site.availabilityDemoNote || null : null))
          .replace("<!-- EVENT_LIST -->", () => renderEvents(content.events))
        for (const slot of homePhotoSlots) {
          pageHtml = pageHtml.replace(`<!-- HOME_PHOTO_${slot} -->`, () =>
            renderHomePhoto(slot, content.homePhotos[slot], data.homePhotos[slot]))
        }

        // 4. ビルドでは、置き換え忘れた目印が残っていたら止めます。
        if (!isDemo) {
          const leftovers = pageHtml.match(/<!-- [A-Z][A-Za-z_]* -->|\[[A-Z_]+_(?:URL|ICON)\]/g)
          if (leftovers) throw new Error(`${page} のページに置き換えられていない目印があります：${[...new Set(leftovers)].join("、")}`)
        }
        return pageHtml
      },
    },
  }

  return {
    plugins: [siteContent, schoolPages],
    build: {
      rolldownOptions: {
        input: {
          home: resolve(projectRoot, "index.html"),
          lessons: resolve(projectRoot, "lessons/index.html"),
          events: resolve(projectRoot, "events/index.html"),
          trial: resolve(projectRoot, "trial/index.html"),
          admin: resolve(projectRoot, "admin/index.html"),
        },
      },
    },
  }
})
