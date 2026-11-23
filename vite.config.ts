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
  renderRobotsTxt,
  renderSitemapXml,
  renderSocialIcon,
} from "./src/render.ts"

// ブラウザー側で使う仮想モジュールの名前です。
// 開発サーバーではデモ編集画面・プレビュー、ビルドでは管理画面とライブ反映スクリプトが import します。
const virtualModuleId = "virtual:site-content"
const resolvedVirtualModuleId = "\0" + virtualModuleId

// 外部サイトへの <a> 開始タグに、新しいタブで開く設定（target="_blank"）と
// セキュリティ対策（rel="noopener noreferrer"）を補います。
// すでに target や rel が書かれている場合は、属性を重複させずに不足分だけを追加します。
function ensureExternalLinkAttributes(openingTag: string): string {
  // 末尾の ">" をいったん外して、必要な属性を後ろに足せるようにします。
  let tag = openingTag.slice(0, -1).trimEnd()

  // target 属性がまだ付いていない場合だけ、target="_blank" を追加します。
  if (!/\starget\s*=/i.test(tag)) {
    tag += ' target="_blank"'
  }

  // rel 属性がすでにある場合は、元の値を残しつつ noopener・noreferrer の足りない分だけ足します。
  const relPattern = /(\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
  if (relPattern.test(tag)) {
    tag = tag.replace(
      relPattern,
      (_match, leadingSpace: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
        const currentValue = doubleQuoted ?? singleQuoted ?? unquoted ?? ""
        const tokens = currentValue.trim() ? currentValue.trim().split(/\s+/) : []
        const lowerTokens = tokens.map((token) => token.toLowerCase())
        if (!lowerTokens.includes("noopener")) tokens.push("noopener")
        if (!lowerTokens.includes("noreferrer")) tokens.push("noreferrer")
        return `${leadingSpace}rel="${tokens.join(" ")}"`
      },
    )
  } else {
    // rel 属性がない場合は、そのまま rel="noopener noreferrer" を追加します。
    tag += ' rel="noopener noreferrer"'
  }

  return `${tag}>`
}

// ページの断片にある [LINE_URL] などの目印を、site.json のリンクに置き換えます。
// 外部サイトへの <a> タグには、新しいタブで開く属性も自動で補います。
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
      const escapedUrl = escapeHtml(url)
      // まず href="[〇〇_URL]" を持つ <a> の開始タグを探し、新しいタブで開く属性を補ってから URL を差し込みます。
      const openingTagPattern = new RegExp(`<a\\b[^>]*\\shref\\s*=\\s*(["'])\\[${name}_URL\\]\\1[^>]*>`, "g")
      result = result.replace(openingTagPattern, (openingTag) =>
        ensureExternalLinkAttributes(openingTag).replaceAll(marker, () => escapedUrl))
      // <a> の href 以外の場所に目印が残っていれば、そのまま URL に置き換えます。
      result = result.replaceAll(marker, () => escapedUrl)
    } else {
      const linkPattern = new RegExp(`<a\\b[^>]*\\shref\\s*=\\s*(["'])\\[${name}_URL\\]\\1[^>]*>[\\s\\S]*?</a>`, "g")
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
      // ビルドでは、内容フォルダの写真と SEO 用ファイル（robots.txt・sitemap.xml）を dist/ に書き出します。
      if (command !== "build") return
      const { site, imageNames } = getContentFiles()
      for (const name of imageNames) {
        this.emitFile({ type: "asset", fileName: `images/${name}`, source: readContentImage(contentDir, name).body })
      }
      this.emitFile({ type: "asset", fileName: "robots.txt", source: renderRobotsTxt(site.siteUrl) })
      if (site.siteUrl) {
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: renderSitemapXml(site.siteUrl) })
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
          // 2. <title>・説明文・SEO 用のメタタグ（canonical・OGP・Twitter Card・JSON-LD）
          .replace("<!-- PAGE_META -->", () => renderPageMeta(site, page, content.homePhotos.piano.image))
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
