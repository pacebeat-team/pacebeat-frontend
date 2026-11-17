import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { hasPreviousEntry } from './history.ts'

describe('hasPreviousEntry', () => {
  test('idx가 0보다 크면 이전 화면이 있다', () => {
    assert.equal(hasPreviousEntry({ idx: 1 }), true)
    assert.equal(hasPreviousEntry({ idx: 5, key: 'abc' }), true)
  })

  test('idx가 0이면 이전 화면이 없다 (직접 진입, 새로고침)', () => {
    assert.equal(hasPreviousEntry({ idx: 0 }), false)
  })

  test('state가 없거나 idx가 숫자가 아니면 이전 화면이 없다', () => {
    assert.equal(hasPreviousEntry(null), false)
    assert.equal(hasPreviousEntry(undefined), false)
    assert.equal(hasPreviousEntry('idx'), false)
    assert.equal(hasPreviousEntry({}), false)
    assert.equal(hasPreviousEntry({ idx: '1' }), false)
    assert.equal(hasPreviousEntry({ idx: -1 }), false)
  })
})
