import { expect, test } from 'claude-code/testing'
import { escapeHtml, renderMarkdown } from '../hooks/markdown'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const NUL = String.fromCharCode(0)
const REPLACEMENT = String.fromCharCode(0xfffd)

test('HTML として意味のある文字はすべて無害化する', () => {
  expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;')
})

test('会話中の <script> は文字として出る', () => {
  const html = renderMarkdown('注意: <script>alert(1)</script>')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})

test('太字・斜体・インラインコード', () => {
  expect(renderMarkdown('**太字** と *斜体* と `**コード**`')).toBe('<p><strong>太字</strong> と <em>斜体</em> と <code>**コード**</code></p>')
})

test('リンクは http / https だけ', () => {
  expect(renderMarkdown('[公式](https://example.com/a?b=1&c=2)')).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">公式</a></p>')
  expect(renderMarkdown('[危険](javascript:alert(1))')).not.toContain('<a ')
})

test('見出し・リスト・引用・区切り線', () => {
  expect(renderMarkdown('## 見出し')).toBe('<h4>見出し</h4>')
  expect(renderMarkdown('- 一つ目\n  - 入れ子\n- 二つ目')).toBe('<ul><li class="lv0">一つ目</li><li class="lv1">入れ子</li><li class="lv0">二つ目</li></ul>')
  expect(renderMarkdown('1. 最初\n2. 次')).toBe('<ol><li class="lv0" value="1">最初</li><li class="lv0" value="2">次</li></ol>')
  expect(renderMarkdown('> 引用です')).toBe('<blockquote>引用です</blockquote>')
  expect(renderMarkdown('---')).toBe('<hr>')
})

test('コードブロックは中身を無害化し、Markdown として解釈しない', () => {
  expect(renderMarkdown('```ts\nconst a = "<b>**x**</b>"\n```')).toBe('<pre><code>const a = &quot;&lt;b&gt;**x**&lt;/b&gt;&quot;</code></pre>')
})

test('表', () => {
  const html = renderMarkdown('| 名前 | 値 |\n|---|---|\n| a | **1** |')
  expect(html).toBe('<div class="table"><table><thead><tr><th>名前</th><th>値</th></tr></thead><tbody><tr><td>a</td><td><strong>1</strong></td></tr></tbody></table></div>')
})

test('空行で段落を分け、段落内の改行は <br> にする', () => {
  expect(renderMarkdown('一行目\n二行目\n\n次の段落')).toBe('<p>一行目<br>二行目</p>\n<p>次の段落</p>')
})

test('U+2028 / U+2029 を含んでも止まらない（改行として扱う）', () => {
  expect(renderMarkdown(`- 項目${LINE_SEPARATOR}続き`)).toBe('<ul><li class="lv0">項目</li></ul>\n<p>続き</p>')
})

test('NUL 文字で退避の印を偽造できない', () => {
  expect(renderMarkdown(`a \`b\` c ${NUL}0${NUL}`)).toBe(`<p>a <code>b</code> c ${REPLACEMENT}0${REPLACEMENT}</p>`)
})

test('リンクの中に太字・斜体のタグが入らない', () => {
  expect(renderMarkdown('- 対象: *.example.com と [設定](https://example.com/*)')).toBe(
    '<ul><li class="lv0">対象: *.example.com と <a href="https://example.com/*" target="_blank" rel="noopener noreferrer">設定</a></li></ul>',
  )
  expect(renderMarkdown('**a [b](https://x/**)')).toBe('<p>**a <a href="https://x/**" target="_blank" rel="noopener noreferrer">b</a></p>')
})

test('番号付きリストは元の番号を value に出し、入れ子は種類が違っても同じリストに続ける', () => {
  expect(renderMarkdown('1. A\n   - sub\n2. B')).toBe('<ol><li class="lv0" value="1">A</li><li class="lv1 bullet">sub</li><li class="lv0" value="2">B</li></ol>')
  expect(renderMarkdown('1. A\n   1. A-1\n   2. A-2\n2. B')).toBe(
    '<ol><li class="lv0" value="1">A</li><li class="lv1" value="1">A-1</li><li class="lv1" value="2">A-2</li><li class="lv0" value="2">B</li></ol>',
  )
  // 項目の続きの行でリストが分かれても、番号はずれない
  expect(renderMarkdown('1. Step\n   desc\n2. Next')).toBe('<ol><li class="lv0" value="1">Step</li></ol>\n<p>   desc</p>\n<ol><li class="lv0" value="2">Next</li></ol>')
})

test('コードのような * は斜体にしない', () => {
  expect(renderMarkdown('def f(*args, **kwargs)')).toBe('<p>def f(*args, **kwargs)</p>')
})

test('表のセルは、インラインコードの中の | では分けない', () => {
  expect(renderMarkdown('| a | b |\n|---|---|\n| `x|y` | 2 |')).toBe(
    '<div class="table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td><code>x|y</code></td><td>2</td></tr></tbody></table></div>',
  )
})

test('危険なリンク（引用符入り・data:・大文字の HTTPS:・javascript:）はリンクにならない', () => {
  const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1)) [y](data:text/html,1) [z](HTTPS://a) [w](javascript:alert(1))')
  expect(html).not.toContain('<a ')
  expect(html).not.toContain('onmouseover="')
})

test('長い入力でもすぐ終わる（入力の長さの二乗の時間にならない）', () => {
  for (const input of [
    '['.repeat(200000),
    `| a |\n${' '.repeat(200000)}x`,
    '[a](https://x'.repeat(20000),
    `#${' '.repeat(200000)}x${LINE_SEPARATOR}`,
  ]) {
    const started = Date.now()
    renderMarkdown(input)
    expect(Date.now() - started).toBeLessThan(1000)
  }
})
