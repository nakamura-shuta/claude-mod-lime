// lime のフックのモジュール（hooks.json が読む、ただ1つの入口）。$ を使う処理は、すべてこのファイルにある。
//   /lime [セッションID]  会話を吹き出し風の HTML にして cmux の横に開き、会話が進むと更新する
//   /lime-codex on|off    ON なら、発言のたびに同じ作業フォルダの Codex のやりとりを Claude に渡す
// 会話記録の解釈や HTML の組み立てなど、$ を使わない処理は、ほかのファイルの純粋な関数にしている。
//
// mods の決まり（読み込むときに検査される。claude plugin validate で確かめられる）:
// - フックのモジュールはプラグインに1つだけ（hooks.json の modules に2つ目を書くと断られる）。
// - $ は `$.名詞.メソッド()` の形で呼ぶ。引数として渡してよいのは、このファイルで宣言した関数だけ
//   （そこからさらに、このファイルの関数へ渡すのも可）。import した関数には渡せない。
//   別名にする（const x = $）・オブジェクトに入れる・返すのも不可。$ を使わない関数は、どのファイルから import してもよい。
// - import した関数へ $ を渡すのを、2.1.300 の validate は通すが、2.1.296 は読み込みを断る。使っている版の validate でも確かめる。
// - フックの時間の上限は 10 秒（$ の呼び出しを待つ時間は数えない）。
import type { CommandRunResult, EngineInterface, Register } from 'claude-code'
import { findBrowserSurface } from './cmux'
import { parseCodex, withCodex } from './codex'
import type { CodexContext } from './codex-context'
import { formatCodexContext } from './codex-context'
import type { CodexMeta, CodexSession } from './codex-sessions'
import { codexDayDirs, matchesCwd, parseCodexMeta } from './codex-sessions'
import { planRead } from './jsonl'
import type { Conversation, Item, MessagePreviews, Preview } from './model'
import type { PreviewTarget } from './previews'
import { fileName, previewTargets } from './previews'
import { renderHtmlWithin } from './render-html'
import { thumbCommands, thumbName } from './thumbs'
import { parseTranscript } from './transcript'

// ── フックの登録 ──

export const register: Register = (on) => {
  // セッションの始まりと、mod の読み込み直しで起きる
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lime',
      description: '会話をチャットの吹き出し風に表示する（cmux の横に HTML で開き、会話が進んだら更新する）',
      argumentHint: '[セッションID]',
      immediate: true, // Claude の作業中でも、すぐ実行できる
    })
    await $.command.register({
      name: 'lime-codex',
      description: '同じ作業フォルダの Codex のやりとりを、発言のたびに Claude に渡す（既定は off）',
      argumentHint: 'on|off',
      immediate: true,
    })
    await resumeLime($, e.isInteractive)
    return next(e)
  })

  on('command.run', { command: 'lime' }, async ($, e) => runLime($, e.args)).catch(() => ({
    text: 'lime: 途中で止まりました（時間切れか、思わぬエラー）',
  }))

  on('command.run', { command: 'lime-codex' }, async ($, e) => runLimeCodex($, e.args))

  // 発言が会話に入る直前。添えるのは添えものなので、どんな失敗でも発言はそのまま通す
  // （.catch を付けていないので、フック自体が時間切れなどで失敗しても、飛ばされて発言は通る）
  on('prompt.submit', async ($, e, next) => {
    const activity = await collectCodexActivity($).catch(() => undefined)
    if (activity === undefined) return next(e)
    $.ui.toast(`Codex のやりとり ${activity.count} 件を Claude に渡しました`)
    return next({ ...e, context: [...(e.context ?? []), activity.text] })
  })
}

// ── /lime: 会話記録を探して描き、cmux の横に開いて、自動更新を始める ──

/** セッション ID の形。ファイル名にも使うので、パスとして危ない値（../ など）は受け付けない */
const ID_PATTERN = /^[A-Za-z0-9-]+$/

