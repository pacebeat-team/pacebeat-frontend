import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunAudioStore } from './runAudioStore.ts'

describe('오디오 토글 상태', () => {
  test('기본은 ON이고 누를 때마다 ON과 OFF를 오간다', () => {
    const store = createRunAudioStore()
    assert.equal(store.getState().soundOn, true)
    store.getState().toggleSound()
    assert.equal(store.getState().soundOn, false)
    store.getState().toggleSound()
    assert.equal(store.getState().soundOn, true)
  })
})
