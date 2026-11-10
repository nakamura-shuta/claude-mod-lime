// 表示用データを、チャットの吹き出し風の HTML（1ファイル。外から読み込むのは隣の縮小画像だけ）にする。
// 会話の中身はすべて無害化してから入れる。CSS とスクリプトは page-static.ts。
import { escapeHtml, joinLines, renderMarkdown } from './markdown'
import type { Conversation, Item, MessagePreviews, Origin, Preview, ToolEntry } from './model'
import { CSS, PAGE_SCRIPT, PAGE_SCRIPT_SHA256 } from './page-static'
import { extractPaths } from './previews'
import { formatClock, formatDateTime } from './time'

export type RenderOptions = {
  sessionId: string
  /** 1行だけで大きすぎるため読まなかった行の数 */
  tooLongLines: number
  /** true ならツールの結果を省く（HTML が大きすぎるとき） */
  compact?: boolean
  /** 記録が大きいため読まなかった、古い側の行の数 */
  omittedLines?: number
  /** HTML を上限に収めるために省いた、古い側の項目の数 */
  omittedItems?: number
  /** 発言ごとの縮小画像（発言の項目そのものがキー） */
  previews?: ReadonlyMap<Item, MessagePreviews>
  /** HTML を作った時刻。↻ のボタンの説明に出す（更新が止まっていないかを確かめられる） */
  builtAt?: number
}

// 長い発言（300字以上か、30行を超える）は先頭だけを見せて折りたたむ。
// 閉じているときの先頭（5行・150字まで）は、折りたたむ境目より短くする（閉じても中身がほとんど見えてしまわないように）
const LONG_LINES = 30
const LONG_CHARS = 300
const PREVIEW_LINES = 5
const PREVIEW_CHARS = 150
/** 目次に出す、自分の発言の1行目の長さ */
const TOC_CHARS = 40
/** 検索欄の説明（マウスを乗せると出る） */
const FIND_TITLE = 'Enter で次、Shift+Enter で前（最初は一番新しいもの）、Esc で消す'
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'

function copyButton(text: string): string {
  return `<button class="copy" type="button" title="コピー" aria-label="コピー" data-copy="${escapeHtml(text)}">${COPY_ICON}</button>`
}

export function renderHtml(conversation: Conversation, options: RenderOptions): string {
  const title = conversation.title ?? options.sessionId
  const period =
    conversation.firstTime !== undefined && conversation.lastTime !== undefined
      ? `${formatDateTime(conversation.firstTime)} 〜 ${formatDateTime(conversation.lastTime)}・`
      : ''
  // 自分の発言に m1, m2, … の id を付け、目次から飛べるようにする（Codex への依頼は目次に出さない）
  const mine: { anchor: string; item: Extract<Item, { kind: 'message' }> }[] = []
  const body = conversation.items
    .map((item) => {
      if (item.kind !== 'message' || item.side !== 'me' || item.origin !== undefined) return renderItem(item, options)
      const anchor = `m${mine.length + 1}`
      mine.push({ anchor, item })
      return renderMessage(item, options.previews?.get(item), anchor)
    })
    .join('\n')
  const omittedParts = [
    (options.omittedLines ?? 0) > 0 ? `読まなかった行 ${options.omittedLines}` : '',
    (options.omittedItems ?? 0) > 0 ? `省いた項目 ${options.omittedItems}` : '',
  ].filter((part) => part !== '')
  const omittedNote =
    omittedParts.length > 0 ? `<p class="omitted">記録が大きいため、古い部分を省略しています（${omittedParts.join('・')}）</p>` : ''
  const unread = conversation.skippedLines + options.tooLongLines
  const footer =
    unread > 0
      ? `<p class="footer">読めなかった行: ${unread} 行（壊れた行 ${conversation.skippedLines}・大きすぎる行 ${options.tooLongLines}）</p>`
      : ''
  const reloadTitle = `${options.builtAt === undefined ? '' : `最終更新 ${formatDateTime(options.builtAt)}。`}押すと読み直す`
  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    // 念のための守り: 外部の読み込みとスクリプトを止める（ページのスクリプトだけハッシュで許す）。画像は同じ場所（'self'）の縮小画像だけ
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'sha256-${PAGE_SCRIPT_SHA256}'">`,
    `<title>${escapeHtml(title)}</title><style>${CSS}</style></head>`,
    // 「先頭へ」の飛び先はページの一番上の空の印（#top）。貼り付くヘッダ（sticky）を飛び先にすると、押しても動かない。
    // 「先頭へ」「最新へ」は右下に固定すると右寄せの自分の吹き出しと重なるので、ヘッダの右端に置く。検索欄もヘッダに置き、スクロールしても使えるようにする
    `<body><div id="top"></div><header><div class="title"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(period)}発言 ${conversation.messageCount} 件</p></div>` +
      `<nav class="jump"><input class="find" type="search" placeholder="検索" aria-label="会話内を検索" title="${FIND_TITLE}"><span class="hits"></span>` +
      `<a href="#top">▲ 先頭へ</a><a href="#latest">▼ 最新へ</a>` +
      `<button class="reload" type="button" title="${escapeHtml(reloadTitle)}" aria-label="読み直す">↻</button></nav></header>${omittedNote}${renderToc(mine)}`,
    `<main>${body}</main><div id="latest"></div>${footer}`,
    `<script>${PAGE_SCRIPT}</script></body></html>`,
  ].join('\n')
}

