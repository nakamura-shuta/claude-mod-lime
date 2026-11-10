import { expect, test } from 'claude-code/testing'
import { formatClock, formatDateTime, needsSeparator } from '../hooks/time'

const at = (iso: string) => Date.parse(iso)

test('日本時間で「14:32」と表示する', () => {
  expect(formatClock(at('2026-10-06T05:32:00Z'))).toBe('14:32')
  expect(formatClock(at('2026-10-06T15:05:00Z'))).toBe('00:05')
})

test('日付と曜日と時刻を「2026/10/06（火）14:32」と表示する', () => {
  expect(formatDateTime(at('2026-10-06T05:32:00Z'))).toBe('2026/10/06（火）14:32')
  // UTC では 10/06 でも、日本時間では 10/07（水）
  expect(formatDateTime(at('2026-10-06T15:05:00Z'))).toBe('2026/10/07（水）00:05')
})

test('最初・日付が変わったとき・30分以上空いたときに区切りを入れる', () => {
  expect(needsSeparator(undefined, at('2026-10-06T05:00:00Z'))).toBe(true)
  expect(needsSeparator(at('2026-10-06T05:00:00Z'), at('2026-10-06T05:29:59Z'))).toBe(false)
  expect(needsSeparator(at('2026-10-06T05:00:00Z'), at('2026-10-06T05:30:00Z'))).toBe(true)
  // 日本時間の 23:59 → 00:01（2分しか空いていないが、日付が変わる）
  expect(needsSeparator(at('2026-10-06T14:59:00Z'), at('2026-10-06T15:01:00Z'))).toBe(true)
})
