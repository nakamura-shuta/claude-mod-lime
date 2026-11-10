// cmux（ブラウザのペインを持つターミナル）の tree の JSON から、タブを探す（純粋な関数）。cmux を呼ぶのは register.ts。

/**
 * `cmux tree --all --json` の出力から、url を開いているタブ（surface:N）を探す。無ければ undefined。
 * 目次などで URL に #m3 などが付くので、# から後ろは除いて比べる。
 * 出力が JSON として読めなければ例外を投げる（「タブが無い」と取り違えると、自動更新を止めてしまう）
 */
export function findBrowserSurface(treeJson: string, url: string): string | undefined {
  const tree: unknown = JSON.parse(treeJson)
  const stack: unknown[] = [tree]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      stack.push(...node)
    } else if (node !== null && typeof node === 'object') {
      const surface = node as { ref?: unknown; url?: unknown }
      const opened = typeof surface.url === 'string' ? surface.url.split('#')[0] : undefined
      if (opened === url && typeof surface.ref === 'string') return surface.ref
      stack.push(...Object.values(node))
    }
  }
  return undefined
}