function renderItem(item: Item, options: RenderOptions): string {
  switch (item.kind) {
    case 'separator':
      return `<div class="sep"><span>${escapeHtml(formatDateTime(item.time))}</span></div>`
    case 'notice':
      return `<div class="notice">${escapeHtml(item.text)}</div>`
    case 'message':
      return renderMessage(item, options.previews?.get(item))
    case 'tools':
      return renderTools(item.tools, item.time, options.compact === true, item.origin)
  }
}

/** 自分の発言の目次（折りたたみ）。ページ内リンクだけなので、スクリプトは要らない */
function renderToc(mine: { anchor: string; item: Extract<Item, { kind: 'message' }> }[]): string {
  if (mine.length === 0) return ''
  const entries = mine
    .map(({ anchor, item }) => {
      const first = item.text.split('\n')[0] ?? ''
      const label = first.length > TOC_CHARS || item.text.includes('\n') ? `${first.slice(0, TOC_CHARS)}…` : first
      return `<li><a href="#${anchor}"><time>${formatClock(item.time)}</time>${escapeHtml(label)}</a></li>`
    })
    .join('')
  return `<details class="toc"><summary>自分の発言（${mine.length}）</summary><ol>${entries}</ol></details>`
}

/** 縮小画像を並べる箱（表示だけ）。段落やリストの中にも置くので <span> で組み、CSS で行の幅いっぱいにする */
function renderThumbs(previews: readonly Preview[]): string {
  const thumbs = previews
    .map(
      (preview) =>
        `<span class="thumb"><img src="${escapeHtml(preview.src)}" alt="${escapeHtml(preview.name)}" loading="lazy"><span class="cap">${escapeHtml(preview.name)}</span></span>`,
    )
    .join('')
  return `<span class="thumbs">${thumbs}</span>`
}

/**
 * 行のすぐ下に置く縮小画像を返す関数。行に書かれたパスを、発言全体で拾ったときと同じ決まり（extractPaths）で拾って表を引く。
 * 1行に同じファイルが2回書かれていても1回だけ出す
 */
function thumbsAfter(previews: MessagePreviews): (line: string) => string {
  return (line) => {
    const found = new Set<Preview>()
    for (const candidate of extractPaths(line)) {
      const preview = previews.get(candidate)
      if (preview !== undefined) found.add(preview)
    }
    return found.size === 0 ? '' : renderThumbs([...found])
  }
}

/** 左側（相手）のアイコン。Claude Code は「✳」、Codex は黒い丸に「>_」（公開して配るので、商標のロゴは使わない） */
function avatar(origin: Origin | undefined): string {
  return origin?.agent === 'codex'
    ? '<div class="avatar codex" title="Codex">&gt;_</div>'
    : '<div class="avatar claude-code" title="Claude Code">✳</div>'
}

/** Codex の項目の名札。同じフォルダで複数の Codex を使うこともあるので、会話の ID の先頭8文字を添える */
function originTag(origin: Origin | undefined, side: 'me' | 'claude'): string {
  if (origin === undefined) return ''
  return `<span class="tag">${side === 'me' ? 'Codex へ' : 'Codex'}·${escapeHtml(origin.session.slice(0, 8))}</span>`
}

