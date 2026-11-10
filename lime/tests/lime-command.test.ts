import { expect, mock, test } from 'claude-code/testing'
import { CLOSED_TREE, OPEN_TREE, TRANSCRIPT, TYPED, WATCHER_KEY, answerEngine, answerWatch, byteLengths, count, dir, failed, ok } from './helpers'

test('/lime: 今の会話の記録を探し、HTML を書き出して cmux で開く', async ($, on) => {
  const toasts: string[] = []
  const registered: string[] = []
  answerEngine(on, toasts, registered)
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: Date.parse('2026-10-14T23:40:00Z') })
  mock.store(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async ($, e) => ({ value: e.path === '/h/.claude/projects' ? [dir('other'), dir('proj')] : [] }))
  on('fs.exists', async ($, e) => ({ value: e.path === '/h/.claude/projects/proj/sess-1.jsonl' }))
  const ran: string[][] = []
  const timeouts = new Map<string, number | undefined>()
  on('process.run', async ($, e) => {
    ran.push([...e.argv])
    timeouts.set(e.argv[0] ?? '', e.init?.timeoutMs)
    if (e.argv[0] === 'awk') return { value: ok(byteLengths(TRANSCRIPT)) }
    if (e.argv[0] === 'sed') return { value: ok(TRANSCRIPT) }
    return { value: ok('') }
  })
  const written: { path: string; text: string }[] = []
  on('fs.write', async ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })

  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })

  expect(written).toHaveLength(1)
  expect(written[0]?.path).toBe('/h/.claude/lime/sess-1.html')
  expect(written[0]?.text).toContain('<title>テストの会話</title>')
  expect(written[0]?.text).toContain('<strong>はい</strong>')
  // ↻ のボタンの説明に、作った時刻を出す
  expect(written[0]?.text).toContain('title="最終更新 2026/10/15（木）08:40。押すと読み直す"')
  expect(ran).toEqual([
    // 会話の中身なので、置き場所のフォルダを先に 700 にしてから書き出す
    ['mkdir', '-p', '/h/.claude/lime'],
    ['chmod', '700', '/h/.claude/lime'],
    ['awk', '{ print length($0) }', '/h/.claude/projects/proj/sess-1.jsonl'],
    ['sed', '-n', '1,3p;3q', '/h/.claude/projects/proj/sess-1.jsonl'],
    ['chmod', '600', '/h/.claude/lime/sess-1.html'],
    // 開いているタブが無いかを先に調べる（ここでは cmux tree の出力が空なので、無いものとして開く）
    ['cmux', 'tree', '--all', '--json'],
    ['cmux', 'open', '/h/.claude/lime/sess-1.html'],
  ])
  expect(registered).toEqual(['lime', 'lime-codex'])
  // cmux が固まっても待ちすぎないよう、時間の上限を付ける
  expect(timeouts.get('cmux')).toBe(15_000)
  expect(toasts).toEqual(['会話を開きました'])
  expect(result.text).toContain('2 件の発言を開きました')
})

test('/lime <ID>: 指定した ID の記録が無ければ、見つからないと答える', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, toasts)
  mock.env(on, { HOME: '/h' })
  on('fs.list', async () => ({ value: [dir('proj')] }))
  on('fs.exists', async () => ({ value: false }))
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: 'nope', ...TYPED })
  expect(result.text).toContain('会話記録が見つかりません: nope')
  expect(toasts).toEqual(['見つかりません: nope'])
})

test('/lime <ID>: パスとして危ない ID（../ など）は、探しもせずに断る', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const listed: string[] = []
  on('fs.list', async ($, e) => {
    listed.push(e.path)
    return { value: [dir('proj')] }
  })
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  for (const args of ['../../x', 'a/b', 'a b', '~x']) {
    const result = await $.command.run({ command: 'lime', args, ...TYPED })
    expect(result.text).toContain('ID は英数字と - だけで指定してください')
  }
  expect(listed).toEqual([])
})

test('/lime（引数なし）: 始めたばかりで記録がまだ無ければ、発言してから開くよう案内する', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  on('session.id', async () => ({ value: 'sess-new' }))
  on('fs.list', async () => ({ value: [dir('proj')] }))
  on('fs.exists', async () => ({ value: false }))
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(result.text).toBe('会話記録が見つかりません: sess-new（始めたばかりの会話は、何か発言してから開いてください）')
})

