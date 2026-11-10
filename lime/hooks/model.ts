// 表示用データの型。transcript.ts・codex.ts が作り、render-html.ts が描く。
export type Side = 'me' | 'claude'

export type ToolEntry = {
  name: string
  /** 代表的な入力（Bash ならコマンド、Read ならファイルのパスなど） */
  summary: string
  /** 結果の先頭（最大20行・2,000文字） */
  result: string
  isError: boolean
}

/** Codex の会話から混ぜた項目の印（session は Codex の会話の ID）。印が無い項目は Claude Code の会話のもの */
export type Origin = { agent: 'codex'; session: string }

export type Item =
  /** cwd は、その発言のときの作業フォルダ（発言に書かれた相対パスの基準） */
  | { kind: 'message'; side: Side; time: number; text: string; cwd?: string; origin?: Origin }
  | { kind: 'tools'; time: number; tools: ToolEntry[]; origin?: Origin }
  | { kind: 'notice'; time: number; text: string }
  | { kind: 'separator'; time: number }

/** 縮小画像。src は HTML からの相対パス、name はキャプションに出すファイル名 */
export type Preview = { src: string; name: string }

/** 1つの発言の縮小画像。キーは発言に書かれたままのパス（extractPaths が返す形。描くときに行ごとに同じ形で拾って引く） */
export type MessagePreviews = ReadonlyMap<string, Preview>

export type Conversation = {
  /** 記録の ai-title の最後の値（無ければ undefined） */
  title: string | undefined
  items: Item[]
  messageCount: number
  /** JSON として読めなかった行の数 */
  skippedLines: number
  firstTime: number | undefined
  lastTime: number | undefined
}
