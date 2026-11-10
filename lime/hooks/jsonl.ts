// 大きな JSONL（会話記録）を読む計画（純粋な関数）。読むのは register.ts の readJsonl。
// $.process.run の出力は 4 MiB までなので、awk で行ごとのバイト数を数えてから、sed で 4 MiB 未満ずつ読む。

/** sed -n 'start,endp' に渡す行番号（1 から数え、両端を含む） */
export type Batch = { start: number; end: number }

export type BatchPlan = {
  batches: Batch[]
  /** 1行だけで上限を超えるため読まない行の番号 */
  tooLong: number[]
}

export type ReadPlan = BatchPlan & {
  /** 読む量の上限を超えたため読まない、古い側（先頭から）の行の数 */
  omittedLines: number
}

/** 1回に読む上限。$.process.run の出力の上限（4,194,304 バイト）に余裕を見る */
export const DEFAULT_MAX_BATCH_BYTES = 3_500_000
/**
 * 読む量の上限（新しい側から）。大きな記録は新しい側だけを読む。
 * HTML の書き出し上限（4 MiB）と、読んだ後の変換の時間（JS の処理はフックの 10 秒に数える）に収めるため
 */
export const DEFAULT_MAX_READ_BYTES = 30_000_000

/** lineBytes[i] は i+1 行目のバイト数（改行を含まない） */
export function planBatches(lineBytes: readonly number[], maxBytes = DEFAULT_MAX_BATCH_BYTES): BatchPlan {
  const batches: Batch[] = []
  const tooLong: number[] = []
  let start = 0 // 0 はまとまりが開いていないこと
  let size = 0

  const close = (end: number) => {
    if (start !== 0) batches.push({ start, end })
    start = 0
    size = 0
  }

  lineBytes.forEach((bytes, index) => {
    const line = index + 1
    const withNewline = bytes + 1
    if (withNewline > maxBytes) {
      close(line - 1)
      tooLong.push(line)
      return
    }
    if (start !== 0 && size + withNewline > maxBytes) close(line - 1)
    if (start === 0) start = line
    size += withNewline
  })
  close(lineBytes.length)
  return { batches, tooLong }
}

/** 新しい側（末尾）から合計 maxReadBytes までの行を、まとまりに分けて読む計画 */
export function planRead(
  lineBytes: readonly number[],
  maxReadBytes = DEFAULT_MAX_READ_BYTES,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
): ReadPlan {
  let first = lineBytes.length // 読み始める行（0 から数える）
  let total = 0
  for (let index = lineBytes.length - 1; index >= 0; index--) {
    const withNewline = (lineBytes[index] ?? 0) + 1
    if (withNewline > maxBatchBytes) {
      // 読まない行（tooLong）なので、読む量に数えない
      first = index
      continue
    }
    if (total + withNewline > maxReadBytes) break
    total += withNewline
    first = index
  }
  const tail = planBatches(lineBytes.slice(first), maxBatchBytes)
  return {
    batches: tail.batches.map((batch) => ({ start: batch.start + first, end: batch.end + first })),
    tooLong: tail.tooLong.map((line) => line + first),
    omittedLines: first,
  }
}