/** 発言の吹き出し。Claude の発言は Markdown、自分の発言は文字のまま。anchor は目次から飛ぶ先の id */
function renderMessage(item: Extract<Item, { kind: 'message' }>, previews: MessagePreviews | undefined, anchor?: string): string {
  const after = previews === undefined || previews.size === 0 ? undefined : thumbsAfter(previews)
  const render = (text: string) =>
    item.side === 'claude' ? renderMarkdown(text, after) : joinLines(text.split('\n'), escapeHtml, after)
  const lines = item.text.split('\n')
  let html = render(item.text)
  if (lines.length > LONG_LINES || item.text.length >= LONG_CHARS) {
    let head = lines.slice(0, PREVIEW_LINES).join('\n')
    if (head.length > PREVIEW_CHARS) head = `${head.slice(0, PREVIEW_CHARS)}…`
    const label = lines.length > PREVIEW_LINES ? `▶ 続きを読む（全 ${lines.length} 行）` : '▶ 続きを読む'
    html = `<div class="preview">${render(head)}</div><details class="long"><summary><span class="open">${label}</span><span class="close">▲ 閉じる</span></summary>${html}</details>`
  }
  const id = anchor === undefined ? '' : ` id="${anchor}"`
  const icon = item.side === 'claude' ? avatar(item.origin) : ''
  const codexClass = item.origin === undefined ? '' : item.side === 'claude' ? ' codex' : ' to-codex'
  return `<div class="row ${item.side}"${id}>${icon}<div class="bubble${codexClass}">${html}</div><div class="meta">${copyButton(item.text)}<time>${formatClock(item.time)}</time>${originTag(item.origin, item.side)}</div></div>`
}

function renderTools(tools: ToolEntry[], time: number, compact: boolean, origin?: Origin): string {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  const breakdown = [...counts].map(([name, count]) => `${name} ${count}`).join('・')
  const errors = tools.filter((tool) => tool.isError).length
  const entries = tools
    .map((tool) => {
      const result = compact ? '' : `<pre>${escapeHtml(tool.result)}</pre>`
      const mark = tool.isError ? ' ⚠' : ''
      return `<li${tool.isError ? ' class="error"' : ''}><div class="tool-name">${escapeHtml(tool.name)}${mark}</div><pre class="summary">${escapeHtml(tool.summary)}</pre>${result}</li>`
    })
    .join('')
  const errorNote = errors > 0 ? `・エラー ${errors}` : ''
  const who = origin === undefined ? '' : 'Codex の'
  return `<div class="row claude">${avatar(origin)}<details class="tools"><summary>🔧 ${who}ツール ${tools.length}件（${escapeHtml(breakdown)}）${errorNote}</summary><ul>${entries}</ul></details><time>${formatClock(time)}</time></div>`
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/**
 * HTML を maxBytes 以下に収める（$.fs.write は 4 MiB まで）。
 * 収まらなければツールの結果を省き、それでも収まらなければ古い項目から2割ずつ省く
 */
export function renderHtmlWithin(conversation: Conversation, options: RenderOptions, maxBytes: number): string {
  let html = renderHtml(conversation, options)
  if (byteLength(html) <= maxBytes) return html
  const compact = { ...options, compact: true }
  html = renderHtml(conversation, compact)
  const items = conversation.items
  let dropped = 0
  while (byteLength(html) > maxBytes && dropped < items.length) {
    dropped = Math.min(items.length, dropped + Math.max(1, Math.ceil((items.length - dropped) * 0.2)))
    const rest = items.slice(dropped)
    const first = rest[0]
    // 省いた後の先頭に日付が無いと読みにくいので、区切りから始める
    const withSeparator: Item[] =
      first !== undefined && first.kind !== 'separator' ? [{ kind: 'separator', time: first.time }, ...rest] : rest
    // 「省いた項目」に日付の区切りは数えない
    const omittedItems = items.slice(0, dropped).filter((item) => item.kind !== 'separator').length
    html = renderHtml({ ...conversation, items: withSeparator }, { ...compact, omittedItems })
  }
  return html
}
