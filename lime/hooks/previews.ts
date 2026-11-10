// 発言に書かれたローカルのファイル（画像・HTML・PDF）のパスを拾い、絶対パスにする。縮小画像は register.ts が作る（名前と作り方は thumbs.ts）。
// 拾うのは次の2つだけ（文中にファイル名が出てくるだけのものは、うるさくなるので拾わない）。http(s): などの外のリンクは拾わない。
// - Markdown のリンク: [label](</abs/path>)・[label](/abs/path)・[label](~/path)。%20 などは戻す
// - 1行に単独で書かれたパス（前後の空白と、囲みのバッククォートは許す）: 絶対パス・~/・相対パス

export type PreviewKind = 'image' | 'svg' | 'html' | 'pdf'

/** 縮小画像にする1つのファイル（絶対パス） */
export type PreviewTarget = { path: string; kind: PreviewKind }

const KINDS: Record<string, PreviewKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  svg: 'svg',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
}

/** 拡張子から種類を決める。対象外なら undefined */
export function previewKind(path: string): PreviewKind | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  return ext === undefined ? undefined : KINDS[ext]
}

// [label](<path>) と [label](path)。絶対パスか ~/ で始まるものだけを使う（後で確かめる）
const MD_ANGLE = /\[[^\]\n]*\]\(<([^<>\n]+)>\)/g
const MD_PLAIN = /\[[^\]\n]*\]\(([^\s()<>]+)\)/g
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
// 文の行（箇条書きの印で始まる・文中に絶対パスがある・句読点やコロンがある）は相対パスとみなさない。
// 相対パスは実在を確かめてから出すので誤りは出ないが、文の行まで調べないように
const PROSE = /^(?:[-*+]|\d+\.)\s|\s[/~]|[、。，．：；（）「」]|:\s/

/** %20 などを戻す。戻せない書き方（% の後が数字でないなど）は、そのまま */
function decodePercent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 発言から、パスの候補を書かれた順に取り出す（対象の拡張子のものだけ。まだ解決しない） */
export function extractPaths(text: string): string[] {
  const found: string[] = []
  const add = (path: string) => {
    if (path !== '' && !SCHEME.test(path) && previewKind(path) !== undefined) found.push(path)
  }
  for (const pattern of [MD_ANGLE, MD_PLAIN]) {
    for (const match of text.matchAll(pattern)) {
      const path = decodePercent((match[1] ?? '').trim())
      if (path.startsWith('/') || path.startsWith('~/')) add(path)
    }
  }
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim()
    // Markdown のリンクの行は上で拾った
    if (line.includes('](')) continue
    const fenced = /^(`+)(.+)\1$/.exec(line)
    const path = (fenced?.[2] ?? line).trim()
    if (path.includes('`')) continue
    if (!path.startsWith('/') && !path.startsWith('~/') && PROSE.test(path)) continue
    add(path)
  }
  return found
}

/** パスの . と .. をたたむ（/a/./b/../c → /a/c） */
function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** 候補を絶対パスにする。相対パスはその発言の cwd を基準にする。決められなければ undefined */
export function resolvePath(candidate: string, cwd: string | undefined, home: string): string | undefined {
  if (candidate.startsWith('/')) return normalize(candidate)
  if (candidate.startsWith('~/')) return home.startsWith('/') ? normalize(`${home}/${candidate.slice(2)}`) : undefined
  if (candidate.startsWith('~')) return undefined // ~user/… は扱わない
  if (cwd === undefined || !cwd.startsWith('/')) return undefined
  return normalize(`${cwd}/${candidate}`)
}

/**
 * 発言に書かれたパスを、書かれたままの形（candidate）と、縮小画像にするファイルの組にする。
 * 同じ書き方は1回だけ。ファイルが実在するかは調べない
 */
export function previewTargets(
  text: string,
  cwd: string | undefined,
  home: string,
): { candidate: string; target: PreviewTarget }[] {
  const pairs: { candidate: string; target: PreviewTarget }[] = []
  const seen = new Set<string>()
  for (const candidate of extractPaths(text)) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    const path = resolvePath(candidate, cwd, home)
    const kind = path === undefined ? undefined : previewKind(path)
    if (path === undefined || kind === undefined) continue
    pairs.push({ candidate, target: { path, kind } })
  }
  return pairs
}

/** パスの最後の部分（キャプションに出すファイル名） */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