/** /lime [セッションID] */
async function runLime($: EngineInterface, args: string): Promise<CommandRunResult> {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return { text: 'HOME が分からないため開けません' }
  const id = args.trim() || (await $.session.id())
  if (!ID_PATTERN.test(id)) return { text: `ID は英数字と - だけで指定してください: ${id}` }

  const projects = `${home}/.claude/projects`
  let found: string | undefined
  try {
    found = await findTranscript($, projects, id)
  } catch (error) {
    return { text: `${projects} を読めませんでした: ${String(error)}` }
  }
  if (found === undefined) {
    $.ui.toast(`見つかりません: ${id}`)
    // 始めたばかりの会話は、最初の発言まで記録のファイルが無い
    const hint = args.trim() === '' ? '（始めたばかりの会話は、何か発言してから開いてください）' : ''
    return { text: `会話記録が見つかりません: ${id}${hint}` }
  }
  const transcript = found
  const paths = limePaths(home, id)

  const sizeAtStart = (await $.fs.stat(transcript).catch(() => undefined))?.size
  // 会話の中身なので、フォルダごと他人に読ませない（HTML は書いてから 600 にするので、その間も守る）
  await $.process.run(['mkdir', '-p', paths.dir]).catch(() => undefined)
  await $.process.run(['chmod', '700', paths.dir]).catch(() => undefined)
  let first: Built
  try {
    first = await build($, home, id, transcript)
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error) }
  }

  // 開いているタブがあれば、読み込み直すだけ（打ち直してもタブを増やさない。再開もここを通る）。
  // 無ければ cmux の横に開く。だめなら既定のブラウザ、それもだめならパスを知らせる（この2つは自動更新しない）
  const tab = await findTab($, paths.html).catch(() => undefined)
  const reused = tab !== undefined && (await reloadTab($, tab))
  if (!reused && !(await openInCmux($, paths.html))) {
    const viaOpen = await $.process.run(['open', paths.html], { timeoutMs: CMUX_TIMEOUT_MS }).catch(() => undefined)
    if (viaOpen?.exitCode !== 0) {
      $.ui.toast(`HTML を作りました: ${paths.html}`)
      return { text: `開けなかったので、HTML のパスを表示します: ${paths.html}` }
    }
    $.ui.toast('会話を開きました')
    return { text: `${first.messageCount} 件の発言を開きました（${paths.html}）` }
  }

  // 止めるのは、cmux tree が答えてタブが無い（閉じられた）ときだけ。cmux tree の失敗は例外なので、その回を飛ばす
  await startWatcher($, id, first.watched, sizeAtStart, async () => {
    const surface = await findTab($, paths.html)
    if (surface === undefined) return undefined
    const { watched } = await build($, home, id, transcript)
    await refreshTab($, surface)
    return watched
  })

  if (reused) {
    $.ui.toast('開いているタブを更新しました')
    return { text: `開いているタブを更新しました（${first.messageCount} 件の発言。会話が進むと更新します。${paths.html}）` }
  }
  $.ui.toast('会話を開きました')
  return { text: `${first.messageCount} 件の発言を開きました（会話が進むと更新します。${paths.html}）` }
}

/** 会話記録 <projects>/<プロジェクト>/<ID>.jsonl を探す。無ければ undefined */
async function findTranscript($: EngineInterface, projects: string, id: string): Promise<string | undefined> {
  for (const entry of await $.fs.list(projects)) {
    if (entry.kind !== 'dir') continue
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (await $.fs.exists(path)) return path
  }
  return undefined
}

// ── /lime: 起動し直したときの再開 ──
// 起動し直すとタイマーは消えるが、cmux のタブは開いたまま残り、更新されなくなる。
// そこで、この会話の HTML を開いているタブがあれば /lime を実行し直す（タブは使い回し、古いタイマーは合言葉で止まる）。

/** 起動したとき（session.start）にタブを探す上限。起動を待たせすぎないよう短く */
const RESUME_TIMEOUT_MS = 5000

/**
 * 起動し直したら、自動更新を再開する（session.start から呼ぶ。失敗しても起動は止めない）。
 * 人がいない実行（claude -p・SDK）では再開しない（会話記録に /lime の行を足したり、タイマーを残したりしない）
 */
async function resumeLime($: EngineInterface, isInteractive: boolean): Promise<void> {
  if (!isInteractive || !(await hasOpenTab($).catch(() => false))) return
  // $.command.run はキューに入り、セッションが空いてから動く。session.start の中で待つと、session.start が終わらず
  // セッションも空かない待ち合いになりうるので、待たない。実行したコマンドは会話記録に1行残る（打ったときと同じ）
  void $.command.run({ command: 'lime', args: '' }).catch(() => undefined)
}