test('/lime: cmux で開けなければ、既定のブラウザ（open）で開く', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, toasts)
  mock.env(on, { HOME: '/h' })
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async () => ({ value: [dir('proj')] }))
  on('fs.exists', async ($, e) => ({ value: e.path.endsWith('.jsonl') }))
  const ran: string[] = []
  on('process.run', async ($, e) => {
    ran.push(e.argv[0] ?? '')
    if (e.argv[0] === 'awk') return { value: ok(byteLengths(TRANSCRIPT)) }
    if (e.argv[0] === 'sed') return { value: ok(TRANSCRIPT) }
    if (e.argv[0] === 'cmux') return { value: failed }
    return { value: ok('') }
  })
  on('fs.write', async () => ({ value: undefined }))
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  // cmux tree（開いているタブを探す）→ cmux open（失敗）→ open
  expect(ran).toEqual(['mkdir', 'chmod', 'awk', 'sed', 'chmod', 'cmux', 'cmux', 'open'])
  expect(toasts).toEqual(['会話を開きました'])
  expect(result.text).toContain('開きました')
})

test('/lime: 大きな記録は新しい側だけを読み、省略したことを HTML の先頭に出す', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, toasts)
  mock.env(on, { HOME: '/h' })
  mock.clock(on)
  mock.store(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async () => ({ value: [dir('proj')] }))
  on('fs.exists', async () => ({ value: true }))
  const sedRanges: string[] = []
  on('process.run', async ($, e) => {
    // 3,000,000 バイトの行が 11 行（合計 33MB）。読む量の上限は 30,000,000 なので、新しい側の 9 行だけを読む
    if (e.argv[0] === 'awk') return { value: ok('3000000\n'.repeat(11)) }
    if (e.argv[0] === 'sed') {
      sedRanges.push(e.argv[2] ?? '')
      return { value: ok(TRANSCRIPT) }
    }
    return { value: ok('') }
  })
  const written: string[] = []
  on('fs.write', async ($, e) => {
    written.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(sedRanges).toHaveLength(9)
  expect(sedRanges[0]).toBe('3,3p;3q')
  expect(written[0]).toContain('記録が大きいため、古い部分を省略しています（読まなかった行 2）')
})


test('/lime を打ち直すと、開いているタブがあれば cmux open せずに、そのタブを読み込み直す（タブを増やさない）', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, toasts)
  mock.env(on, { HOME: '/h' })
  mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(state.ran.filter((run) => run.startsWith('cmux'))).toEqual(['cmux tree --all --json', 'cmux browser surface:9 reload'])
  expect(result.text).toBe('開いているタブを更新しました（2 件の発言。会話が進むと更新します。/h/.claude/lime/sess-1.html）')
  expect(toasts).toEqual(['開いているタブを更新しました'])
})

// ── 起動し直したときの再開（session.start） ──
// session.start が $.command.run で実行する /lime は、このプラグイン自身の command.run のフックが答える（テストの on まで届かない）。
// そのため「/lime を実行したか」は、/lime がすること（HTML の書き出し・タブの読み込み直し・合言葉）で確かめる。
// また、本物の $.command.run は「セッションが空いてから」実行されるが、テストには本体（セッション）が無いので、その待ち方は確かめられない。
// ここでは、投げっぱなしの /lime が終わるのを clock.settle() で待ってから見る。

test('session.start: この会話の HTML があり、cmux でそれを開いているタブがあれば、/lime を実行して自動更新を再開する', async ($, on) => {
  const toasts: string[] = []
  const registered: string[] = []
  answerEngine(on, toasts, registered)
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  state.htmlExists = true
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await clock.settle()

  expect(registered).toEqual(['lime', 'lime-codex'])
  // 起動を待たせすぎないよう、最初に調べる cmux tree の時間の上限は短め（5 秒）。/lime の中では 15 秒
  expect(state.treeTimeouts).toEqual([5000, 15_000])
  // /lime が動いた: HTML を作り直し、開いているタブを読み込み直した（cmux open はしない）
  expect(state.writes).toBe(1)
  expect(state.ran.filter((run) => run.startsWith('cmux'))).toEqual(['cmux tree --all --json', 'cmux tree --all --json', 'cmux browser surface:9 reload'])
  expect(state.store.get(WATCHER_KEY)).toBeDefined()
  expect(toasts).toEqual(['開いているタブを更新しました'])

  // 自動更新も動いている
  state.size = 200
  await clock.advance(6000)
  expect(state.writes).toBe(2)
})

