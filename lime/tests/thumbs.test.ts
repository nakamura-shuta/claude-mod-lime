import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { thumbCommands, thumbName } from '../hooks/thumbs'
import { TYPED, answerEngine, byteLengths, dir, failed, ok } from './helpers'

test('thumbName: 「パス＋更新時刻＋サイズ」のハッシュ。どれかが変われば別の名前', async () => {
  const name = await thumbName('/a/b.png', 1000, 20)
  expect(name).toMatch(/^[0-9a-f]{32}\.png$/)
  expect(await thumbName('/a/b.png', 1000, 20)).toBe(name)
  expect(await thumbName('/a/b.png', 1001, 20)).not.toBe(name)
  expect(await thumbName('/a/b.png', 1000, 21)).not.toBe(name)
  expect(await thumbName('/a/c.png', 1000, 20)).not.toBe(name)
})

test('thumbCommands: 画像は sips、svg は sips のあと qlmanage、HTML・PDF は qlmanage', () => {
  const sips = ['sips', '-s', 'format', 'png', '-Z', '480', '/a/b.jpg', '--out', '/w/thumb.png']
  expect(thumbCommands({ path: '/a/b.jpg', kind: 'image' }, '/w')).toEqual([sips])
  expect(thumbCommands({ path: '/a/s.svg', kind: 'svg' }, '/w')).toEqual([
    ['sips', '-s', 'format', 'png', '-Z', '480', '/a/s.svg', '--out', '/w/thumb.png'],
    ['qlmanage', '-t', '-s', '480', '-o', '/w', '/a/s.svg'],
  ])
  expect(thumbCommands({ path: '/a/p.html', kind: 'html' }, '/w')).toEqual([['qlmanage', '-t', '-s', '480', '-o', '/w', '/a/p.html']])
  expect(thumbCommands({ path: '/a/p.pdf', kind: 'pdf' }, '/w')).toEqual([['qlmanage', '-t', '-s', '480', '-o', '/w', '/a/p.pdf']])
})

// ── /lime で縮小画像を作る ──

/** 縮小画像のテスト用: 発言に書かれたファイル（files）があり、sips・qlmanage は workDir に PNG を書いたことにする */
function answerThumbs(on: On, jsonl: string, files: Record<string, { size: number; mtimeMs: number }>, options: { failing?: string[]; brokenExists?: boolean } = {}) {
  mock.clock(on) // 縮小画像を作り始めてからの時間を測る
  mock.store(on) // 自動更新の合言葉を置く
  const state = { ran: [] as string[][], html: [] as string[], thumbs: new Set<string>(), outputs: new Map<string, string>() }
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async ($, e) => {
    if (e.path === '/h/.claude/projects') return { value: [dir('proj')] }
    const out = state.outputs.get(e.path ?? '')
    return { value: out === undefined ? [] : [{ name: out, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('fs.exists', async ($, e) => {
    if (e.path === '/h/.claude/projects/proj/sess-1.jsonl') return { value: true }
    if (options.brokenExists === true) throw new Error('思わぬエラー')
    return { value: state.thumbs.has(e.path) }
  })
  on('fs.stat', async ($, e) => {
    const file = files[e.path]
    if (e.path.endsWith('.jsonl')) return { value: { kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false } }
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, ...file, isLink: false } }
  })
  on('fs.write', async ($, e) => {
    state.html.push(e.text)
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    state.ran.push(argv)
    if (argv[0] === 'awk') return { value: ok(byteLengths(jsonl)) }
    if (argv[0] === 'sed') return { value: ok(jsonl) }
    if (argv[0] === 'sips' || argv[0] === 'qlmanage') {
      const input = argv[6] ?? '' // sips も qlmanage も 7 番目が入力
      if (options.failing?.includes(input)) return { value: failed }
      const workDir = argv[0] === 'sips' ? (argv[8] ?? '').replace(/\/thumb\.png$/, '') : (argv[5] ?? '')
      state.outputs.set(workDir, argv[0] === 'sips' ? 'thumb.png' : `${input.slice(input.lastIndexOf('/') + 1)}.png`)
      return { value: ok('') }
    }
    if (argv[0] === 'mv') state.thumbs.add(argv[2] ?? '')
    return { value: ok('') }
  })
  return state
}

const record = (type: 'user' | 'assistant', timestamp: string, text: string, cwd = '/h/proj') =>
  JSON.stringify({ type, timestamp, cwd, message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] } })

