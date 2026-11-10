// Codex の会話記録（~/.codex/sessions/<年>/<月>/<日>/*.jsonl）を探すときの純粋な関数: 日付のフォルダ・1行目の解釈・作業フォルダの判定。
// 探すのは register.ts の findCodexSessions（/lime が会話に混ぜ、/lime-codex が Claude に渡す）。中身の解釈は codex.ts。
import { JST_OFFSET_MS } from './time'

const DAY_MS = 24 * 60 * 60 * 1000

export type CodexMeta = { id: string; cwd: string }
export type CodexSession = { path: string; size: number; meta: CodexMeta }

/** 1行目（session_meta）から、会話の ID と作業フォルダを取り出す。形が違えば undefined */
export function parseCodexMeta(firstLine: string): CodexMeta | undefined {
  try {
    const record = JSON.parse(firstLine) as { type?: string; payload?: { id?: unknown; cwd?: unknown } }
    const id = record.payload?.id
    const cwd = record.payload?.cwd
    if (record.type !== 'session_meta' || typeof id !== 'string' || typeof cwd !== 'string') return undefined
    return { id, cwd }
  } catch {
    return undefined
  }
}

/** Codex の作業フォルダが、cwds のどれかと同じか、その下にあるか（名前が似ているだけの隣のフォルダは合わない） */
export function matchesCwd(codexCwd: string, cwds: readonly string[]): boolean {
  return cwds.some((cwd) => codexCwd === cwd || codexCwd.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`))
}

/**
 * from〜to に書かれた会話記録がありうる日付のフォルダ（'2026/10/08' の形、日本時間）。
 * Codex は始めた日のフォルダに書き続けるので、前の日に始めた会話も拾えるよう、1日前から探す
 */
export function codexDayDirs(from: number, to: number): string[] {
  const dirs: string[] = []
  const last = dayKey(to)
  for (let time = from - DAY_MS; ; time += DAY_MS) {
    const key = dayKey(time)
    if (!dirs.includes(key)) dirs.push(key)
    if (key === last || time > to) break
  }
  return dirs
}

function dayKey(ms: number): string {
  const date = new Date(ms + JST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`
}