test('session.start: HTML が無い・タブが無い・cmux tree が失敗する・人がいない実行（-p など）では、/lime を実行しない（起動は止めない）', async ($, on) => {
  const registered: string[] = []
  answerEngine(on, [], registered)
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  const start = async (isInteractive = true) => {
    registered.length = 0
    await $.session.start({ cwd: '/h/proj', surface: null, isInteractive })
    await clock.settle()
    expect(registered).toEqual(['lime', 'lime-codex'])
  }

  await start() // HTML が無い。cmux も調べない
  expect(count(state.ran, 'cmux tree')).toBe(0)

  state.htmlExists = true
  state.tree = CLOSED_TREE
  await start() // タブが無い
  for (const mode of ['failed', 'empty', 'reject'] as const) {
    state.treeMode = mode
    await start() // cmux tree が失敗した
  }
  expect(count(state.ran, 'cmux tree')).toBe(4)

  state.tree = OPEN_TREE
  state.treeMode = 'ok'
  await start(false) // 人がいない実行。cmux も調べない
  expect(count(state.ran, 'cmux tree')).toBe(4)

  expect(state.writes).toBe(0)
  expect(state.store.size).toBe(0)
})

test('/lime: 同じ作業フォルダ（とその下）の Codex の会話を時刻順に混ぜる。別のフォルダの Codex は混ぜない', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: Date.parse('2026-10-08T03:00:00Z') })
  mock.store(on)
  const jsonl = (...records: Record<string, unknown>[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  const files: Record<string, string> = {
    '/h/.claude/projects/proj/sess-1.jsonl': jsonl(
      { type: 'user', timestamp: '2026-10-08T01:00:00.000Z', cwd: '/h/proj', message: { role: 'user', content: 'Claude への発言' } },
      { type: 'assistant', timestamp: '2026-10-08T01:20:00.000Z', cwd: '/h/proj', message: { role: 'assistant', content: [{ type: 'text', text: 'Claude の返事' }] } },
    ),
    '/h/.codex/sessions/2026/10/08/rollout-a.jsonl': jsonl(
      { type: 'session_meta', timestamp: '2026-10-08T01:05:00Z', payload: { id: 'codexaaaa-1', cwd: '/h/proj/sub' } },
      { type: 'event_msg', timestamp: '2026-10-08T01:10:00Z', payload: { type: 'user_message', message: 'Codex への依頼' } },
      { type: 'event_msg', timestamp: '2026-10-08T01:11:00Z', payload: { type: 'agent_message', message: 'Codex の返事' } },
    ),
    '/h/.codex/sessions/2026/10/08/rollout-b.jsonl': jsonl(
      { type: 'session_meta', timestamp: '2026-10-08T01:05:00Z', payload: { id: 'codexbbbb-2', cwd: '/h/other' } },
      { type: 'event_msg', timestamp: '2026-10-08T01:12:00Z', payload: { type: 'agent_message', message: '別のフォルダの Codex' } },
    ),
  }
  const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: Date.parse('2026-10-08T02:00:00Z'), isLink: false })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async ($, e) => ({
    value: e.path === '/h/.claude/projects' ? [dir('proj')] : e.path === '/h/.codex/sessions/2026/10/08' ? [file('rollout-a.jsonl'), file('rollout-b.jsonl')] : [],
  }))
  on('fs.exists', async ($, e) => ({ value: e.path in files }))
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: files[e.path]?.length ?? 0, mtimeMs: 0, isLink: false } }))
  on('process.run', async ($, e) => {
    const path = e.argv.at(-1) ?? ''
    const text = files[path] ?? ''
    if (e.argv[0] === 'awk') return { value: ok(byteLengths(text)) }
    if (e.argv[0] === 'sed') return { value: ok(text) }
    if (e.argv[0] === 'head') return { value: ok(text.split('\n')[0] + '\n') }
    return { value: ok('') }
  })
  const written: string[] = []
  on('fs.write', async ($, e) => {
    written.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  const html = written[0] ?? ''
  // 時刻順: Claude への発言（01:00）→ Codex への依頼（01:10）→ Codex の返事（01:11）→ Claude の返事（01:20）
  const order = ['Claude への発言', 'Codex への依頼', 'Codex の返事', 'Claude の返事'].map((text) => html.indexOf(text))
  expect(order.every((index) => index > 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  expect(html).toContain('<span class="tag">Codex·codexaaa</span>')
  expect(html).not.toContain('別のフォルダの Codex')
  expect(result.text).toContain('4 件の発言')
})