async function hasOpenTab($: EngineInterface): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return false
  const id = await $.session.id()
  if (!ID_PATTERN.test(id)) return false
  const { html } = limePaths(home, id)
  return (await $.fs.exists(html)) && (await findTab($, html, RESUME_TIMEOUT_MS)) !== undefined
}

// ── /lime: 1回の描画（会話記録を読み、Codex の会話を混ぜ、縮小画像を用意して、HTML を書き出す） ──

/** $.fs.write の上限 4 MiB（4,194,304 バイト）より少し小さく */
const MAX_HTML_BYTES = 4_000_000

/**
 * 書き出す場所: ~/.claude/lime/<ID>.html。縮小画像は隣の <ID>-assets/
 * （cmux のブラウザは HTML と同じフォルダの下しか読めないため）
 */
function limePaths(home: string, id: string) {
  const dir = `${home}/.claude/lime`
  return { dir, html: `${dir}/${id}.html`, assets: { dir: `${dir}/${id}-assets`, href: `${id}-assets` } }
}

type Built = { messageCount: number; watched: Watched }

/** 会話 id の HTML を作って書き出す。失敗したら、理由を文にした例外を投げる */
async function build($: EngineInterface, home: string, id: string, transcript: string): Promise<Built> {
  const paths = limePaths(home, id)
  const read = await readJsonl($, transcript)
  const claude = parseTranscript(read.jsonl)
  // Codex と縮小画像は添えもの。失敗しても、それ抜きで書き出す
  const codex = await readCodex($, home, claude).catch(() => ({ items: [], files: [] }))
  const conversation = withCodex(claude, codex.items)
  const previews = await preparePreviews($, conversation, home, paths.assets).catch(() => new Map<Item, MessagePreviews>())
  const builtAt = await $.clock.now() // ↻ のボタンの説明に出す
  const options = { sessionId: id, tooLongLines: read.tooLongLines, omittedLines: read.omittedLines, previews, builtAt }
  const html = renderHtmlWithin(conversation, options, MAX_HTML_BYTES)
  await $.fs.write(paths.html, html).catch((error: unknown) => {
    throw new Error(`HTML を書き出せませんでした: ${String(error)}`)
  })
  await $.process.run(['chmod', '600', paths.html]).catch(() => undefined)
  return { messageCount: conversation.messageCount, watched: { transcript, codex: codex.files } }
}

/** 会話の期間に、同じ作業フォルダ（かその下）で書かれた Codex の会話を読む。作業フォルダは各発言の cwd（cd すれば複数） */
async function readCodex(
  $: EngineInterface,
  home: string,
  conversation: Conversation,
): Promise<{ items: Item[]; files: string[] }> {
  const from = conversation.firstTime
  const cwds = [...new Set(conversation.items.flatMap((item) => (item.kind === 'message' && item.cwd !== undefined ? [item.cwd] : [])))]
  if (from === undefined || cwds.length === 0) return { items: [], files: [] }
  const items: Item[] = []
  const files: string[] = []
  const to = await $.clock.now()
  for (const session of await findCodexSessions($, { home, from, to, cwds, timeoutMs: READ_TIMEOUT_MS })) {
    const { jsonl } = await readJsonl($, session.path)
    items.push(...parseCodex(jsonl, session.meta.id, from))
    files.push(session.path)
  }
  return { items, files }
}

// ── /lime: 自動更新（会話記録と、混ぜた Codex の会話記録が伸びたら、作り直してタブを読み込み直す） ──
// /reload-plugins の後も古いモジュールのタイマーが残りうるが、新しいモジュールの変数は空から始まるので cancel できない。
// そこで会話ごとの合言葉を $.store（新旧のモジュールから同じものが見え、起動し直しても残る）に置き、タイマーは毎回それを読んで、
// 自分のものでなければ止まる。こうして、いちばん新しい自動更新だけが動く（/lime の打ち直しも同じ）。
// 起動し直すとタイマーは消える（再開は resumeLime）。

const WATCH_MS = 3000

