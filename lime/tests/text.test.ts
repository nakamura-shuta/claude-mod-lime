import { expect, test } from 'claude-code/testing'
import { truncate } from '../hooks/text'

test('長い結果を行数と文字数で切り詰める', () => {
  expect(truncate('短い')).toBe('短い')
  expect(truncate('1\n2\n3\n4', 2, 100)).toBe('1\n2\n…（残り 2 行）')
  expect(truncate('abcdef', 20, 3)).toBe('abc…（以下略）')
})
