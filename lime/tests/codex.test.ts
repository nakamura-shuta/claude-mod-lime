import { expect, test } from 'claude-code/testing'
import { mergeItems, parseCodex, withCodex } from '../hooks/codex'
import { codexDayDirs, matchesCwd, parseCodexMeta } from '../hooks/codex-sessions'
import type { Item } from '../hooks/model'

const line = (record: Record<string, unknown>) => JSON.stringify(record)
const at = (iso: string) => Date.parse(iso)
const summary = (items: Item[]) =>
  items.map((item) =>
    item.kind === 'message' ? `${item.side}:${item.text}` : item.kind === 'tools' ? `tools:${item.tools.map((t) => t.summary).join('|')}` : item.kind,
  )

test('parseCodexMeta: 1行目から Codex の会話の ID と作業フォルダを取り出す。形が違えば undefined', () => {
  expect(parseCodexMeta(line({ type: 'session_meta', payload: { id: 'abc-123', cwd: '/h/proj' } }))).toEqual({ id: 'abc-123', cwd: '/h/proj' })
  expect(parseCodexMeta(line({ type: 'event_msg', payload: {} }))).toBeUndefined()
  expect(parseCodexMeta('{壊れた')).toBeUndefined()
})

test('matchesCwd: 同じフォルダか、その下なら合う（名前が似ているだけの隣のフォルダは合わない）', () => {
  expect(matchesCwd('/h/proj', ['/h/proj'])).toBe(true)
  expect(matchesCwd('/h/proj/sub', ['/h/proj'])).toBe(true)
  expect(matchesCwd('/h/project', ['/h/proj'])).toBe(false)
  expect(matchesCwd('/h', ['/h/proj'])).toBe(false)
})

test('codexDayDirs: 会話の期間の日付のフォルダを、1日前から返す（日本時間）', () => {
  expect(codexDayDirs(at('2026-10-08T00:30:00+09:00'), at('2026-10-08T10:00:00+09:00'))).toEqual(['2026/10/07', '2026/10/08'])
  expect(codexDayDirs(at('2026-10-07T23:00:00+09:00'), at('2026-10-09T01:00:00+09:00'))).toEqual(['2026/10/06', '2026/10/07', '2026/10/08', '2026/10/09'])
})

test('parseCodex（古い形）: user_message・agent_message を発言に、function_call をツールにする。終了コードが 0 でなければエラー', () => {
  const jsonl = [
    line({ type: 'session_meta', timestamp: '2026-10-08T01:00:00Z', payload: { id: 's1', cwd: '/h/proj' } }),
    line({ type: 'event_msg', timestamp: '2026-10-08T01:00:01Z', payload: { type: 'user_message', message: 'テストを直して' } }),
    line({ type: 'response_item', timestamp: '2026-10-08T01:00:02Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'テストを直して' }] } }),
    line({ type: 'response_item', timestamp: '2026-10-08T01:00:03Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"npm test"}' } }),
    line({ type: 'response_item', timestamp: '2026-10-08T01:00:04Z', payload: { type: 'function_call_output', call_id: 'c1', output: '{"output":"1 failed","metadata":{"exit_code":1}}' } }),
    line({ type: 'response_item', timestamp: '2026-10-08T01:00:05Z', payload: { type: 'reasoning', encrypted_content: 'x' } }),
    line({ type: 'event_msg', timestamp: '2026-10-08T01:00:06Z', payload: { type: 'agent_message', message: '直しました' } }),
  ].join('\n')
  const items = parseCodex(jsonl, 's1', 0)
  // response_item の message（同じ依頼の写し）と reasoning は出さない
  expect(summary(items)).toEqual(['me:テストを直して', 'tools:npm test', 'claude:直しました'])
  const tools = items[1]
  expect(tools?.kind === 'tools' ? tools.tools[0] : undefined).toEqual({ name: 'exec_command', summary: 'npm test', result: '1 failed', isError: true })
  expect(items.every((item) => (item.kind === 'message' || item.kind === 'tools') && item.origin?.session === 's1')).toBe(true)
})

test('parseCodex（新しい形）: item_completed の UserMessage・AgentMessage を発言に、custom_tool_call をツールにする', () => {
  const jsonl = [
    line({ type: 'event_msg', timestamp: '2026-10-08T02:00:00Z', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: '調べて' }] } } }),
    line({ type: 'response_item', timestamp: '2026-10-08T02:00:01Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c2', input: 'ls -la' } }),
    line({ type: 'response_item', timestamp: '2026-10-08T02:00:02Z', payload: { type: 'custom_tool_call_output', call_id: 'c2', output: 'a.txt' } }),
    line({ type: 'event_msg', timestamp: '2026-10-08T02:00:03Z', payload: { type: 'item_completed', item: { type: 'Reasoning', summary_text: [] } } }),
    line({ type: 'event_msg', timestamp: '2026-10-08T02:00:04Z', payload: { type: 'item_completed', item: { type: 'AgentMessage', phase: 'final_answer', content: [{ type: 'Text', text: 'a.txt があります' }] } } }),
  ].join('\n')
  expect(summary(parseCodex(jsonl, 's2', 0))).toEqual(['me:調べて', 'tools:ls -la', 'claude:a.txt があります'])
})

