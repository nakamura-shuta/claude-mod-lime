// 縮小画像の名前と、作るコマンド（純粋な関数）。作るのは register.ts の preparePreviews（macOS の sips と qlmanage）。
import type { PreviewTarget } from './previews'

/** 長い辺（px）。表示は 240px までなので、高精細の画面でもぼやけない大きさ */
export const THUMB_SIZE = 480

/** 縮小画像のファイル名。「絶対パス＋更新時刻＋サイズ」のハッシュなので、元のファイルが変われば作り直す */
export async function thumbName(path: string, mtimeMs: number, size: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${path}\n${mtimeMs}\n${size}`))
  let hex = ''
  for (const byte of new Uint8Array(digest).slice(0, 16)) hex += byte.toString(16).padStart(2, '0')
  return `${hex}.png`
}

/**
 * 縮小画像を作るコマンド（試す順）。どれも workDir に PNG を1つ書く（名前はコマンドで違う）。
 * 画像は sips、svg は sips のあと qlmanage、HTML・PDF は qlmanage（HTML は先頭部分、PDF は1ページ目）。
 * 入力は / で始まる絶対パスなので、オプションと取り違えられない
 */
export function thumbCommands(target: PreviewTarget, workDir: string): string[][] {
  const sips = ['sips', '-s', 'format', 'png', '-Z', String(THUMB_SIZE), target.path, '--out', `${workDir}/thumb.png`]
  const quickLook = ['qlmanage', '-t', '-s', String(THUMB_SIZE), '-o', workDir, target.path]
  switch (target.kind) {
    case 'image':
      return [sips]
    case 'svg':
      return [sips, quickLook]
    case 'html':
    case 'pdf':
      return [quickLook]
  }
}