/** 見張るファイル。会話記録が読めない回は飛ばす。Codex の会話記録は、消えていたら 0 と数える */
type Watched = { transcript: string; codex: string[] }

/**
 * 会話 id の自動更新を始める。大きさの合計が変わり、1回分落ち着いたら（書き込みが続く間は待つ）rebuild を呼ぶ。
 * rebuild は作り直して、次に見張るファイルを返す。undefined を返したら止める。builtSize は最初に作ったときの大きさ。
 * 一時的なエラー（スリープ明けで cmux が答えない など）では止めず、その回を飛ばして次の回に作り直す
 */
async function startWatcher(
  $: EngineInterface,
  id: string,
  watched: Watched,
  builtSize: number | undefined,
  rebuild: () => Promise<Watched | undefined>,
): Promise<void> {
  const key = `watcher:${id}`
  const token = `${await $.clock.now()}-${Math.random()}`
  await $.store.set(key, token)
  let files = watched
  let built = builtSize
  let seen = builtSize
  let busy = false
  let quietUntil = 0
  const timer = $.clock.every(WATCH_MS, async () => {
    if (busy) return
    busy = true
    try {
      if ((await $.store.get(key)) !== token) {
        timer.cancel()
        return
      }
      if ((await $.clock.now()) < quietUntil) return
      let size = (await $.fs.stat(files.transcript)).size
      for (const path of files.codex) size += (await $.fs.stat(path).catch(() => undefined))?.size ?? 0
      if (size === built) return
      if (size !== seen) {
        seen = size
        return
      }
      const start = await $.clock.now()
      try {
        const next = await rebuild()
        built = size
        if (next !== undefined) {
          files = next
        } else {
          timer.cancel()
          // 新しい自動更新が置いた合言葉は消さない
          if ((await $.store.get(key)) === token) await $.store.delete(key)
        }
      } finally {
        // 重い作り直しは、かかった時間の2倍空ける（失敗し続けても、休みなく試さない）
        const end = await $.clock.now()
        quietUntil = end + (end - start) * 2
      }
    } catch {
      // その回を飛ばす。作り直せなかったときは built が前のままなので、次の回に作り直す
    } finally {
      busy = false
    }
  })
}

// ── /lime: cmux（ブラウザのペインを持つターミナル）の呼び出し。tree の出力の読み方は cmux.ts ──

/** cmux や open が固まっても待ちすぎないように（既定は 30 秒）。cmux browser wait 自身の上限 10 秒より少し長く */
const CMUX_TIMEOUT_MS = 15_000
const AT_BOTTOM_JS = 'window.innerHeight + window.scrollY >= document.body.scrollHeight - 80'

function cmux($: EngineInterface, args: string[], timeoutMs = CMUX_TIMEOUT_MS) {
  return $.process.run(['cmux', ...args], { timeoutMs })
}

/** htmlPath を開いているタブを探す。無ければ undefined。cmux tree が失敗したら（時間切れ・出力が読めないも）例外 */
async function findTab($: EngineInterface, htmlPath: string, timeoutMs = CMUX_TIMEOUT_MS): Promise<string | undefined> {
  const tree = await cmux($, ['tree', '--all', '--json'], timeoutMs)
  if (tree.exitCode !== 0) throw new Error(`cmux tree が失敗しました: ${tree.stderr.trim()}`)
  return findBrowserSurface(tree.stdout, `file://${htmlPath}`)
}

/** cmux の横に開く。開けたら true */
async function openInCmux($: EngineInterface, htmlPath: string): Promise<boolean> {
  return (await cmux($, ['open', htmlPath]).catch(() => undefined))?.exitCode === 0
}

/** タブを読み込み直す。できたら true */
async function reloadTab($: EngineInterface, surface: string): Promise<boolean> {
  return (await cmux($, ['browser', surface, 'reload']).catch(() => undefined))?.exitCode === 0
}

/** 自動更新の読み込み直し。一番下（最新）を見ていたら、読み込み後も一番下へ（途中なら位置は cmux が保つ）。失敗は例外 */
async function refreshTab($: EngineInterface, surface: string): Promise<void> {
  const atBottom = await cmux($, ['browser', surface, 'eval', AT_BOTTOM_JS])
  await cmux($, ['browser', surface, 'reload'])
  if (atBottom.stdout.trim() !== 'true') return
  await cmux($, ['browser', surface, 'wait', '--load-state', 'complete', '--timeout', '10'])
  await cmux($, ['browser', surface, 'eval', 'window.scrollTo(0, document.body.scrollHeight)'])
}

