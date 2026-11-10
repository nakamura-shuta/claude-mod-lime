import { expect, mock, test } from 'claude-code/testing'
import { CLOSED_TREE, OPEN_TREE, TYPED, WATCHER_KEY, answerEngine, answerWatch, count } from './helpers'

// 自動更新（register.ts の startWatcher）のテスト。/lime を実行してから、時計を進めて確かめる

test('/lime: 会話記録が伸びたら、書き込みが落ち着くのを待って作り直し、cmux のタブを読み込み直す', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  const result = await $.command.run({ command: 'lime', args: '', ...TYPED })
  expect(result.text).toContain('会話が進むと更新します')

  await clock.advance(3000) // 変わっていない
  expect(state.writes).toBe(1)
  state.size = 200
  await clock.advance(3000) // 伸びた。次の回まで待つ
  expect(state.writes).toBe(1)
  await clock.advance(3000) // 落ち着いた。作り直して読み込み直す
  expect(state.writes).toBe(2)
  expect(state.ran).toContain('cmux tree --all --json')
  expect(state.ran.at(-1)).toBe('cmux browser surface:9 reload')
  await clock.advance(3000) // 作り直した後は、また伸びるまで作らない
  expect(state.writes).toBe(2)
})

test('/lime: 同じ会話をもう一度開くと、前の自動更新は止まる', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  const reloads = count(state.ran, 'cmux browser surface:9 reload') // 開いたときに、開いているタブを読み込み直した分

  state.size = 200
  await clock.advance(6000)
  expect(state.writes).toBe(3) // 開いたときの2回＋作り直しの1回（前の自動更新も動いていれば4回）
  expect(count(state.ran, 'cmux browser surface:9 reload') - reloads).toBe(1)
})

test('/lime: 新しい自動更新が合言葉を置き直したら（読み込み直した新しいモジュールなど）、古い自動更新は作り直さずに自分で止まる', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })
  const token = state.store.get(WATCHER_KEY)
  expect(typeof token).toBe('string')
  const trees = count(state.ran, 'cmux tree')

  // 読み込み直した新しいモジュールが、自動更新を始めて合言葉を置いた。
  // 古いモジュールのタイマーは、モジュールの変数からは止められない（新しいモジュールの変数は空から始まる）ので、合言葉で止まる
  state.store.set(WATCHER_KEY, 'new-module')
  state.size = 200
  await clock.advance(6000)
  expect(state.writes).toBe(1) // 作り直さない
  expect(count(state.ran, 'cmux tree')).toBe(trees) // cmux にも触らない
  expect(state.store.get(WATCHER_KEY)).toBe('new-module') // 新しい自動更新の合言葉は消さない

  // 止まっている（その回を飛ばしただけではない）: 合言葉を元に戻しても、もう動かない
  state.store.set(WATCHER_KEY, token)
  state.size = 300
  await clock.advance(6000)
  expect(state.writes).toBe(1)
})

test('/lime: 自動更新の途中で例外が出ても止めず、その回を飛ばして次の回に作り直す（止めたというトーストも出さない）', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, toasts)
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })

  state.failWrites = 1
  state.size = 200
  await clock.advance(6000) // 落ち着いたので作り直そうとして、書き出しに失敗する
  expect(state.writes).toBe(1)
  await clock.advance(3000) // 次の回にまた試す
  expect(state.writes).toBe(2)
  expect(state.ran.at(-1)).toBe('cmux browser surface:9 reload')
  expect(toasts).toEqual(['開いているタブを更新しました']) // /lime を打ったときのものだけ
})

test('/lime: cmux tree が失敗した回（終了コードが 0 でない・出力が空・時間切れ）は飛ばし、自動更新は止めない', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })

  state.size = 200
  await clock.advance(3000) // 伸びた。次の回まで待つ
  for (const mode of ['failed', 'empty', 'reject'] as const) {
    state.treeMode = mode
    await clock.advance(3000) // タブがあるか分からないので、作り直さない（止めもしない）
    expect(state.writes).toBe(1)
  }
  expect(state.store.get(WATCHER_KEY)).toBeDefined()
  state.treeMode = 'ok'
  await clock.advance(3000) // cmux が答えたら、作り直して読み込み直す
  expect(state.writes).toBe(2)
  expect(state.ran.at(-1)).toBe('cmux browser surface:9 reload')
})

test('/lime: 一番下（最新）を見ていたら、読み込み直した後も一番下へ移す', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, OPEN_TREE)
  state.atBottom = true
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED })

  state.size = 200
  await clock.advance(6000)
  expect(state.ran.slice(-3)).toEqual([
    'cmux browser surface:9 reload',
    'cmux browser surface:9 wait --load-state complete --timeout 10',
    'cmux browser surface:9 eval window.scrollTo(0, document.body.scrollHeight)',
  ])
})

test('/lime: cmux tree が成功したのにタブが無ければ（閉じられた）、作り直さずに自動更新を止め、合言葉を消す', async ($, on) => {
  answerEngine(on, [])
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  const state = answerWatch(on, CLOSED_TREE)
  await $.session.start({ cwd: '/h/proj', surface: null, isInteractive: true })
  await $.command.run({ command: 'lime', args: '', ...TYPED }) // タブが無いので cmux open で開いた
  expect(state.store.get(WATCHER_KEY)).toBeDefined()
  const trees = count(state.ran, 'cmux tree')

  state.size = 200
  await clock.advance(6000)
  expect(state.writes).toBe(1)
  expect(state.store.has(WATCHER_KEY)).toBe(false)
  state.size = 300
  await clock.advance(6000)
  expect(count(state.ran, 'cmux tree') - trees).toBe(1) // 止まったので、もう調べない
  expect(state.ran.some((run) => run.startsWith('cmux browser'))).toBe(false)
})
