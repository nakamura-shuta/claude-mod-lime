import { expect, test } from 'claude-code/testing'
import type { Conversation, Item, MessagePreviews } from '../hooks/model'
import { PAGE_SCRIPT, PAGE_SCRIPT_SHA256 } from '../hooks/page-static'
import { renderHtml, renderHtmlWithin } from '../hooks/render-html'

const t = (iso: string) => Date.parse(iso)
const base: Conversation = {
  title: 'テストの<会話>',
  items: [
    { kind: 'separator', time: t('2026-10-06T05:32:00Z') },
    { kind: 'message', side: 'me', time: t('2026-10-06T05:32:00Z'), text: '<script>x</script>\n二行目' },
    { kind: 'message', side: 'claude', time: t('2026-10-06T05:33:00Z'), text: '**太字**\n\n| a | b |\n|---|---|\n| 1 | 2 |' },
    {
      kind: 'tools',
      time: t('2026-10-06T05:34:00Z'),
      tools: [
        { name: 'Bash', summary: 'ls', result: 'a.txt', isError: false },
        { name: 'Read', summary: '/x', result: 'not found', isError: true },
        { name: 'Bash', summary: 'pwd', result: '/h', isError: false },
      ],
    },
    { kind: 'notice', time: t('2026-10-06T05:35:00Z'), text: '/model opus' },
  ],
  messageCount: 2,
  skippedLines: 1,
  firstTime: t('2026-10-06T05:32:00Z'),
  lastTime: t('2026-10-06T05:35:00Z'),
}

test('タイトル・期間・発言数を先頭に出す（タイトルも無害化）', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0 })
  // 画像は同じ場所（'self'）のものだけを許す。file: や iframe（frame-src）は許さない
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'sha256-${PAGE_SCRIPT_SHA256}'">`)
  expect(html).not.toContain('file:')
  expect(html).not.toContain('frame-src')
  expect(html).toContain('<title>テストの&lt;会話&gt;</title>')
  expect(html).toContain('2026/10/06（火）14:32 〜 2026/10/06（火）14:35・発言 2 件')
})

test('自分の発言は右（me）に、無害化して改行を保って出す', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0 })
  expect(html).toContain('<div class="row me" id="m1"><div class="bubble">&lt;script&gt;x&lt;/script&gt;<br>二行目</div><div class="meta">')
  // ページの中のスクリプトは、コピーのスクリプトの1つだけ（会話の中身はスクリプトにならない）
  expect(html.split('<script>').length - 1).toBe(1)
  expect(html).toContain(`<script>${PAGE_SCRIPT}</script>`)
})

test('Claude の発言は左（claude）に、Markdown を整形して出す', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0 })
  expect(html).toContain('<div class="row claude"><div class="avatar claude-code" title="Claude Code">✳</div><div class="bubble"><p><strong>太字</strong></p>')
  expect(html).toContain('<table>')
})

test('ツールは件数と内訳つきで折りたたむ', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0 })
  expect(html).toContain('<summary>🔧 ツール 3件（Bash 2・Read 1）・エラー 1</summary>')
  expect(html).toContain('<pre>not found</pre>')
})

test('compact ではツールの結果を省く', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0, compact: true })
  expect(html).not.toContain('<pre>not found</pre>')
  expect(html).toContain('<pre class="summary">ls</pre>')
})

test('区切り・お知らせ・読めなかった行の件数', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 2 })
  expect(html).toContain('<div class="sep"><span>2026/10/06（火）14:32</span></div>')
  expect(html).toContain('<div class="notice">/model opus</div>')
  expect(html).toContain('読めなかった行: 3 行（壊れた行 1・大きすぎる行 2）')
})

test('タイトルが無ければセッション ID を使う', () => {
  const html = renderHtml({ ...base, title: undefined }, { sessionId: 'sess-1', tooLongLines: 0 })
  expect(html).toContain('<title>sess-1</title>')
})

test('古い部分を省略したときは、先頭に知らせる', () => {
  const html = renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0, omittedLines: 120, omittedItems: 3 })
  expect(html).toContain('<p class="omitted">記録が大きいため、古い部分を省略しています（読まなかった行 120・省いた項目 3）</p>')
  expect(renderHtml(base, { sessionId: 'sess-1', tooLongLines: 0 })).not.toContain('class="omitted"')
})

const bytes = (html: string) => new TextEncoder().encode(html).length
const opts = { sessionId: 'sess-1', tooLongLines: 0 }

