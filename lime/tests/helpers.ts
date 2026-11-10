// テストで共有する下ごしらえ。テストには Claude Code 本体が無いので、プラグインが呼ぶ $ やイベントに、ここで答える。
// （*.test.ts ではないので、このファイルそのものはテストとして走らない）
import type { On } from 'claude-code'

export const TRANSCRIPT =
  [
    JSON.stringify({ type: 'ai-title', aiTitle: 'テストの会話' }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-06T05:32:00.000Z', message: { role: 'user', content: 'こんにちは' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T05:32:10.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '**はい**' }] } }),
  ].join('\n') + '\n'

export const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
export const failed = { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false }
export const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
export const byteLengths = (text: string) =>
  text.split('\n').filter((l) => l !== '').map((l) => String(new TextEncoder().encode(l).length)).join('\n') + '\n'
// 人が /lime と打ったときの入力（args 以外）
export const TYPED = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

/** テストには本体が無いので、プラグインの下で session.start・command.register・ui.toast に答える */
export function answerEngine(on: On, toasts: string[], registered: string[] = []) {
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', async ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
}

/**
 * 自動更新のテスト用: 会話記録の大きさを変えられる fs.stat と、cmux tree の答え、$.store を用意する。
 * $.store は mock.store ではなく自前の Map で答える（テストから合言葉を読んだり、書き換えたりするため）
 */
export function answerWatch(on: On, tree: string) {
  const state = {
    size: 100,
    writes: 0,
    atBottom: false,
    ran: [] as string[],
    /** cmux tree に渡された時間の上限 */
    treeTimeouts: [] as (number | undefined)[],
    /** cmux tree の答え。'failed' は終了コード 1、'empty' は出力が空、'reject' は時間切れなどで $.process.run が失敗する */
    treeMode: 'ok' as 'ok' | 'failed' | 'empty' | 'reject',
    tree,
    /** HTML の書き出しを失敗させる回数 */
    failWrites: 0,
    /** HTML がもうあるか（session.start で自動更新を再開するかを決める）。既定は無い */
    htmlExists: false,
    /** $.store の中身 */
    store: new Map<string, unknown>(),
  }
  on('session.id', async () => ({ value: 'sess-1' }))
  on('fs.list', async () => ({ value: [dir('proj')] }))
  on('fs.exists', async ($, e) => ({ value: e.path.endsWith('.html') ? state.htmlExists : true }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: state.size, mtimeMs: 0, isLink: false } }))
  on('fs.write', async () => {
    if (state.failWrites > 0) {
      state.failWrites--
      throw new Error('書き出せない')
    }
    state.writes++
    return { value: undefined }
  })
  on('store.get', async ($, e) => ({ value: state.store.get(e.key) }))
  on('store.set', async ($, e) => {
    state.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async ($, e) => {
    state.store.delete(e.key)
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    state.ran.push(e.argv.join(' '))
    if (e.argv[0] === 'awk') return { value: ok(byteLengths(TRANSCRIPT)) }
    if (e.argv[0] === 'sed') return { value: ok(TRANSCRIPT) }
    if (e.argv[1] === 'tree') {
      state.treeTimeouts.push(e.init?.timeoutMs)
      if (state.treeMode === 'failed') return { value: failed }
      if (state.treeMode === 'empty') return { value: ok('') }
      if (state.treeMode === 'reject') throw new Error('時間切れ')
      return { value: ok(state.tree) }
    }
    if (e.argv[3] === 'eval' && e.argv[4]?.includes('innerHeight')) return { value: ok(state.atBottom ? 'true\n' : 'false\n') }
    return { value: ok('') }
  })
  return state
}

export const OPEN_TREE = JSON.stringify({
  windows: [{ panes: [{ surfaces: [{ ref: 'surface:9', type: 'browser', url: 'file:///h/.claude/lime/sess-1.html' }] }] }],
})
export const CLOSED_TREE = JSON.stringify({ windows: [] })
export const WATCHER_KEY = 'watcher:sess-1'
export const count = (ran: string[], prefix: string) => ran.filter((run) => run.startsWith(prefix)).length
