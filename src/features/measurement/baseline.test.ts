import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { BASELINE_MIN_VALID_MS, computeBaselinePace } from './baseline.ts'

describe('computeBaselinePace', () => {
  test('최소 유효 시간은 120,000ms이다', () => {
    assert.equal(BASELINE_MIN_VALID_MS, 120_000)
  })

  test('validMs 119,999ms는 null이고 120,000ms는 엔진의 평균 페이스 값이다', () => {
    assert.equal(computeBaselinePace({ validMs: 119_999, avgPaceSecPerKm: 333 }), null)
    assert.equal(computeBaselinePace({ validMs: 120_000, avgPaceSecPerKm: 333 }), 333)
    assert.equal(computeBaselinePace({ validMs: 600_000, avgPaceSecPerKm: 410 }), 410)
  })

  test('엔진의 평균 페이스가 null이면 유효 시간이 충분해도 null이다', () => {
    assert.equal(computeBaselinePace({ validMs: 300_000, avgPaceSecPerKm: null }), null)
  })

  test('유효 시간이 0이거나 숫자가 아니면 null이다', () => {
    assert.equal(computeBaselinePace({ validMs: 0, avgPaceSecPerKm: 333 }), null)
    assert.equal(computeBaselinePace({ validMs: Number.NaN, avgPaceSecPerKm: 333 }), null)
  })
})
