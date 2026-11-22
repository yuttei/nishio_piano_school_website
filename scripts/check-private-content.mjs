#!/usr/bin/env node
// 非公開の内容（教室の文章・リンク・写真など）が、公開側のリポジトリに紛れ込んでいないかを調べます。
// 依存パッケージは使わず、Node.js 22 と git だけで動きます。
//
// 使い方：
//   node scripts/check-private-content.mjs <非公開の内容フォルダ> [--repo <公開側のフォルダ>] [--staged | --history]
//
//   モードなし  作業ツリーのファイル（追跡中のファイルと、.gitignore で除外されていない新しいファイル）を調べます
//   --staged    コミットしようとしている内容（git add 済みの内容）を調べます。pre-commit で使います
//   --history   すべてのコミットの中身とコミットメッセージを調べます。CI で使います
//
// 見つかったら、どのファイルにどの語があったかを表示して終了コード 1 で終わります。
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

// ---------- 引数を読む ----------

function usage(message) {
  console.error(message)
  console.error("使い方：node scripts/check-private-content.mjs <非公開の内容フォルダ> [--repo <公開側のフォルダ>] [--staged | --history]")
  process.exit(2)
}

let contentDir = ""
let repoDir = process.cwd()
let mode = "worktree"
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === "--repo") {
    index += 1
    if (!args[index]) usage("--repo の後に公開側のフォルダを指定してください。")
    repoDir = resolve(args[index])
  } else if (arg === "--staged") {
    mode = "staged"
  } else if (arg === "--history") {
    mode = "history"
  } else if (arg.startsWith("--")) {
    usage(`知らない指定です：${arg}`)
  } else if (!contentDir) {
    contentDir = resolve(arg)
  } else {
    usage(`内容フォルダは1つだけ指定してください：${arg}`)
  }
}
if (!contentDir) usage("非公開の内容フォルダを指定してください。")
if (!existsSync(join(contentDir, "site.json"))) usage(`内容フォルダに site.json がありません：${contentDir}`)

// ---------- git を動かす ----------

// git を実行して、標準出力を返します。okCodes 以外の終了コードならエラーにします。
function git(gitArgs, okCodes = [0]) {
  const result = spawnSync("git", ["-C", repoDir, ...gitArgs], { maxBuffer: 1024 * 1024 * 512 })
  if (result.error) throw result.error
  if (!okCodes.includes(result.status ?? -1)) {
    throw new Error(`git ${gitArgs[0]} が失敗しました：${result.stderr.toString()}`)
  }
  return { status: result.status, stdout: result.stdout }
}

// ---------- 探す語の一覧を作る ----------

const words = new Set()

function addWord(value) {
  if (typeof value !== "string") return
  const word = value.trim()
  // 空の語は、すべての行に当たってしまうので必ず除きます。
  if (word) words.add(word)
}

function readJson(file) {
  return JSON.parse(readFileSync(join(contentDir, file), "utf8"))
}

const site = readJson("site.json")
const data = readJson("data.json")

addWord(site.area)
if (typeof site.area === "string" && site.area.trim()) addWord(encodeURIComponent(site.area.trim()))
addWord(site.notice)
addWord(site.availabilityDemoNote)
// レッスンの時間帯（例：午前・午後の時刻）も、実際の教室の情報なので探します。
for (const slot of Array.isArray(site.timeSlots) ? site.timeSlots : []) addWord(slot)
for (const url of Object.values(site.links ?? {})) addWord(url)
for (const page of Object.values(site.pages ?? {})) {
  addWord(page?.title)
  addWord(page?.description)
}
for (const event of data.events ?? []) {
  addWord(event?.title)
  addWord(event?.description)
  addWord(event?.imageAlt)
}
for (const photo of Object.values(data.homePhotos ?? {})) {
  addWord(photo?.imageAlt)
  addWord(photo?.caption)
  addWord(photo?.replacedCaption)
}

// HTML の文字参照（&amp; など）を元の文字に戻します。
function decodeEntities(text) {
  return text.replaceAll("&nbsp;", " ").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&")
}