// ── /lime: 大きな JSONL（会話記録）を読む。読み方の計画は jsonl.ts ──
// $.process.run の出力は 4 MiB までなので、awk で行ごとのバイト数を数えてから、sed で 4 MiB 未満ずつ読む。

/** 大きな記録でも awk・sed が時間切れ（既定 30 秒）にならないように */
const READ_TIMEOUT_MS = 120_000

/** path の JSONL を読む（大きければ新しい側だけ）。読めなければ、理由を文にした例外を投げる */
async function readJsonl($: EngineInterface, path: string): Promise<{ jsonl: string; tooLongLines: number; omittedLines: number }> {
  const sizes = await $.process.run(['awk', '{ print length($0) }', path], {
    env: { LC_ALL: 'C' }, // length をバイト数にする
    timeoutMs: READ_TIMEOUT_MS,
  })
  if (sizes.exitCode !== 0 || sizes.isStdoutTruncated) {
    const reason = sizes.isStdoutTruncated ? '行の数が多すぎます' : sizes.stderr.trim()
    throw new Error(`会話記録の行の長さを調べられませんでした: ${reason}`)
  }
  const plan = planRead(sizes.stdout.split('\n').filter((size) => size !== '').map(Number))
  let jsonl = ''
  for (const { start, end } of plan.batches) {
    // `${end}q` で、終わりの行で sed を止める（ファイルの最後まで読まない）
    const part = await $.process.run(['sed', '-n', `${start},${end}p;${end}q`, path], { timeoutMs: READ_TIMEOUT_MS })
    if (part.exitCode !== 0 || part.isStdoutTruncated) throw new Error(`会話記録を読めませんでした（${start}〜${end} 行目）`)
    jsonl += part.stdout
  }
  return { jsonl, tooLongLines: plan.tooLong.length, omittedLines: plan.omittedLines }
}

// ── /lime: 縮小画像を作る（発言に書かれたファイルを previews.ts が拾い、名前と作り方は thumbs.ts） ──
// 作るのは macOS の sips（画像）と qlmanage（HTML・PDF）。

// 1回の描画で新しく作る数と、作り始めてよい時間（/lime や自動更新を待たせすぎない）。残りは次の描画で作る
const MAX_NEW_THUMBS = 8
const NEW_THUMBS_MS = 6000
/** コマンド1回の上限。qlmanage は読めないファイルだと終わらないので、必ず切る */
const COMMAND_TIMEOUT_MS = 5000

/** 作れなかった縮小画像（置き場所のパス）。描き直すたびには試さない（元のファイルが変われば名前が変わるので、また試す） */
const failedThumbs = new Set<string>()

/**
 * 発言に書かれたファイルの縮小画像を用意し、発言ごとに「書かれたままのパス → 縮小画像」の表にする。
 * assets.dir は置き場所（絶対パス）、assets.href は HTML からの相対パス。
 * 新しい発言のものから作る。ファイルが無い・作れなかったものは表に入れない。同じファイルは1回だけ調べる
 */
async function preparePreviews(
  $: EngineInterface,
  conversation: Conversation,
  home: string,
  assets: { dir: string; href: string },
): Promise<Map<Item, MessagePreviews>> {
  let made = 0
  let startedAt: number | undefined
  let dirReady = false
  const prepare = async (target: PreviewTarget): Promise<Preview | undefined> => {
    const stat = await $.fs.stat(target.path).catch(() => undefined)
    if (stat?.kind !== 'file') return undefined
    const name = await thumbName(target.path, stat.mtimeMs, stat.size)
    const dest = `${assets.dir}/${name}`
    if (!(await $.fs.exists(dest))) {
      if (failedThumbs.has(dest) || made >= MAX_NEW_THUMBS) return undefined
      const now = await $.clock.now()
      startedAt ??= now
      if (now - startedAt > NEW_THUMBS_MS) return undefined
      made++
      if (!dirReady) {
        // 会話の中身なので、他人には読ませない（フォルダ 700、ファイル 600）
        await $.process.run(['mkdir', '-p', assets.dir])
        await $.process.run(['chmod', '700', assets.dir])
        dirReady = true
      }
      if (!(await makeThumb($, target, dest))) {
        failedThumbs.add(dest)
        return undefined
      }
    }
    return { src: `${assets.href}/${name}`, name: fileName(target.path) }
  }

  const previews = new Map<Item, MessagePreviews>()
  const byPath = new Map<string, Preview | undefined>()
  for (const item of [...conversation.items].reverse()) {
    if (item.kind !== 'message') continue
    const table = new Map<string, Preview>()
    for (const { candidate, target } of previewTargets(item.text, item.cwd, home)) {
      if (!byPath.has(target.path)) byPath.set(target.path, await prepare(target))
      const preview = byPath.get(target.path)
      if (preview !== undefined) table.set(candidate, preview)
    }
    if (table.size > 0) previews.set(item, table)
  }
  return previews
}

