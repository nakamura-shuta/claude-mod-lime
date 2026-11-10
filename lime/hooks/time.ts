// 時刻の表示（日本時間）と、日時の区切りを入れるかの判定。
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 前の項目からこれ以上空いたら区切りを入れる */
export const GAP_MS = 30 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')
const jst = (ms: number) => new Date(ms + JST_OFFSET_MS)

/** 「14:32」 */
export function formatClock(ms: number): string {
  const d = jst(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 「2026/10/06（火）14:32」 */
export function formatDateTime(ms: number): string {
  const d = jst(ms)
  const weekday = WEEKDAYS[d.getUTCDay()] ?? ''
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}（${weekday}）${formatClock(ms)}`
}

/** 「10/6 14:32」 */
export function formatMonthDayClock(ms: number): string {
  const d = jst(ms)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${formatClock(ms)}`
}

function dayKey(ms: number): string {
  const d = jst(ms)
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
}

/** a と b が、日本時間で同じ日か */
export function isSameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b)
}

/** 時刻 previous の項目の後に、時刻 next の項目が来るとき、間に区切りを入れるか */
export function needsSeparator(previous: number | undefined, next: number): boolean {
  return previous === undefined || dayKey(previous) !== dayKey(next) || next - previous >= GAP_MS
}