test('/lime: 発言に書かれた画像・PDF の縮小画像を作り、パスの行のすぐ下に相対パスで出す（無いファイル・インラインの言及は出さない）', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const jsonl =
    [
      record('user', '2026-10-06T05:32:00.000Z', 'これを見て\nout/b c.pdf\nout/missing.png'),
      record('assistant', '2026-10-06T05:32:10.000Z', '作りました（`out/b c.pdf` も直しました）\n\n[図](</h/proj/out/a%20b.png>)'),
    ].join('\n') + '\n'
  const files = { '/h/proj/out/a b.png': { size: 10, mtimeMs: 1 }, '/h/proj/out/b c.pdf': { size: 20, mtimeMs: 2 } }
  const state = answerThumbs(on, jsonl, files)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })

  const assets = '/h/.claude/lime/sess-1-assets'
  const png = await thumbName('/h/proj/out/a b.png', 1, 10)
  const pdf = await thumbName('/h/proj/out/b c.pdf', 2, 20)
  // 新しい発言（Claude の a b.png）から作る。置き場所は 700、縮小画像は 600。作業用のフォルダで作ってから移す
  expect(state.ran.filter((argv) => !['awk', 'sed', 'cmux'].includes(argv[0] ?? ''))).toEqual([
    ['mkdir', '-p', '/h/.claude/lime'],
    ['chmod', '700', '/h/.claude/lime'],
    ['mkdir', '-p', assets],
    ['chmod', '700', assets],
    ['mkdir', '-p', '-m', '700', `${assets}/${png}.work`],
    ['sips', '-s', 'format', 'png', '-Z', '480', '/h/proj/out/a b.png', '--out', `${assets}/${png}.work/thumb.png`],
    ['chmod', '600', `${assets}/${png}.work/thumb.png`],
    ['mv', `${assets}/${png}.work/thumb.png`, `${assets}/${png}`],
    ['rm', '-rf', `${assets}/${png}.work`],
    ['mkdir', '-p', '-m', '700', `${assets}/${pdf}.work`],
    ['qlmanage', '-t', '-s', '480', '-o', `${assets}/${pdf}.work`, '/h/proj/out/b c.pdf'],
    ['chmod', '600', `${assets}/${pdf}.work/b c.pdf.png`],
    ['mv', `${assets}/${pdf}.work/b c.pdf.png`, `${assets}/${pdf}`],
    ['rm', '-rf', `${assets}/${pdf}.work`],
    ['chmod', '600', '/h/.claude/lime/sess-1.html'],
  ])
  const html = state.html[0] ?? ''
  expect(html).toContain("img-src 'self'")
  const thumb = (name: string, file: string) =>
    `<span class="thumbs"><span class="thumb"><img src="sess-1-assets/${name}" alt="${file}" loading="lazy"><span class="cap">${file}</span></span></span>`
  // それぞれ、パスを書いた行のすぐ下に出る
  expect(html).toContain(`[図](&lt;/h/proj/out/a%20b.png&gt;)${thumb(png, 'a b.png')}`)
  expect(html).toContain(`out/b c.pdf${thumb(pdf, 'b c.pdf')}out/missing.png`)
  expect(html.split('<img ').length - 1).toBe(2)
  expect(html).not.toContain('missing.png</span>')
})

test('/lime: 1回の描画で新しく作るのは 8 件まで。残りは次の描画で作り、できているものは作り直さない', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const paths = Array.from({ length: 10 }, (_, i) => `/h/pics/p${i}.png`)
  const jsonl = record('assistant', '2026-10-06T05:32:10.000Z', paths.join('\n\n')) + '\n'
  const state = answerThumbs(on, jsonl, Object.fromEntries(paths.map((path) => [path, { size: 1, mtimeMs: 1 }])))
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  const sips = () => state.ran.filter((argv) => argv[0] === 'sips').map((argv) => argv[6])
  expect(sips()).toEqual(paths.slice(0, 8))
  expect((state.html[0] ?? '').split('<img ').length - 1).toBe(8)

  await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(sips()).toEqual(paths)
  expect((state.html[1] ?? '').split('<img ').length - 1).toBe(10)
})

test('/lime: 縮小画像を作れなかったファイルは何も出さず、次の描画でも作り直さない', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const jsonl = record('assistant', '2026-10-06T05:32:10.000Z', '/h/bad/broken.png\n/h/bad/ok.png') + '\n'
  const files = { '/h/bad/broken.png': { size: 1, mtimeMs: 1 }, '/h/bad/ok.png': { size: 1, mtimeMs: 1 } }
  const state = answerThumbs(on, jsonl, files, { failing: ['/h/bad/broken.png'] })
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  const html = state.html[1] ?? ''
  expect(html.split('<img ').length - 1).toBe(1)
  expect(html).toContain('<span class="cap">ok.png</span>')
  expect(html).not.toContain('broken.png</span>')
  expect(state.ran.filter((argv) => argv[0] === 'sips' && argv[6] === '/h/bad/broken.png')).toHaveLength(1)
  expect(state.ran.some((argv) => argv[0] === 'mv' && argv[1]?.includes('broken'))).toBe(false)
})

test('/lime: 縮小画像の用意で思わぬエラーが起きても、縮小画像なしで HTML は書き出す', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const jsonl = record('assistant', '2026-10-06T05:32:10.000Z', '/h/pics/a.png') + '\n'
  const state = answerThumbs(on, jsonl, { '/h/pics/a.png': { size: 1, mtimeMs: 1 } }, { brokenExists: true })
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(result.text).toContain('1 件の発言')
  expect(state.html).toHaveLength(1)
  expect(state.html[0]).not.toContain('class="thumbs"')
})
