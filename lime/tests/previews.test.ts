import { expect, test } from 'claude-code/testing'
import { extractPaths, fileName, previewKind, previewTargets, resolvePath } from '../hooks/previews'

test('Markdown のリンク: 山かっこ付き（スペース・日本語を含む）・/ と ~/ で始まるもの。%20 などは戻す', () => {
  const text = [
    'スライドは [こちら](</Users/me/スライド置き場 - 勉強会/deck.html>) です',
    '図: [図1](/Users/me/out/fig%201.png) と [図2](~/Desktop/shot.jpg)',
    '[エンコード](</Users/me/%E3%82%B9%E3%83%A9%E3%82%A4%E3%83%89%E7%BD%AE%E3%81%8D%E5%A0%B4%20-%202026/deck.html>)',
    '![画像](/abs/pic.webp)',
  ].join('\n')
  expect(extractPaths(text)).toEqual([
    '/Users/me/スライド置き場 - 勉強会/deck.html',
    '/Users/me/スライド置き場 - 2026/deck.html',
    '/Users/me/out/fig 1.png',
    '~/Desktop/shot.jpg',
    '/abs/pic.webp',
  ])
})

test('戻せない % はそのまま。Markdown のリンクの相対パスは拾わない', () => {
  expect(extractPaths('[a](/x/100%.png) [b](docs/a.png) [c](<docs/b.png>)')).toEqual(['/x/100%.png'])
})

test('1行に単独で書かれたパス（前後の空白・囲みのバッククォートは許す）: 絶対パス・~/・相対パス', () => {
  const text = ['作りました。', '  /Users/me/out/a.png  ', '`~/Desktop/b.pdf`', '``docs/c d.html``', 'my_docs/report.htm'].join('\n')
  expect(extractPaths(text)).toEqual(['/Users/me/out/a.png', '~/Desktop/b.pdf', 'docs/c d.html', 'my_docs/report.htm'])
})

test('文中にインラインで出てくるだけのファイル名は拾わない', () => {
  const text = [
    '`slides-loop.md` を直しました',
    '`/Users/me/out/a.png` を作りました',
    '直したのは /Users/me/out/a.png です',
    '直したのは `a.png`',
    '- /Users/me/out/a.png',
  ].join('\n')
  expect(extractPaths(text)).toEqual([])
  // 文の行（句読点・コロン・箇条書き）は、相対パスとしても調べない
  expect(extractPaths('画像はこちら: out/a.png\n修正、out/b.png\n* out/c.png\n1. out/d.png')).toEqual([])
})

test('http(s):// などの外のリンクは拾わない', () => {
  const text = ['https://example.com/a.png', '[x](https://example.com/b.png)', '[y](<http://example.com/c.pdf>)', '`http://example.com/d.html`', 'file:///Users/me/e.png'].join('\n')
  expect(extractPaths(text)).toEqual([])
})

test('対象外の拡張子（md・txt・拡張子なし）は拾わない。拡張子の大文字小文字は問わない', () => {
  expect(extractPaths('/a/b.md\n/a/c.txt\n/a/d\n/a/E.PNG\n/a/f.HEIC')).toEqual(['/a/E.PNG', '/a/f.HEIC'])
  expect(previewKind('/a/x.svg')).toBe('svg')
  expect(previewKind('/a/x.JPEG')).toBe('image')
  expect(previewKind('/a/x.htm')).toBe('html')
  expect(previewKind('/a/x.pdf')).toBe('pdf')
  expect(previewKind('/a/x.png.bak')).toBeUndefined()
})

test('resolvePath: 相対パスは発言の cwd を基準にし、. と .. をたたむ。~/ は HOME。決められなければ undefined', () => {
  expect(resolvePath('docs/a.png', '/h/proj', '/h')).toBe('/h/proj/docs/a.png')
  expect(resolvePath('./docs/../b.png', '/h/proj/', '/h')).toBe('/h/proj/b.png')
  expect(resolvePath('../c.png', '/h/proj', '/h')).toBe('/h/c.png')
  expect(resolvePath('~/d.png', '/h/proj', '/h')).toBe('/h/d.png')
  expect(resolvePath('/x//y/./e.png', undefined, '/h')).toBe('/x/y/e.png')
  expect(resolvePath('docs/a.png', undefined, '/h')).toBeUndefined()
  expect(resolvePath('~other/a.png', '/h/proj', '/h')).toBeUndefined()
})

test('previewTargets: 書かれたままのパスと、絶対パス・種類の組にする。同じ書き方は1回だけ（書き方が違えば、同じファイルでも別の組）', () => {
  const text = ['a.png', '/h/proj/a.png', 'a.png', '[図](</h/proj/b c.pdf>)', 'notes.md'].join('\n')
  expect(previewTargets(text, '/h/proj', '/h')).toEqual([
    { candidate: '/h/proj/b c.pdf', target: { path: '/h/proj/b c.pdf', kind: 'pdf' } },
    { candidate: 'a.png', target: { path: '/h/proj/a.png', kind: 'image' } },
    { candidate: '/h/proj/a.png', target: { path: '/h/proj/a.png', kind: 'image' } },
  ])
})

test('fileName: パスの最後の部分', () => {
  expect(fileName('/a/スライド置き場 - 2026/deck.html')).toBe('deck.html')
})
