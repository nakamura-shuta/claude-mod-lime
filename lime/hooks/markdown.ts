// Claude の文章（Markdown）を HTML にする。先にすべての文字を無害化してから、対応する書き方だけを要素にする。
// 対応: 見出し・太字・斜体・インラインコード・コードブロック・リスト・表・リンク（http/https のみ）・引用・区切り線。
// 正規表現は、どれも入力の長さにほぼ比例する時間で終わる形にする（長い会話でもフックの 10 秒に収まるように）。

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 太字と斜体。斜体は閉じの直前が空白でないものだけ（`*args, **kwargs` を斜体にしない） */
const emphasis = (s: string) =>
  s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<em>$2</em>')

/** 無害化済みの1行に、インラインの書き方を当てる */
function inline(escaped: string): string {
  // インラインコードと完成したリンクは退避し、太字・斜体の置換が中身（href を含む）に入らないようにする。
  // 退避の印の \u0000 は renderMarkdown が入力から除いてあるので、偽造されない
  const kept: string[] = []
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)] ?? '')
  let s = escaped.replace(/`([^`]+)`/g, (_match, code: string) => keep(`<code>${code}</code>`))
  s = s.replace(/\[([^\[\]]+)\]\((https?:\/\/[^\s()\u0000]+)\)/g, (_match, label: string, url: string) =>
    keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${restore(emphasis(label))}</a>`),
  )
  return restore(emphasis(s))
}

const renderLine = (line: string) => inline(escapeHtml(line))

/** 表の1行をセルに分ける。インラインコードの中の `|` と `\|` では分けない */
function tableCells(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let k = 0; k < body.length; k++) {
    const ch = body[k] ?? ''
    if (ch === '\\' && body[k + 1] === '|') {
      cell += '|'
      k++
      continue
    }
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += ch
  }
  cells.push(cell.trim())
  return cells
}

/**
 * 行を <br> でつなぐ。after が行の後ろに足すもの（縮小画像）を返したら、<br> の代わりにそれを置く
 * （足すものは行の幅いっぱいの箱なので、<br> も入れると空の行が1つ増える）
 */
export function joinLines(lines: string[], render: (line: string) => string, after?: (line: string) => string): string {
  return lines
    .map((line, index) => {
      const extra = after?.(line) ?? ''
      return render(line) + (extra !== '' ? extra : index === lines.length - 1 ? '' : '<br>')
    })
    .join('')
}

/**
 * Markdown を HTML にする。after を渡すと元の行ごとに呼び、返した HTML をその行の後ろに置く（縮小画像をパスの行の下に出す）。
 * 段落とリストは行ごと、コード・表・見出し・引用はまとまりの後ろに置く。after が返すものは、呼ぶ側で無害化しておく
 */
export function renderMarkdown(text: string, after?: (line: string) => string): string {
  // 行の区切りを \n に揃える（U+2028/U+2029 は「.」に一致せず、リストの処理が進まなくなる）。
  // \u0000 は inline() の退避の印なので、U+FFFD に置き換える
  const lines = text.replace(/\u0000/g, '\uFFFD').replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) out.push(`<p>${joinLines(paragraph, renderLine, after)}</p>`)
    paragraph = []
  }
  // まとまり（コード・表・見出し・引用）の元の行について、後ろに足すものをまとめて返す
  const afterBlock = (source: string[]) => (after === undefined ? '' : source.map(after).join(''))

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (/^\s*```/.test(line)) {
      flushParagraph()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i++
      }
      i++ // 閉じの ``` を飛ばす（無ければ末尾まで読んだことになる）
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>${afterBlock(body)}`)
      continue
    }

    if (/^\s*\|/.test(line) && /^\s*(?:\|\s*)?:?-{3,}/.test(lines[i + 1] ?? '')) {
      flushParagraph()
      const header = tableCells(line)
      const rows: string[][] = []
      const source = [line]
      i += 2
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? '')) {
        rows.push(tableCells(lines[i] ?? ''))
        source.push(lines[i] ?? '')
        i++
      }
      const th = header.map((cell) => `<th>${renderLine(cell)}</th>`).join('')
      const trs = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderLine(cell)}</td>`).join('')}</tr>`).join('')
      out.push(`<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>${afterBlock(source)}`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = Math.min((heading[1] ?? '#').length + 2, 6) // 吹き出しの中なので h3〜h6 に抑える
      out.push(`<h${level}>${renderLine(heading[2] ?? '')}</h${level}>${afterBlock([line])}`)
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph()
      out.push('<hr>')
      i++
      continue
    }

    const listStart = /^\s*([-*]|\d+\.)\s+/.exec(line)
    if (listStart) {
      flushParagraph()
      const ordered = /\d/.test(listStart[1] ?? '')
      const items: string[] = []
      while (i < lines.length) {
        const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i] ?? '')
        if (!item) break
        const level = Math.min(Math.floor((item[1] ?? '').length / 2), 4)
        const marker = item[2] ?? ''
        const isOrdered = /\d/.test(marker)
        // 一番外側で種類が変わったらリストを分ける。入れ子なら種類が違っても同じリストに続ける
        if (level === 0 && isOrdered !== ordered) break
        // 番号は元の数字をそのまま出す（途中でリストが分かれても番号がずれないように）
        const value = isOrdered ? ` value="${Number.parseInt(marker, 10)}"` : ''
        const kind = isOrdered === ordered ? '' : isOrdered ? ' num' : ' bullet'
        items.push(`<li class="lv${level}${kind}"${value}>${renderLine(item[3] ?? '')}${after?.(lines[i] ?? '') ?? ''}</li>`)
        i++
      }
      if (items.length === 0) {
        // 念のため: 行を読み進められなかったときは段落として扱う（無限ループを防ぐ）
        paragraph.push(line)
        i++
        continue
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const quoted: string[] = []
      const source: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        source.push(lines[i] ?? '')
        quoted.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${quoted.map(renderLine).join('<br>')}</blockquote>${afterBlock(source)}`)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      i++
      continue
    }

    paragraph.push(line)
    i++
  }
  flushParagraph()
  return out.join('\n')
}
