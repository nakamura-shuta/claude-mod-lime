// HTML に埋め込む固定の部品: CSS と、コピー・↻・検索のスクリプト（CSP で許すハッシュ付き）。

export const CSS = `
:root{color-scheme:light}
body{margin:0;background:#7494c0;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;font-size:14px;color:#111}
header{position:sticky;top:0;background:#273246;color:#fff;padding:10px 14px;z-index:1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px}
header .title{flex:1 1 200px;min-width:0}
header h1{font-size:15px;margin:0;overflow-wrap:anywhere}
header p{font-size:11px;margin:2px 0 0;opacity:.8}
main{padding:10px 10px 40px;max-width:900px;margin:0 auto}
.row{display:flex;align-items:flex-end;gap:6px;margin:8px 0}
.row.me{flex-direction:row-reverse}
.bubble{max-width:80%;padding:8px 12px;border-radius:16px;line-height:1.55;overflow-wrap:anywhere;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.me .bubble{background:#8de055;border-top-right-radius:4px}
.claude .bubble{background:#fff;border-top-left-radius:4px}
.avatar{flex-shrink:0;align-self:flex-start;width:28px;height:28px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.avatar.claude-code{color:#d97757}
.avatar.codex{background:#111;color:#fff;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:-.5px}
.claude .bubble.codex{background:#efe7ff}
.me .bubble.to-codex{background:#d9ccff}
.meta .tag{font-size:10px;color:#eef;white-space:nowrap}
time{font-size:10px;color:#eef;white-space:nowrap}
.sep{text-align:center;margin:14px 0}
.sep span{background:rgba(0,0,0,.25);color:#fff;font-size:11px;padding:3px 10px;border-radius:10px}
.notice{text-align:center;font-size:11px;color:#f4f6fa;margin:6px 0}
.tools{max-width:80%;background:rgba(255,255,255,.75);border-radius:12px;padding:6px 10px;font-size:12px}
.tools summary{cursor:pointer}
.tools ul{list-style:none;padding:0;margin:6px 0 0}
.tools li{border-top:1px solid #ddd;padding:4px 0}
.tools li.error .tool-name{color:#c0392b}
.tool-name{font-weight:600}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font-size:11px;background:#f4f4f4;padding:6px;border-radius:6px}
pre.summary{background:#eef2f7}
.bubble pre{font-size:12px}
.bubble code{background:#f0f0f0;padding:1px 4px;border-radius:4px;font-size:12px}
.bubble pre code{background:none;padding:0}
.bubble p{margin:0 0 6px}
.bubble p:last-child{margin-bottom:0}
.bubble h3,.bubble h4,.bubble h5,.bubble h6{margin:8px 0 4px;font-size:14px}
.bubble ul,.bubble ol{margin:4px 0;padding-left:20px}
.bubble li.lv1{margin-left:16px}
.bubble li.lv2{margin-left:32px}
.bubble li.lv3,.bubble li.lv4{margin-left:48px}
.bubble li.bullet{list-style-type:disc}
.bubble li.num{list-style-type:decimal}
.bubble blockquote{margin:4px 0;padding-left:8px;border-left:3px solid #ccc;color:#555}
.table{overflow-x:auto}
.bubble table{border-collapse:collapse;font-size:12px;margin:4px 0}
.bubble th,.bubble td{border:1px solid #ddd;padding:3px 6px;text-align:left}
.bubble th{background:#f6f6f6}
.bubble a{color:#0b65c2}
.footer{text-align:center;font-size:11px;color:#fff;padding-bottom:20px}
.omitted{background:#fff3cd;color:#664d03;font-size:12px;padding:6px 14px;margin:0}
.bubble:has(details.long[open])>.preview{display:none}
details.long>summary{cursor:pointer;list-style:none;color:#0b65c2;font-size:12px;margin-top:4px}
details.long>summary::-webkit-details-marker{display:none}
details.long[open]>summary{margin:0 0 6px}
details.long .close,details.long[open] .open{display:none}
details.long[open] .close{display:inline}
.row[id]{scroll-margin-top:64px}
.toc{background:#fff;margin:0;padding:6px 14px;font-size:12px}
.toc summary{cursor:pointer;color:#0b65c2}
.toc ol{margin:6px 0 2px;padding-left:24px;max-height:40vh;overflow-y:auto}
.toc li{margin:2px 0}
.toc a{color:#111;text-decoration:none}
.toc a:hover{text-decoration:underline}
.toc time{color:#888;margin-right:8px;font-size:11px}
.jump{display:flex;gap:6px;flex-shrink:0;margin-left:auto}
.jump a,.jump .reload{background:rgba(255,255,255,.15);color:#fff;font-size:12px;padding:4px 10px;border-radius:12px;text-decoration:none;white-space:nowrap}
.jump a:hover,.jump .reload:hover{background:rgba(255,255,255,.3)}
.jump .reload{border:0;font-family:inherit;line-height:inherit;padding:4px 8px;cursor:pointer}
.find{width:9em;min-width:0;font:inherit;font-size:12px;padding:3px 8px;border:0;border-radius:12px}
.hits{align-self:center;font-size:11px;opacity:.8;white-space:nowrap}
mark{background:#ffe066;color:inherit;border-radius:2px}
mark.cur{background:#ff9632}
.meta{display:flex;flex-direction:column;align-items:center;gap:2px}
.copy{border:0;background:none;padding:2px;cursor:pointer;color:#eef;opacity:.6;line-height:0}
.copy:hover{opacity:1}
.copy.done svg,.copy.fail svg{display:none}
.copy.done::after{content:"✓";font-size:13px;line-height:14px}
.copy.fail::after{content:"×";font-size:13px;line-height:14px}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}
.thumb{display:block;min-width:0;max-width:min(240px,100%)}
.thumb img{display:block;max-width:100%;max-height:240px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid rgba(0,0,0,.12)}
.thumb .cap{display:block;font-size:11px;color:#555;margin-top:2px}
`

