import { expect, test } from 'claude-code/testing'
import { planBatches, planRead } from '../hooks/jsonl'

test('planBatches: 上限に収まれば1つのまとまりにする', () => {
  expect(planBatches([10, 10, 10], 100)).toEqual({ batches: [{ start: 1, end: 3 }], tooLong: [] })
})

test('planBatches: 上限を超える前に分ける（改行の1バイトも数える）', () => {
  // 各行 60 + 改行 1 = 61 バイト。2行で 122 > 100 なので1行ずつになる
  expect(planBatches([60, 60, 60], 100)).toEqual({ batches: [{ start: 1, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 3 }], tooLong: [] })
  // 49 + 1 = 50 バイトなら、ちょうど2行で 100
  expect(planBatches([49, 49, 49], 100)).toEqual({ batches: [{ start: 1, end: 2 }, { start: 3, end: 3 }], tooLong: [] })
})

test('planBatches: 1行だけで上限を超える行は読まずに数える', () => {
  expect(planBatches([10, 200, 10], 100)).toEqual({ batches: [{ start: 1, end: 1 }, { start: 3, end: 3 }], tooLong: [2] })
})

test('planBatches: 空のファイル', () => {
  expect(planBatches([], 100)).toEqual({ batches: [], tooLong: [] })
})

test('planRead: 全部収まれば、全部を読む', () => {
  expect(planRead([10, 10, 10], 100, 50)).toEqual({ batches: [{ start: 1, end: 3 }], tooLong: [], omittedLines: 0 })
})

test('planRead: 上限を超えるなら、新しい側（末尾）だけを読み、読まなかった行を数える', () => {
  expect(planRead([10, 10, 10, 10], 25, 100)).toEqual({ batches: [{ start: 3, end: 4 }], tooLong: [], omittedLines: 2 })
})

test('planRead: 1行で大きすぎる行は、読む量に数えない', () => {
  expect(planRead([10, 10, 200, 10], 25, 100)).toEqual({ batches: [{ start: 2, end: 2 }, { start: 4, end: 4 }], tooLong: [3], omittedLines: 1 })
})

test('planRead: 既定の上限（読む量 30,000,000 バイト・1回 3,500,000 バイト）', () => {
  const plan = planRead(Array(11).fill(3_000_000))
  expect(plan.omittedLines).toBe(2)
  expect(plan.batches).toHaveLength(9)
  expect(plan.batches[0]).toEqual({ start: 3, end: 3 })
})

test('planRead: 空のファイル', () => {
  expect(planRead([])).toEqual({ batches: [], tooLong: [], omittedLines: 0 })
})
