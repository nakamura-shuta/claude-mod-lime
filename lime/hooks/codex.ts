// Codex（OpenAI の CLI）の会話記録を表示用データにし、Claude Code の会話に時刻順に混ぜる。
//
// 発言の残り方は Codex の版で違う（1つのファイルにはどちらか一方）:
//   古い形: event_msg の user_message / agent_message（payload.message が文）
//   新しい形: event_msg の item_completed（item.type が UserMessage / AgentMessage、item.content が [{ type: 'text' | 'Text', text }]）
// ツールはどちらも response_item の function_call / custom_tool_call と、その *_output。
// response_item の message は履歴の写しで同じ発言が何度も入るので使わない。reasoning は暗号化されているので出さない。
import type { Conversation, Item, Origin, ToolEntry } from './model'
import { truncate } from './text'
import { needsSeparator } from './time'

type CodexRecord = {
  type?: string
  timestamp?: string
  payload?: {
    type?: string
    message?: unknown
    item?: { type?: string; content?: unknown }
    name?: string
    call_id?: string
    arguments?: unknown
    input?: unknown
    output?: unknown
  }
}

/** 文字列、または [{ type: 'text' | 'Text', text }] の配列を、1つの文字列にする */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: { type?: string; text?: unknown }) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((text) => text !== '')
    .join('\n')
}

/** ツールの代表的な入力（実行したコマンドなど）。arguments は JSON の文字列のことが多い */
function summarize(args: unknown): string {
  let value: unknown = args
  if (typeof args === 'string') {
    try {
      value = JSON.parse(args)
    } catch {
      return truncate(args, 3, 300)
    }
  }
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>
    for (const key of ['cmd', 'command']) {
      const field = fields[key]
      if (typeof field === 'string') return truncate(field, 3, 300)
      if (Array.isArray(field)) return truncate(field.join(' '), 3, 300)
    }
  }
  return truncate(JSON.stringify(value ?? ''), 3, 300)
}

/** ツールの結果。output は文字列か { output, metadata: { exit_code } }（JSON の文字列のこともある） */
function resultOf(output: unknown): { result: string; isError: boolean } {
  let value: unknown = output
  if (typeof output === 'string') {
    try {
      value = JSON.parse(output)
    } catch {
      return { result: truncate(output), isError: false }
    }
  }
  if (value !== null && typeof value === 'object') {
    const fields = value as { output?: unknown; metadata?: { exit_code?: unknown } }
    const exitCode = fields.metadata?.exit_code
    const text = typeof fields.output === 'string' ? fields.output : JSON.stringify(value)
    return { result: truncate(text), isError: typeof exitCode === 'number' && exitCode !== 0 }
  }
  return { result: truncate(String(value ?? '')), isError: false }
}

/**
 * Codex の会話記録（JSONL）を表示用の項目にする。from より前の項目は出さない。
 * Codex への依頼は自分の側（me）、Codex の返事は相手の側（claude）に置き、origin で Codex のものと分かるようにする
 */
export function parseCodex(jsonl: string, session: string, from: number): Item[] {
  const origin: Origin = { agent: 'codex', session }
  const items: Item[] = []
  const pendingTools = new Map<string, ToolEntry>()
  let openGroup: Extract<Item, { kind: 'tools' }> | undefined

  // 発言が来たら、ツールのまとまりはそこで閉じる（Claude Code の会話と同じ）
  const addMessage = (side: 'me' | 'claude', time: number, text: string) => {
    const trimmed = text.trim()
    if (trimmed === '') return
    openGroup = undefined
    items.push({ kind: 'message', side, time, text: trimmed, origin })
  }

  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue
    let record: CodexRecord
    try {
      record = JSON.parse(line) as CodexRecord
    } catch {
      continue
    }
    const time = Date.parse(record.timestamp ?? '')
    if (Number.isNaN(time) || time < from) continue
    const payload = record.payload ?? {}

    if (record.type === 'event_msg') {
      if (payload.type === 'user_message') addMessage('me', time, textOf(payload.message))
      else if (payload.type === 'agent_message') addMessage('claude', time, textOf(payload.message))
      else if (payload.type === 'item_completed') {
        if (payload.item?.type === 'UserMessage') addMessage('me', time, textOf(payload.item.content))
        else if (payload.item?.type === 'AgentMessage') addMessage('claude', time, textOf(payload.item.content))
      }
    } else if (record.type === 'response_item') {
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        const entry: ToolEntry = {
          name: payload.name ?? 'tool',
          summary: summarize(payload.arguments ?? payload.input),
          result: '',
          isError: false,
        }
        if (payload.call_id !== undefined) pendingTools.set(payload.call_id, entry)
        if (openGroup === undefined) {
          openGroup = { kind: 'tools', time, tools: [], origin }
          items.push(openGroup)
        }
        openGroup.tools.push(entry)
      } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        const entry = payload.call_id === undefined ? undefined : pendingTools.get(payload.call_id)
        if (entry !== undefined) Object.assign(entry, resultOf(payload.output))
      }
    }
  }
  return items
}

/** base に extra を時刻順に混ぜ、日時の区切りを入れ直す（同じ時刻なら base が先） */
export function mergeItems(base: Item[], extra: Item[]): Item[] {
  if (extra.length === 0) return base
  const all = [...base.filter((item) => item.kind !== 'separator'), ...extra].sort((a, b) => a.time - b.time)
  const merged: Item[] = []
  let previous: number | undefined
  for (const item of all) {
    if (needsSeparator(previous, item.time)) merged.push({ kind: 'separator', time: item.time })
    merged.push(item)
    previous = item.time
  }
  return merged
}

/** 会話に Codex の項目を混ぜる。発言の数と最後の時刻（ヘッダの期間）も合わせる */
export function withCodex(conversation: Conversation, extra: Item[]): Conversation {
  if (extra.length === 0) return conversation
  const lastTime = extra.reduce((last, item) => Math.max(last, item.time), conversation.lastTime ?? 0)
  return {
    ...conversation,
    items: mergeItems(conversation.items, extra),
    messageCount: conversation.messageCount + extra.filter((item) => item.kind === 'message').length,
    lastTime,
  }
}