// ページのスクリプト（コピー・↻・検索）。
// コピーのボタンは、その発言の元の文（ボタンの data-copy。Claude の発言は Markdown のまま）をクリップボードに入れる。
// ↻ のボタンはページを読み直す（自動更新の読み込み直しが届かなかったときの保険）。
// CSP はこのスクリプトだけをハッシュ（sha256）で許すので、インラインの onclick なども動かない。ページの処理はすべてここに書く。
// PAGE_SCRIPT を一字でも変えたら、PAGE_SCRIPT_SHA256 も直す（テストで一致を確かめている）
export const PAGE_SCRIPT = [
  "document.addEventListener('click', function (e) {",
  "  var button = e.target instanceof Element ? e.target.closest('button.copy') : null",
  '  if (!button) return',
  "  var text = button.getAttribute('data-copy') || ''",
  '  // 押したことが分かるよう、1.5秒だけ ✓（できなかったら ×）を出す',
  '  var show = function (ok) {',
  "    button.classList.add(ok ? 'done' : 'fail')",
  "    setTimeout(function () { button.classList.remove('done', 'fail') }, 1500)",
  '  }',
  '  // クリップボードの API が使えないときは、見えない入力欄に入れて選び、コピーの命令を出す（古い方法）',
  '  var fallback = function () {',
  "    var area = document.createElement('textarea')",
  '    area.value = text',
  "    area.setAttribute('readonly', '')",
  "    area.style.position = 'fixed'",
  "    area.style.opacity = '0'",
  '    document.body.appendChild(area)',
  '    area.select()',
  '    var ok = false',
  "    try { ok = document.execCommand('copy') } catch (error) {}",
  '    area.remove()',
  '    show(ok)',
  '  }',
  '  if (navigator.clipboard && window.isSecureContext) {',
  '    navigator.clipboard.writeText(text).then(function () { show(true) }, fallback)',
  '  } else {',
  '    fallback()',
  '  }',
  '})',
  '// ↻ のボタン: ページを読み直す',
  "document.addEventListener('click', function (e) {",
  "  if (e.target instanceof Element && e.target.closest('button.reload')) location.reload()",
  '})',
  '// 検索: 入力した文字（大文字と小文字は区別しない）に印（mark）を付ける。Enter で次、Shift+Enter で前（最初の Shift+Enter は一番新しい一致）、Esc で消す。',
  '// 折りたたみ（details）の中も探し、移った先の折りたたみは開く。自動更新で読み直しても続けられるよう、文字と位置は sessionStorage に残す',
  ';(function () {',
  "  var input = document.querySelector('input.find')",
  "  var hits = document.querySelector('.hits')",
  '  if (!input || !hits) return',
  '  var marks = []',
  '  var current = -1',
  '  var timer',
  '  var save = function () {',
  "    try { sessionStorage.setItem('lime-find', JSON.stringify({ q: input.value, i: current })) } catch (error) {}",
  '  }',
  '  var clear = function () {',
  '    marks.forEach(function (mark) {',
  '      var parent = mark.parentNode',
  '      parent.replaceChild(mark.firstChild, mark)',
  '      parent.normalize()',
  '    })',
  '    marks = []',
  '    current = -1',
  '  }',
  '  // 発言とツールの中の文字だけを探す（折りたたみの先頭の再掲・見出し・時刻・ボタンは除く）',
  '  var search = function () {',
  '    clearTimeout(timer)',
  '    timer = undefined',
  '    clear()',
  '    var needle = input.value.toLowerCase()',
  '    if (needle) {',
  "      var walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)",
  '      var nodes = []',
  "      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.preview, summary, .meta, time')) nodes.push(walker.currentNode)",
  '      nodes.forEach(function (node) {',
  '        var lower = node.data.toLowerCase()',
  '        // 小文字にすると長さが変わる文字（まれ）を含む段落は、そのままの文字で探す',
  '        if (lower.length !== node.data.length) lower = node.data',
  '        for (var at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle)) {',
  '          var match = node.splitText(at)',
  '          node = match.splitText(needle.length)',
  '          lower = lower.slice(at + needle.length)',
  "          var mark = document.createElement('mark')",
  '          match.parentNode.replaceChild(mark, match)',
  '          mark.appendChild(match)',
  '          marks.push(mark)',
  '        }',
  '      })',
  '    }',
  "    hits.textContent = needle ? marks.length + ' 件' : ''",
  '    save()',
  '  }',
  '  var show = function (scroll) {',
  '    var mark = marks[current]',
  "    mark.classList.add('cur')",
  "    for (var el = mark.parentElement; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true",
  "    if (scroll) mark.scrollIntoView({ block: 'center' })",
  "    hits.textContent = current + 1 + ' / ' + marks.length",
  '    save()',
  '  }',
  '  var go = function (step) {',
  '    if (timer !== undefined) search()',
  '    if (!marks.length) return',
  "    if (current >= 0) marks[current].classList.remove('cur')",
  '    current = current < 0 ? (step > 0 ? 0 : marks.length - 1) : (current + step + marks.length) % marks.length',
  '    show(true)',
  '  }',
  "  input.addEventListener('input', function () {",
  '    clearTimeout(timer)',
  '    timer = setTimeout(search, 300)',
  '  })',
  "  input.addEventListener('keydown', function (e) {",
  '    // 日本語入力の確定の Enter（isComposing、Safari 系は keyCode 229）では動かない',
  "    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {",
  '      e.preventDefault()',
  '      go(e.shiftKey ? -1 : 1)',
  "    } else if (e.key === 'Escape') {",
  '      e.preventDefault()',
  "      input.value = ''",
  '      search()',
  '    }',
  '  })',
  '  // 読み直す前の検索を戻す。移った先の折りたたみは開くが、位置は動かさない（読み直し前の位置は cmux が保つ）',
  '  try {',
  "    var saved = JSON.parse(sessionStorage.getItem('lime-find') || 'null')",
  '    if (saved && saved.q) {',
  '      input.value = saved.q',
  '      search()',
  '      if (saved.i >= 0 && saved.i < marks.length) {',
  '        current = saved.i',
  '        show(false)',
  '      }',
  '    }',
  '  } catch (error) {}',
  '})()',
].join('\n')
export const PAGE_SCRIPT_SHA256 = '1DnA5di+Z713OT/tZPYf733aS7tG2zaCInCn0z5OL5U='