test('renderHtmlWithin: 上限に収まれば、そのまま', () => {
  const full = renderHtml(base, opts)
  expect(renderHtmlWithin(base, opts, bytes(full))).toBe(full)
})

test('renderHtmlWithin: 収まらなければ、まずツールの結果を省く', () => {
  const full = renderHtml(base, opts)
  expect(renderHtmlWithin(base, opts, bytes(full) - 1)).toBe(renderHtml(base, { ...opts, compact: true }))
})

test('renderHtmlWithin: それでも収まらなければ、古い項目から省き、新しい項目は残す', () => {
  const compact = renderHtml(base, { ...opts, compact: true })
  const html = renderHtmlWithin(base, opts, bytes(compact) - 1)
  expect(bytes(html)).toBeLessThanOrEqual(bytes(compact) - 1)
  expect(html).toContain('省いた項目')
  expect(html).not.toContain('&lt;script&gt;x') // 最初の発言（自分）は省かれる
  expect(html).toContain('<div class="notice">/model opus</div>') // 最後の項目は残る
})

test('長い発言（30行を超える）は、先頭5行だけを見せて折りたたむ（開くと全文）', () => {
  const text = Array.from({ length: 31 }, (_, i) => `行 ${i}`).join('\n\n')
  const html = renderHtml({ ...base, items: [{ kind: 'message', side: 'claude', time: t('2026-10-06T05:32:00Z'), text }] }, opts)
  const preview = /<div class="preview">([\s\S]*?)<\/div><details class="long">/.exec(html)?.[1] ?? ''
  expect(preview).toContain('<p>行 2</p>')
  expect(preview).not.toContain('行 3')
  expect(html).toContain('<summary><span class="open">▶ 続きを読む（全 61 行）</span><span class="close">▲ 閉じる</span></summary>')
  expect(html).toContain('<p>行 30</p></details>')
})

test('300字以上の発言は、先頭150字だけを見せて折りたたむ。299字までは折りたたまない', () => {
  const message = (text: string) => renderHtml({ ...base, items: [{ kind: 'message', side: 'me', time: t('2026-10-06T05:32:00Z'), text }] }, opts)
  expect(message('あ'.repeat(300))).toContain(`<div class="preview">${'あ'.repeat(150)}…</div><details class="long"><summary><span class="open">▶ 続きを読む</span>`)
  expect(message('あ'.repeat(299))).not.toContain('class="long"')
  expect(renderHtml(base, opts)).not.toContain('class="long"')
})

test('自分の発言の目次を出し、押すとその発言へ飛べる（1行目だけ・無害化）', () => {
  const html = renderHtml(base, opts)
  expect(html).toContain('<details class="toc"><summary>自分の発言（1）</summary><ol><li><a href="#m1"><time>14:32</time>&lt;script&gt;x&lt;/script&gt;…</a></li></ol></details>')
  const noMine = renderHtml({ ...base, items: base.items.filter((item) => item.kind !== 'message' || item.side !== 'me') }, opts)
  expect(noMine).not.toContain('class="toc"')
})

test('「先頭へ」「最新へ」のページ内リンクと、その飛び先', () => {
  const html = renderHtml(base, opts)
  expect(html).toContain('<body><div id="top"></div><header>') // 貼り付くヘッダではなく、一番上の空の印へ飛ぶ
  expect(html).toContain('<div id="latest"></div>')
  // ボタンはヘッダの右端（右下に固定すると、右寄せの自分の吹き出しと重なるため）
  expect(html).toContain('<span class="hits"></span><a href="#top">▲ 先頭へ</a><a href="#latest">▼ 最新へ</a><button class="reload"')
})

test('ヘッダの左端に検索欄。処理は CSP でハッシュを許したスクリプトの中にある', () => {
  const html = renderHtml(base, opts)
  expect(html).toContain(
    '<nav class="jump"><input class="find" type="search" placeholder="検索" aria-label="会話内を検索" title="Enter で次、Shift+Enter で前（最初は一番新しいもの）、Esc で消す"><span class="hits"></span>',
  )
  // 探すのは発言とツールの中（main）だけ。折りたたみの先頭の再掲・見出し・時刻・ボタンは除く
  expect(PAGE_SCRIPT).toContain("document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)")
  expect(PAGE_SCRIPT).toContain("closest('.preview, summary, .meta, time')")
  // 移った先の折りたたみを開く。日本語入力の確定の Enter では動かない。読み直しても続けられるよう残す
  expect(PAGE_SCRIPT).toContain("if (el.tagName === 'DETAILS') el.open = true")
  expect(PAGE_SCRIPT).toContain("if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229)")
  expect(PAGE_SCRIPT).toContain("sessionStorage.setItem('lime-find'")
})

