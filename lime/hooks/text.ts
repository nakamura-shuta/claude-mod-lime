// 文字列の小道具（会話記録の解釈と、Claude に渡す文で使う）。

/** 長い文字列を、行数と文字数の上限で切り詰め、残りの量を書き添える */
export function truncate(text: string, maxLines = 20, maxChars = 2000): string {
  const lines = text.split('\n')
  let kept = lines.slice(0, maxLines).join('\n')
  if (kept.length > maxChars) kept = kept.slice(0, maxChars)
  if (kept.length === text.length) return text
  const restLines = lines.length - kept.split('\n').length
  return restLines > 0 ? `${kept}\n…（残り ${restLines} 行）` : `${kept}…（以下略）`
}
