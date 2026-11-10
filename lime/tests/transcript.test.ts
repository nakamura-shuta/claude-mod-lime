import { expect, test } from 'claude-code/testing'
import type { Item } from '../hooks/model'
import { parseTranscript } from '../hooks/transcript'

const line = (record: Record<string, unknown>) => JSON.stringify(record)
const user = (timestamp: string, content: unknown, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', timestamp, message: { role: 'user', content }, ...extra })
const assistant = (timestamp: string, content: unknown) =>
  line({ type: 'assistant', timestamp, message: { role: 'assistant', content } })
const kinds = (items: Item[]) => items.map((item) => item.kind)
const messages = (items: Item[]) => items.flatMap((item) => (item.kind === 'message' ? [[item.side, item.text]] : []))

test('発言が正しい側になり、タイトル（最後の ai-title）と発言数が取れる', () => {
  const c = parseTranscript([
    line({ type: 'ai-title', aiTitle: '最初のタイトル' }),
    user('2026-10-06T05:00:00Z', 'こんにちは'),
    assistant('2026-10-06T05:00:05Z', [{ type: 'text', text: 'はい' }]),
    line({ type: 'ai-title', aiTitle: '最後のタイトル' }),
  ].join('\n'))
  expect(c.title).toBe('最後のタイトル')
  expect(c.messageCount).toBe(2)
  expect(messages(c.items)).toEqual([['me', 'こんにちは'], ['claude', 'はい']])
  expect(c.firstTime).toBe(Date.parse('2026-10-06T05:00:00Z'))
  expect(c.lastTime).toBe(Date.parse('2026-10-06T05:00:05Z'))
})

test('文章を挟まずに続いたツール実行を1つにまとめ、結果を結び付ける', () => {
  const c = parseTranscript([
    user('2026-10-06T05:00:00Z', '調べて'),
    assistant('2026-10-06T05:00:01Z', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la', description: '一覧' } }]),
    user('2026-10-06T05:00:02Z', [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt\nb.txt' }]),
    assistant('2026-10-06T05:00:03Z', [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/x/a.txt' } }]),
    user('2026-10-06T05:00:04Z', [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'not found' }], is_error: true }]),
    assistant('2026-10-06T05:00:05Z', [{ type: 'text', text: '終わりました' }]),
  ].join('\n'))
  expect(kinds(c.items)).toEqual(['separator', 'message', 'tools', 'message'])
  const tools = c.items.find((item) => item.kind === 'tools')
  expect(tools?.kind === 'tools' ? tools.tools : []).toEqual([
    { name: 'Bash', summary: 'ls -la', result: 'a.txt\nb.txt', isError: false },
    { name: 'Read', summary: '/x/a.txt', result: 'not found', isError: true },
  ])
})

test('思考・isMeta・サブエージェント・system-reminder は出さない', () => {
  const c = parseTranscript([
    user('2026-10-06T05:00:00Z', '本文<system-reminder>内部の注意</system-reminder>'),
    user('2026-10-06T05:00:01Z', 'スキルの本文', { isMeta: true }),
    user('2026-10-06T05:00:02Z', 'サブエージェント', { isSidechain: true }),
    assistant('2026-10-06T05:00:03Z', [{ type: 'thinking', thinking: '考え中' }, { type: 'text', text: '答え' }]),
  ].join('\n'))
  expect(messages(c.items)).toEqual([['me', '本文'], ['claude', '答え']])
})

test('コマンド実行・その出力・中断・API エラーはお知らせにする', () => {
  const c = parseTranscript([
    user('2026-10-06T05:00:00Z', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
    user('2026-10-06T05:00:01Z', '<local-command-stdout>Set model to \u001b[1mOpus\u001b[22m</local-command-stdout>'),
    user('2026-10-06T05:00:02Z', [{ type: 'text', text: '[Request interrupted by user]' }]),
    line({ type: 'assistant', timestamp: '2026-10-06T05:00:03Z', isApiErrorMessage: true, message: { role: 'assistant', content: [{ type: 'text', text: 'Overloaded\n詳細' }] } }),
  ].join('\n'))
  expect(c.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))).toEqual([
    '/model opus',
    'Set model to Opus',
    '（中断しました）',
    'API エラー: Overloaded',
  ])
  expect(c.messageCount).toBe(0)
})

test('作業中に送った自分の発言（queued_command）は自分の発言にし、通知などは出さない', () => {
  const c = parseTranscript([
    line({ type: 'attachment', timestamp: '2026-10-06T05:00:00Z', attachment: { type: 'queued_command', prompt: '日本語で', commandMode: 'prompt', humanTurn: true } }),
    line({ type: 'attachment', timestamp: '2026-10-06T05:00:01Z', attachment: { type: 'queued_command', prompt: '<task-notification>完了</task-notification>', commandMode: 'task-notification' } }),
    line({ type: 'attachment', timestamp: '2026-10-06T05:00:02Z', attachment: { type: 'queued_command', prompt: '人が打っていない', commandMode: 'prompt' } }),
    line({ type: 'attachment', timestamp: '2026-10-06T05:00:03Z', attachment: { type: 'hook_success' } }),
  ].join('\n'))
  expect(messages(c.items)).toEqual([['me', '日本語で']])
})

test('system の local_command（スラッシュコマンドの実行）はお知らせにする', () => {
  const c = parseTranscript(
    line({ type: 'system', subtype: 'local_command', timestamp: '2026-10-06T05:00:00Z', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>' }),
  )
  expect(c.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))).toEqual(['/model opus'])
})

test('人が打っていない user 行（バックグラウンドの完了通知など）は自分の発言にしない', () => {
  const c = parseTranscript([
    user('2026-10-06T05:00:00Z', '<task-notification>\n<status>completed</status>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    user('2026-10-06T05:00:01Z', 'こんにちは', { origin: { kind: 'human' } }),
  ].join('\n'))
  expect(messages(c.items)).toEqual([['me', 'こんにちは']])
})

test('古い版の queued_command（humanTurn が無く origin.kind が human）も自分の発言にする', () => {
  const c = parseTranscript(
    line({ type: 'attachment', timestamp: '2026-10-06T05:00:00Z', attachment: { type: 'queued_command', prompt: 'それも直して', commandMode: 'prompt', origin: { kind: 'human' } } }),
  )
  expect(messages(c.items)).toEqual([['me', 'それも直して']])
})

test('会話の圧縮で入る要約は、お知らせ1行にする', () => {
  const c = parseTranscript(user('2026-10-06T05:00:00Z', 'This session is being continued from a previous conversation...', { isCompactSummary: true }))
  expect(c.messageCount).toBe(0)
  expect(c.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))).toEqual(['（ここまでの会話を要約しました）'])
})

test('画像は [画像] として発言に含める', () => {
  const c = parseTranscript(user('2026-10-06T05:00:00Z', [{ type: 'text', text: 'これ見て' }, { type: 'image', source: {} }]))
  expect(messages(c.items)).toEqual([['me', 'これ見て\n[画像]']])
})

test('日付が変わったとき・30分以上空いたときに区切りが入る', () => {
  const c = parseTranscript([
    user('2026-10-06T05:00:00Z', 'a'),
    user('2026-10-06T05:10:00Z', 'b'),
    user('2026-10-06T05:40:00Z', 'c'), // 30分空いた
    user('2026-10-06T15:01:00Z', 'd'), // 日本時間で日付が変わった
  ].join('\n'))
  expect(kinds(c.items)).toEqual(['separator', 'message', 'message', 'separator', 'message', 'separator', 'message'])
})

test('壊れた行は飛ばして数える', () => {
  const c = parseTranscript(['{壊れた行', user('2026-10-06T05:00:00Z', 'ok'), '{"type":'].join('\n') + '\n')
  expect(c.skippedLines).toBe(2)
  expect(c.messageCount).toBe(1)
})

test('改行で終わっていない最後の行（書き込み途中）は、壊れた行として数えない', () => {
  const c = parseTranscript([user('2026-10-06T05:00:00Z', 'ok'), '{"type":"user","times'].join('\n'))
  expect(c.skippedLines).toBe(0)
  expect(c.messageCount).toBe(1)
})

test('発言に、その行の作業フォルダ（cwd）を付ける（相対パスの基準）。無い行では付けない', () => {
  const { items } = parseTranscript(
    [
      user('2026-10-06T05:32:00.000Z', 'a.png', { cwd: '/h/proj/sub' }),
      line({ type: 'assistant', timestamp: '2026-10-06T05:32:10.000Z', cwd: '/h/proj', message: { role: 'assistant', content: [{ type: 'text', text: 'はい' }] } }),
      assistant('2026-10-06T05:32:20.000Z', [{ type: 'text', text: 'cwd なし' }]),
    ].join('\n'),
  )
  const cwds = items.flatMap((item) => (item.kind === 'message' ? [item.cwd] : []))
  expect(cwds).toEqual(['/h/proj/sub', '/h/proj', undefined])
  expect(items.some((item) => item.kind === 'message' && 'cwd' in item && item.text === 'cwd なし')).toBe(false)
})