test('「最新へ」の隣に ↻（読み直す）のボタン。説明（title）に HTML を作った時刻を出す', () => {
  const html = renderHtml(base, { ...opts, builtAt: t('2026-10-14T23:40:00Z') })
  expect(html).toContain(
    '<a href="#latest">▼ 最新へ</a><button class="reload" type="button" title="最終更新 2026/10/15（木）08:40。押すと読み直す" aria-label="読み直す">↻</button></nav></header>',
  )
  // 作った時刻を渡さなければ、説明だけ
  expect(renderHtml(base, opts)).toContain('<button class="reload" type="button" title="押すと読み直す"')
  // 押したときの処理は、CSP でハッシュを許したスクリプトの中にある（インラインの onclick は CSP で動かないので使わない）
  expect(PAGE_SCRIPT).toContain("if (e.target instanceof Element && e.target.closest('button.reload')) location.reload()")
  expect(html).not.toContain('onclick')
})

test('発言ごとにコピーのボタンを付け、元の文（Markdown のまま・無害化して）を持たせる', () => {
  const html = renderHtml(base, opts)
  expect(html).toContain('<button class="copy" type="button" title="コピー" aria-label="コピー" data-copy="&lt;script&gt;x&lt;/script&gt;\n二行目">')
  expect(html).toContain('data-copy="**太字**\n\n| a | b |\n|---|---|\n| 1 | 2 |"')
  // ツールのまとまりには付けない
  expect(html.split('class="copy"').length - 1).toBe(2)
})

test('ページのスクリプト（コピー・↻・検索）のハッシュが、CSP に書いた値と一致する（スクリプトを変えたら値も変える）', async () => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PAGE_SCRIPT)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  expect(btoa(binary)).toBe(PAGE_SCRIPT_SHA256)
})

// ── 縮小画像 ──

const shot = { kind: 'message', side: 'claude', time: t('2026-10-06T05:33:00Z'), text: '作りました\n/x/a.png\n説明の行\n/x/b.html' } as const satisfies Item
const thumb = (src: string, name: string) =>
  `<span class="thumbs"><span class="thumb"><img src="${src}" alt="${name}" loading="lazy"><span class="cap">${name}</span></span></span>`

test('縮小画像は、パスを書いた行のすぐ下に置く（src は HTML からの相対パス、ファイル名は無害化してキャプションにする）', () => {
  const previews = new Map<Item, MessagePreviews>([
    [shot, new Map([['/x/a.png', { src: 'sess-1-assets/0123.png', name: 'a.png' }], ['/x/b.html', { src: 'sess-1-assets/"x<.png', name: '<b>"&.html' }]])],
  ])
  const html = renderHtml({ ...base, items: [shot] }, { ...opts, previews })
  // 縮小画像の箱が行の区切りを兼ねるので、その行の後ろには <br> を入れない
  expect(html).toContain(
    `<p>作りました<br>/x/a.png${thumb('sess-1-assets/0123.png', 'a.png')}説明の行<br>/x/b.html${thumb('sess-1-assets/&quot;x&lt;.png', '&lt;b&gt;&quot;&amp;.html')}</p>`,
  )
  expect(html).not.toContain('<b>"&')
})

test('縮小画像が無い発言には何も足さない（空の表も足さない）。別の発言の縮小画像は、その発言にだけ付く', () => {
  expect(renderHtml({ ...base, items: [shot] }, opts)).not.toContain('class="thumbs"')
  const empty = new Map<Item, MessagePreviews>([[shot, new Map()]])
  expect(renderHtml({ ...base, items: [shot] }, { ...opts, previews: empty })).not.toContain('class="thumbs"')
  const other = { ...shot, text: '/x/a.png' }
  const previews = new Map<Item, MessagePreviews>([[shot, new Map([['/x/a.png', { src: 's-assets/1.png', name: 'a.png' }]])]])
  const html = renderHtml({ ...base, items: [other, shot] }, { ...opts, previews })
  expect(html.split('class="thumbs"').length - 1).toBe(1)
  expect(html).toContain('<p>/x/a.png</p></div>')
})