// ページの断片から、タグや目印を除いた本文を取り出し、「。」と改行で区切った12文字以上の文を語にします。
// タグを消してつなげた文と、タグの位置でも区切った文の両方を使います。
const pageDir = join(contentDir, "pages")
if (existsSync(pageDir)) {
  for (const name of readdirSync(pageDir)) {
    if (!name.endsWith(".html")) continue
    const html = readFileSync(join(pageDir, name), "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\[[A-Z_]+\]/g, "")
    for (const tagReplacement of ["", "\n"]) {
      const text = decodeEntities(html.replace(/<[^>]*>/g, tagReplacement))
      for (const sentence of text.split(/[。\n]/)) {
        const trimmed = sentence.trim()
        if (trimmed.length >= 12) addWord(trimmed)
      }
    }
  }
}

// check/forbidden-words.txt：1行に1語。# で始まる行はコメントです。
const forbiddenFile = join(contentDir, "check", "forbidden-words.txt")
if (existsSync(forbiddenFile)) {
  for (const line of readFileSync(forbiddenFile, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue
    addWord(line)
  }
}

const wordList = [...words]

// ---------- 調べる ----------

// 見つかったものを「場所 → 語の一覧」の形でためます。
const findings = new Map()
function addFinding(place, word) {
  if (!findings.has(place)) findings.set(place, new Set())
  findings.get(place).add(word)
}

// 大文字・小文字の違いでは見逃さないよう、比べるときは両方を小文字にそろえます。
const lowerWords = wordList.map((word) => ({ word, lower: word.toLowerCase() }))

// 文字列の中に、どの語が含まれているかを調べます。
function searchText(place, text) {
  const lowerText = text.toLowerCase()
  for (const { word, lower } of lowerWords) {
    if (lowerText.includes(lower)) addFinding(place, word)
  }
}

// git grep の -o --null の出力（「名前\0見つかった語」の行）を読み取ります。
function readGrepOutput(stdout) {
  for (const line of stdout.toString("utf8").split("\n")) {
    const separator = line.indexOf("\0")
    if (separator < 0) continue
    addFinding(line.slice(0, separator), line.slice(separator + 1))
  }
}

// -F：語を正規表現ではなく、そのままの文字列として探します。-I：画像などのバイナリは飛ばします。
// -i：大文字・小文字を区別しません。-o：見つかった部分（ファイルの中の表記のまま）を表示します。
function grepArgs() {
  const patternArgs = []
  for (const word of wordList) patternArgs.push("-e", word)
  return ["grep", "-I", "-F", "-i", "-o", "--null", ...patternArgs]
}

// 写真は、中身が同じかどうかを git の blob の ID（git hash-object）で比べます。
const imageDir = join(contentDir, "images")
const images = []
if (existsSync(imageDir)) {
  for (const name of readdirSync(imageDir).sort()) {
    const path = join(imageDir, name)
    if (name.startsWith(".") || !statSync(path).isFile()) continue
    images.push({ name, path })
  }
}
function hashFiles(paths) {
  if (paths.length === 0) return []
  return git(["hash-object", "--no-filters", "--", ...paths]).stdout.toString("utf8").trim().split("\n")
}
const imageHashes = hashFiles(images.map((image) => image.path))
const imageFindings = []

if (mode === "worktree") {
  // 追跡中のファイルと、まだ追加していない新しいファイル（.gitignore で除外したものは除く）
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).stdout.toString("utf8")
  const files = [...new Set(listed.split("\0").filter(Boolean))]
    .filter((file) => existsSync(join(repoDir, file)) && statSync(join(repoDir, file)).isFile())
  for (const file of files) searchText(file, readFileSync(join(repoDir, file), "utf8"))

  const fileHashes = hashFiles(files.map((file) => join(repoDir, file)))
  images.forEach((image, index) => {
    const hashIndex = fileHashes.indexOf(imageHashes[index])
    if (hashIndex >= 0) imageFindings.push(`images/${image.name} と同じ写真が ${files[hashIndex]} にあります。`)
  })
} else if (mode === "staged") {
  if (wordList.length > 0) readGrepOutput(git([...grepArgs(), "--cached"], [0, 1]).stdout)

  // ステージ済みのファイルの blob の ID（git ls-files -s の2列目）と比べます。
  const staged = new Map()
  for (const line of git(["ls-files", "-s", "-z"]).stdout.toString("utf8").split("\0")) {
    const match = line.match(/^\d+ ([0-9a-f]+) \d+\t(.+)$/)
    if (match) staged.set(match[1], match[2])
  }
  images.forEach((image, index) => {
    const file = staged.get(imageHashes[index])
    if (file) imageFindings.push(`images/${image.name} と同じ写真が、ステージ済みの ${file} にあります。`)
  })
} else {
  // すべてのブランチ・タグから届くコミットを調べます。
  const commits = git(["rev-list", "--all"]).stdout.toString("utf8").split("\n").filter(Boolean)
  // コマンドが長くなりすぎないよう、50コミットずつ調べます。
  for (let start = 0; start < commits.length && wordList.length > 0; start += 50) {
    readGrepOutput(git([...grepArgs(), ...commits.slice(start, start + 50)], [0, 1]).stdout)
  }
  // コミットメッセージ（%H：コミットのID、%B：メッセージ。\x1e で区切ります）
  const log = git(["log", "--all", "--format=%H%x00%B%x1e"]).stdout.toString("utf8")
  for (const entry of log.split("\x1e")) {
    const [hash, message] = entry.split("\0")
    if (hash && message) searchText(`コミット ${hash.trim().slice(0, 12)} のメッセージ`, message)
  }
  // リポジトリの中に、同じ写真の blob が1つでも残っていれば見つけます。
  images.forEach((image, index) => {
    if (git(["cat-file", "-e", imageHashes[index]], [0, 1, 128]).status === 0) {
      imageFindings.push(`images/${image.name} と同じ写真（blob ${imageHashes[index].slice(0, 12)}）が、リポジトリの履歴にあります。`)
    }
  })
}

// ---------- 結果を表示する ----------

const modeLabel = { worktree: "作業ツリー", staged: "ステージ済みの内容", history: "すべての履歴" }[mode]
if (findings.size === 0 && imageFindings.length === 0) {
  console.log(`非公開の内容は見つかりませんでした（${modeLabel}、語 ${wordList.length} 個・写真 ${images.length} 枚を確認）。`)
  process.exit(0)
}

console.error(`非公開の内容が公開側（${repoDir}）の${modeLabel}で見つかりました。`)
for (const [place, found] of findings) {
  console.error(`- ${place}：${[...found].map((word) => `「${word}」`).join("、")}`)
}
for (const message of imageFindings) console.error(`- ${message}`)
console.error("公開側から取り除き、内容は非公開の内容フォルダに置いてください。")
process.exit(1)