test('parseCodex: from より前（Claude Code の会話より前）の項目は出さない', () => {
  const jsonl = [
    line({ type: 'event_msg', timestamp: '2026-10-08T01:00:00Z', payload: { type: 'user_message', message: '前の依頼' } }),
    line({ type: 'event_msg', timestamp: '2026-10-08T03:00:00Z', payload: { type: 'user_message', message: 'あとの依頼' } }),
  ].join('\n')
  expect(summary(parseCodex(jsonl, 's1', at('2026-10-08T02:00:00Z')))).toEqual(['me:あとの依頼'])
})

test('mergeItems: 時刻順に混ぜ、日時の区切りを入れ直す（同じ時刻なら Claude Code の項目が先）', () => {
  const base: Item[] = [
    { kind: 'separator', time: at('2026-10-08T01:00:00Z') },
    { kind: 'message', side: 'me', time: at('2026-10-08T01:00:00Z'), text: 'A' },
    { kind: 'message', side: 'claude', time: at('2026-10-08T01:10:00Z'), text: 'C' },
  ]
  const origin = { agent: 'codex' as const, session: 's1' }
  const extra: Item[] = [
    { kind: 'message', side: 'claude', time: at('2026-10-08T01:05:00Z'), text: 'B', origin },
    { kind: 'message', side: 'claude', time: at('2026-10-08T01:10:00Z'), text: 'D', origin },
    { kind: 'message', side: 'claude', time: at('2026-10-08T02:00:00Z'), text: 'E', origin }, // 30分以上空いたので区切りが入る
  ]
  expect(summary(mergeItems(base, extra))).toEqual(['separator', 'me:A', 'claude:B', 'claude:C', 'claude:D', 'separator', 'claude:E'])
  expect(mergeItems(base, [])).toBe(base)
})

test('withCodex: 混ぜたあとの発言の数と最後の時刻を合わせる。混ぜるものが無ければそのまま', () => {
  const conversation = {
    title: 't',
    items: [{ kind: 'message' as const, side: 'me' as const, time: at('2026-10-08T01:00:00Z'), text: 'A' }],
    messageCount: 1,
    skippedLines: 0,
    firstTime: at('2026-10-08T01:00:00Z'),
    lastTime: at('2026-10-08T01:00:00Z'),
  }
  const origin = { agent: 'codex' as const, session: 's1' }
  const merged = withCodex(conversation, [
    { kind: 'tools', time: at('2026-10-08T01:01:00Z'), tools: [], origin },
    { kind: 'message', side: 'claude', time: at('2026-10-08T01:02:00Z'), text: 'B', origin },
  ])
  expect(merged.messageCount).toBe(2)
  expect(merged.lastTime).toBe(at('2026-10-08T01:02:00Z'))
  expect(withCodex(conversation, [])).toBe(conversation)
})