test('箇条書き・コード・表では、その行・まとまりのすぐ下に置く', () => {
  const text = ['- [図](</x/a.png>)', '- 次', '', '```', '/x/b.png', '```', '', '| a |', '|---|', '| [表](/x/c.png) |'].join('\n')
  const item = { ...shot, text }
  const table = new Map([
    ['/x/a.png', { src: 's/1.png', name: 'a.png' }],
    ['/x/b.png', { src: 's/2.png', name: 'b.png' }],
    ['/x/c.png', { src: 's/3.png', name: 'c.png' }],
  ])
  const html = renderHtml({ ...base, items: [item] }, { ...opts, previews: new Map([[item, table]]) })
  expect(html).toContain(`[図](&lt;/x/a.png&gt;)${thumb('s/1.png', 'a.png')}</li><li`)
  expect(html).toContain(`</code></pre>${thumb('s/2.png', 'b.png')}`)
  expect(html).toContain(`</table></div>${thumb('s/3.png', 'c.png')}`)
})

test('自分の発言でも、パスの行の下に置く。長い発言の折りたたんだ部分にあるパスは、開いたときに出る', () => {
  const mine = { ...shot, side: 'me' as const, text: '作りました\n/x/a.png\nおわり' }
  const previews = new Map<Item, MessagePreviews>([[mine, new Map([['/x/a.png', { src: 's-assets/1.png', name: 'a.png' }]])]])
  expect(renderHtml({ ...base, items: [mine] }, { ...opts, previews })).toContain(
    `<div class="row me" id="m1"><div class="bubble">作りました<br>/x/a.png${thumb('s-assets/1.png', 'a.png')}おわり</div>`,
  )
  const long = { ...mine, text: `${'あ'.repeat(1501)}\n/x/a.png` }
  const html = renderHtml({ ...base, items: [long] }, { ...opts, previews: new Map([[long, new Map([['/x/a.png', { src: 's-assets/1.png', name: 'a.png' }]])]]) })
  expect(html.indexOf('<details class="long">')).toBeLessThan(html.indexOf('class="thumbs"'))
  // renderHtmlWithin で古い項目を省いても、残った発言の縮小画像は付いたまま
  const items: Item[] = [...base.items, mine]
  const compact = renderHtml({ ...base, items }, { ...opts, compact: true, previews })
  const within = renderHtmlWithin({ ...base, items }, { ...opts, previews }, bytes(compact) - 1)
  expect(within).toContain('省いた項目')
  expect(within).toContain('<img src="s-assets/1.png"')
})

test('同じファイルを違う書き方で2回書いたら（絶対パスと ~/）、それぞれの行の下に出す', () => {
  const twice = { ...shot, text: '/h/a.png\nあいだ\n~/a.png' }
  const preview = { src: 's/1.png', name: 'a.png' }
  const previews = new Map<Item, MessagePreviews>([[twice, new Map([['/h/a.png', preview], ['~/a.png', preview]])]])
  const html = renderHtml({ ...base, items: [twice] }, { ...opts, previews })
  expect(html).toContain(`<p>/h/a.png${thumb('s/1.png', 'a.png')}あいだ<br>~/a.png${thumb('s/1.png', 'a.png')}</p>`)
})

// ── Codex の会話を混ぜたとき ──

test('Codex の返事は >_ のアイコンと色を変えた吹き出し、Codex への依頼は色を変えて名札を付ける。目次には出さない', () => {
  const origin = { agent: 'codex' as const, session: '01a0d73b-4995-7c1d' }
  const items: Item[] = [
    { kind: 'message', side: 'me', time: t('2026-10-06T05:32:00Z'), text: 'Claude への発言' },
    { kind: 'message', side: 'me', time: t('2026-10-06T05:33:00Z'), text: 'Codex への依頼', origin },
    { kind: 'tools', time: t('2026-10-06T05:33:30Z'), tools: [{ name: 'exec', summary: 'npm test', result: 'ok', isError: false }], origin },
    { kind: 'message', side: 'claude', time: t('2026-10-06T05:34:00Z'), text: 'Codex の返事', origin },
  ]
  const html = renderHtml({ ...base, items }, opts)
  expect(html).toContain('<div class="row claude"><div class="avatar codex" title="Codex">&gt;_</div><div class="bubble codex"><p>Codex の返事</p></div>')
  expect(html).toContain('<span class="tag">Codex·01a0d73b</span>')
  expect(html).toContain('<div class="row me"><div class="bubble to-codex">Codex への依頼</div>')
  expect(html).toContain('<span class="tag">Codex へ·01a0d73b</span>')
  expect(html).toContain('<div class="row claude"><div class="avatar codex" title="Codex">&gt;_</div><details class="tools"><summary>🔧 Codex のツール 1件（exec 1）</summary>')
  // 目次には Claude Code の会話の自分の発言だけ
  expect(html).toContain('<summary>自分の発言（1）</summary>')
})