/** 縮小画像を1つ作る。作業用のフォルダで作ってから dest へ移す（作りかけを残さない）。できたら true */
async function makeThumb($: EngineInterface, target: PreviewTarget, dest: string): Promise<boolean> {
  const work = `${dest}.work`
  try {
    const made = await $.process.run(['mkdir', '-p', '-m', '700', work])
    if (made.exitCode !== 0) return false
    for (const argv of thumbCommands(target, work)) {
      const run = await $.process.run(argv, { timeoutMs: COMMAND_TIMEOUT_MS }).catch(() => undefined)
      if (run?.exitCode !== 0) continue
      // sips は thumb.png、qlmanage は <元のファイル名>.png に書くので、できた PNG を探す
      const png = (await $.fs.list(work)).find((entry) => entry.kind === 'file' && entry.name.endsWith('.png'))
      if (png === undefined) continue
      await $.process.run(['chmod', '600', `${work}/${png.name}`])
      return (await $.process.run(['mv', `${work}/${png.name}`, dest])).exitCode === 0
    }
    return false
  } catch {
    return false
  } finally {
    await $.process.run(['rm', '-rf', work]).catch(() => undefined)
  }
}

// ── /lime-codex: on|off と、ON のときに発言へ添える Codex のやりとり ──
// Codex の会話の中身を Anthropic へ送ることになるので、既定は OFF。ユーザーが自分で ON にしたときだけ渡す。

/** ON・OFF を置く $.store のキー（セッションをまたいで残る）。ON なら ON にした時刻、OFF なら false */
const STORE_KEY = 'codexContext'
/** 新しい側のこのバイト数だけを読む（$.process.run の出力は 4 MiB まで）。前回の発言以降のやりとりは、ふつうこの中に収まる */
const TAIL_BYTES = 1_000_000
/** 発言を送る前に読むので、待たせすぎないよう短く（既定は 30 秒） */
const CODEX_READ_TIMEOUT_MS = 3000
/** Claude に渡す文の上限（文字数）。毎回の発言に添えるので長くしない */
const MAX_CHARS = 8000
/** このセッションで初めて渡すときに、さかのぼる時間 */
const FIRST_MS = 3 * 60 * 60 * 1000
const USAGE = '使い方: /lime-codex on|off（on にすると、発言のたびに、同じ作業フォルダの Codex のやりとりを Claude に渡します）'

/** セッション ID → 前回渡した時刻。次の発言では、この時刻以降を渡す */
const sentUntil = new Map<string, number>()

/** $.store の値から、ON にした時刻を返す。OFF なら undefined。前の版は true を置いていた（時刻 0 とみなす） */
function onSince(stored: unknown): number | undefined {
  if (typeof stored === 'number') return stored
  return stored === true ? 0 : undefined
}

/** /lime-codex on|off。引数なしなら今の状態を答える */
async function runLimeCodex($: EngineInterface, args: string): Promise<CommandRunResult> {
  const arg = args.trim().toLowerCase()
  if (arg === 'on' || arg === 'off') {
    // ON にした時刻を置くのは、OFF だった間のやりとりを、あとで ON にしても渡さないため
    await $.store.set(STORE_KEY, arg === 'on' ? await $.clock.now() : false)
    return {
      text:
        arg === 'on'
          ? 'ON にしました。発言のたびに、前回の発言以降の Codex のやりとりを Claude に渡します'
          : 'OFF にしました。Codex のやりとりは Claude に渡しません',
    }
  }
  if (arg !== '') return { text: USAGE }
  const isOn = onSince(await $.store.get(STORE_KEY)) !== undefined
  return { text: `今は ${isOn ? 'ON' : 'OFF'} です。${USAGE}` }
}

