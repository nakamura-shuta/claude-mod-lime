// Claude Code の会話記録（~/.claude/projects/*/<ID>.jsonl）を、表示用データにする。
import type { Conversation, Item, ToolEntry } from './model'
import { truncate } from './text'
import { needsSeparator } from './time'

type Block = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type TranscriptRecord = {
  type?: string
  subtype?: string
  timestamp?: string
  /** その行のときの作業フォルダ */
  cwd?: string
  isMeta?: boolean
  isSidechain?: boolean
  isApiErrorMessage?: boolean
  isCompactSummary?: boolean
  aiTitle?: string
  content?: unknown
  origin?: { kind?: string }
  attachment?: {
    type?: string
    prompt?: unknown
    commandMode?: string
    humanTurn?: boolean
    isMeta?: boolean
    origin?: { kind?: string }
  }
  message?: { content?: unknown }
}

const SYSTEM_TAGS = /<(system-reminder|local-command-caveat)>[\s\S]*?<\/\1>/g
const ANSI = /\u001b\[[0-9;]*m/g
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'url', 'query', 'pattern', 'description', 'skill', 'prompt']

/** 文字列、または text / image ブロックの配列を、1つの文字列にする */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[])
    .map((block) => (block.type === 'text' ? (block.text ?? '') : block.type === 'image' ? '[画像]' : ''))
    .filter((text) => text !== '')
    .join('\n')
}

/** ツールの代表的な入力を1つ選ぶ（無ければ入力の JSON） */
function summarize(input: unknown): string {
  const fields = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  for (const key of SUMMARY_KEYS) {
    const value = fields[key]
    if (typeof value === 'string' && value !== '') return truncate(value, 3, 300)
  }
  return truncate(JSON.stringify(input ?? {}), 3, 300)
}

/** コマンドの実行などのお知らせなら、その文を返す。お知らせでなければ undefined */
function noticeOf(text: string): string | undefined {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (name) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
    return `${name[1] ?? ''}${args === '' ? '' : ` ${args}`}`.trim()
  }
  const stdout = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text)
  if (stdout) return truncate((stdout[1] ?? '').replace(ANSI, '').trim(), 2, 200)
  if (/^\[Request interrupted by user/.test(text.trim())) return '（中断しました）'
  return undefined
}

export function parseTranscript(jsonl: string): Conversation {
  const raw: Item[] = []
  const pendingTools = new Map<string, ToolEntry>()
  let title: string | undefined
  let skippedLines = 0
  let openGroup: Extract<Item, { kind: 'tools' }> | undefined

  // 発言やお知らせが来たら、ツールのまとまりはそこで閉じる
  const add = (item: Item) => {
    openGroup = undefined
    raw.push(item)
  }

  const lines = jsonl.split('\n')
  // 改行で終わっていない最後の行は、書き込み途中（ターンの途中で /lime を実行したとき）。壊れた行と数えない
  const partialTailIndex = jsonl.endsWith('\n') ? -1 : lines.length - 1
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    let record: TranscriptRecord
    try {
      record = JSON.parse(line) as TranscriptRecord
    } catch {
      if (index !== partialTailIndex) skippedLines++
      continue
    }
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      title = record.aiTitle
      continue
    }
    if (record.isMeta === true || record.isSidechain === true) continue
    const time = Date.parse(record.timestamp ?? '')
    if (Number.isNaN(time)) continue
    // 発言に書かれた相対パスの基準
    const where = typeof record.cwd === 'string' && record.cwd !== '' ? { cwd: record.cwd } : {}

    // Claude の作業中に送った発言は、user ではなく attachment（queued_command）として残る。
    // 人が打ったもの（humanTurn・prompt）だけを発言にする（バックグラウンドの完了通知などは出さない）
    if (record.type === 'attachment') {
      const queued = record.attachment
      // 古い版（2.1.273 以前）には humanTurn が無く、origin.kind が human
      const typedByHuman = queued?.humanTurn === true || (queued?.origin?.kind === 'human' && queued.isMeta !== true)
      if (queued?.type === 'queued_command' && typedByHuman && queued.commandMode === 'prompt' && typeof queued.prompt === 'string') {
        const text = queued.prompt.replace(SYSTEM_TAGS, '').trim()
        if (text !== '') add({ kind: 'message', side: 'me', time, text, ...where })
      }
      continue
    }
    // スラッシュコマンドの実行は system（local_command）として残ることもある
    if (record.type === 'system') {
      if (record.subtype === 'local_command' && typeof record.content === 'string') {
        const notice = noticeOf(record.content)
        if (notice !== undefined && notice !== '') add({ kind: 'notice', time, text: notice })
      }
      continue
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue

    const content = record.message?.content
    if (record.isApiErrorMessage === true) {
      add({ kind: 'notice', time, text: `API エラー: ${(textOf(content).split('\n')[0] ?? '').slice(0, 200)}` })
      continue
    }
    const blocks: Block[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Block[]) : []

    if (record.type === 'user') {
      // 会話の圧縮で入る要約（数千〜数万字）は、お知らせ1行にする
      if (record.isCompactSummary === true) {
        add({ kind: 'notice', time, text: '（ここまでの会話を要約しました）' })
        continue
      }
      // 本文を発言にするのは、人が打った行だけ。ツールの結果はどの行でも結び付ける
      const byHuman = record.origin?.kind === undefined || record.origin.kind === 'human'
      const parts: string[] = []
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const entry = block.tool_use_id === undefined ? undefined : pendingTools.get(block.tool_use_id)
          if (entry) {
            entry.result = truncate(textOf(block.content).replace(ANSI, ''))
            entry.isError = block.is_error === true
          }
        } else if (!byHuman) {
          continue
        } else if (block.type === 'image') {
          parts.push('[画像]')
        } else if (block.type === 'text' && typeof block.text === 'string') {
          const notice = noticeOf(block.text)
          if (notice !== undefined) {
            if (notice !== '') add({ kind: 'notice', time, text: notice })
          } else {
            const cleaned = block.text.replace(SYSTEM_TAGS, '').trim()
            if (cleaned !== '') parts.push(cleaned)
          }
        }
      }
      if (parts.length > 0) add({ kind: 'message', side: 'me', time, text: parts.join('\n'), ...where })
      continue
    }

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        add({ kind: 'message', side: 'claude', time, text: block.text.trim(), ...where })
      } else if (block.type === 'tool_use') {
        const entry: ToolEntry = { name: block.name ?? 'tool', summary: summarize(block.input), result: '', isError: false }
        if (block.id !== undefined) pendingTools.set(block.id, entry)
        if (openGroup === undefined) {
          openGroup = { kind: 'tools', time, tools: [] }
          raw.push(openGroup)
        }
        openGroup.tools.push(entry)
      }
    }
  }

  const items: Item[] = []
  let previous: number | undefined
  for (const item of raw) {
    if (needsSeparator(previous, item.time)) items.push({ kind: 'separator', time: item.time })
    items.push(item)
    previous = item.time
  }
  return {
    title,
    items,
    messageCount: raw.filter((item) => item.kind === 'message').length,
    skippedLines,
    firstTime: raw[0]?.time,
    lastTime: raw.at(-1)?.time,
  }
}
