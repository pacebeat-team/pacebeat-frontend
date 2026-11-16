import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createGpsTracker, processFix } from './gpsTracker.ts'
import { isGpsReadyToResume } from './restore.ts'

const BASE = 1_700_000_000_000

describe('isGpsReadyToResume', () => {
  const fresh = createGpsTracker()
  const fix = { lat: 0, lng: 0, accuracyM: 5, deviceTime: BASE, receivedAt: BASE }
  const verified = processFix(fresh, fix).state

  test('유효 좌표를 받은 적이 없으면 false이다', () => {
    assert.equal(isGpsReadyToResume(fresh, BASE), false)
  })

  test('유효 좌표를 받았고 신호가 정상이면 true이다', () => {
    assert.equal(isGpsReadyToResume(verified, BASE + 1000), true)
  })

  test('받은 뒤 10초를 넘기면 false이다 (끊김)', () => {
    assert.equal(isGpsReadyToResume(verified, BASE + 10_001), false)
  })

  test('사용할 수 없는 상태이면 false이다', () => {
    assert.equal(isGpsReadyToResume({ ...fresh, unavailableReason: 'permission-denied' }, BASE), false)
  })
})
