import { expect, test } from 'claude-code/testing'
import { findBrowserSurface } from '../hooks/cmux'

const tree = JSON.stringify({
  windows: [
    {
      workspaces: [
        {
          panes: [
            { surfaces: [{ ref: 'surface:7', type: 'terminal', url: null }] },
            { surfaces: [{ ref: 'surface:9', type: 'browser', url: 'file:///h/.claude/lime/sess-1.html' }] },
          ],
        },
      ],
    },
  ],
})

test('cmux tree の出力から、その HTML を開いているタブを探す', () => {
  expect(findBrowserSurface(tree, 'file:///h/.claude/lime/sess-1.html')).toBe('surface:9')
})

test('開いているタブが無いときは undefined', () => {
  expect(findBrowserSurface(tree, 'file:///h/.claude/lime/other.html')).toBeUndefined()
  expect(findBrowserSurface(JSON.stringify({ windows: [] }), 'file:///h/.claude/lime/sess-1.html')).toBeUndefined()
})

test('出力が読めない（空・壊れている）ときは、タブが無いのと見分けるため、例外を投げる', () => {
  expect(() => findBrowserSurface('', 'file:///h/.claude/lime/sess-1.html')).toThrow()
  expect(() => findBrowserSurface('{壊れた', 'file:///h/.claude/lime/sess-1.html')).toThrow()
})

test('目次などで URL に # が付いていても、同じタブとして見つける', () => {
  const withHash = tree.replace('sess-1.html', 'sess-1.html#m3')
  expect(findBrowserSurface(withHash, 'file:///h/.claude/lime/sess-1.html')).toBe('surface:9')
})