/** ON なら、前回の発言以降に同じ作業フォルダの Codex で起きたやりとりを、Claude に渡す文にする。渡すものが無ければ undefined */
async function collectCodexActivity($: EngineInterface): Promise<CodexContext | undefined> {
  const onAt = onSince(await $.store.get(STORE_KEY))
  if (onAt === undefined) return undefined
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return undefined
  const sessionId = await $.session.id()
  // 読み始める前の時刻。読んでいる間に書かれたやりとりは、次の発言で渡す
  const now = await $.clock.now()
  const since = Math.max(sentUntil.get(sessionId) ?? now - FIRST_MS, onAt)
  // $.session.cwd はシェルの cd で動く。下のフォルダに cd した後でも、始めたフォルダの Codex が合うよう root を使う
  const cwd = await $.session.root()
  const items: Item[] = []
  for (const session of await findCodexSessions($, { home, from: since, to: now, cwds: [cwd], timeoutMs: CODEX_READ_TIMEOUT_MS })) {
    const tail = await $.process.run(['tail', '-c', String(TAIL_BYTES), session.path], { timeoutMs: CODEX_READ_TIMEOUT_MS })
    if (tail.exitCode !== 0) throw new Error(`Codex の会話記録を読めませんでした: ${session.path}`)
    // 読む量より大きいファイルは、先頭の行が途中から始まるので捨てる
    const cut = tail.stdout.indexOf('\n')
    const jsonl = session.size > TAIL_BYTES ? (cut === -1 ? '' : tail.stdout.slice(cut + 1)) : tail.stdout
    // now より後のやりとりは次の発言でまた読むので、ここでは渡さない（同じものを2回渡さない）
    items.push(...parseCodex(jsonl, session.meta.id, since).filter((item) => item.time < now))
  }
  // 最後まで読めたときだけ進める。途中で失敗したら、次の発言で同じところから読み直す
  sentUntil.set(sessionId, now)
  return formatCodexContext(items, MAX_CHARS, now)
}

// ── Codex の会話記録（~/.codex/sessions/<年>/<月>/<日>/*.jsonl）を探す（/lime が会話に混ぜ、/lime-codex が Claude に渡す） ──
// 日付のフォルダ・1行目の解釈・作業フォルダの判定は codex-sessions.ts、中身の解釈は codex.ts。

/** 会話記録のパス → 1行目の中身。1行目は変わらないので、読めたものは読み直さない */
const codexMetaCache = new Map<string, CodexMeta>()

/** from より後に書かれ、作業フォルダが cwds のどれか（かその下）の会話記録。1行目を読む head の時間の上限は timeoutMs */
async function findCodexSessions(
  $: EngineInterface,
  options: { home: string; from: number; to: number; cwds: readonly string[]; timeoutMs: number },
): Promise<CodexSession[]> {
  const root = `${options.home}/.codex/sessions`
  const found: CodexSession[] = []
  for (const day of codexDayDirs(options.from, options.to)) {
    // その日のフォルダが無い（Codex を使っていない日）のは、ふつうのこと
    const entries = await $.fs.list(`${root}/${day}`).catch(() => [])
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl') || entry.mtimeMs < options.from) continue
      const path = `${root}/${day}/${entry.name}`
      let meta = codexMetaCache.get(path)
      if (meta === undefined) {
        const head = await $.process.run(['head', '-n', '1', path], { timeoutMs: options.timeoutMs }).catch(() => undefined)
        meta = head?.exitCode === 0 ? parseCodexMeta(head.stdout.split('\n')[0] ?? '') : undefined
        // 書き始めたばかりで1行目がまだ無いこともあるので、読めなかったものは覚えず、次にまた調べる
        if (meta === undefined) continue
        codexMetaCache.set(path, meta)
      }
      if (matchesCwd(meta.cwd, options.cwds)) found.push({ path, size: entry.size, meta })
    }
  }
  return found
}
