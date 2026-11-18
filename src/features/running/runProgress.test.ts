import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, formatDistanceKm2, formatPaceOrDash } from './format.ts'
import { getCountdownValue, getGoalProgress, getRequiredPaceSecPerKm } from './runProgress.ts'

const GOAL = { targetDistanceKm: 3 as const, targetDurationSec: 1260 }
const NO_GOAL = { targetDistanceKm: null, targetDurationSec: null }

describe('목표 진행률', () => {
  test('거리·퍼센트(내림)·남은 거리', () => {
    const progress = getGoalProgress(GOAL, 1420)
    assert.equal(progress?.percent, 47)
    assert.equal(progress?.remainingM, 1580)
    assert.equal(getGoalProgress(GOAL, 2999)?.percent, 99)
    assert.equal(getGoalProgress(GOAL, 3000)?.percent, 100)
    assert.equal(getGoalProgress(GOAL, 3500)?.remainingM, 0)
  })
  test('거리가 없으면 0%이고 목표가 없으면 null', () => {
    assert.equal(getGoalProgress(GOAL, null)?.percent, 0)
    assert.equal(getGoalProgress(NO_GOAL, 100), null)
  })
})

describe('재개 후 필요 페이스', () => {
  test('남은 시간 ÷ 남은 거리', () => {
    // 목표 21:00, 9:51 경과, 1.58km 남음 → 669초 / 1.58 ≈ 423초(7:03)
    assert.equal(getRequiredPaceSecPerKm(GOAL, 1420, 591_000), 423)
  })
  test('시간이 지났거나 남은 거리가 없거나 목표가 없으면 null', () => {
    assert.equal(getRequiredPaceSecPerKm(GOAL, 1420, 1_300_000), null)
    assert.equal(getRequiredPaceSecPerKm(GOAL, 3000, 100_000), null)
    assert.equal(getRequiredPaceSecPerKm(NO_GOAL, null, 100_000), null)
  })
})

describe('카운트다운 값', () => {
  test('3 → 2 → 1을 1초씩, 3초가 지나면 0(시작)', () => {
    assert.equal(getCountdownValue(0), 3)
    assert.equal(getCountdownValue(999), 3)
    assert.equal(getCountdownValue(1000), 2)
    assert.equal(getCountdownValue(2000), 1)
    assert.equal(getCountdownValue(2999), 1)
    assert.equal(getCountdownValue(3000), 0)
    assert.equal(getCountdownValue(-5), 3)
  })
})

describe('진행 화면 표시 형식', () => {
  test('시계: 분:초, 1시간 이상은 시:분:초', () => {
    assert.equal(formatClock(591_000), '09:51')
    assert.equal(formatClock(0), '00:00')
    assert.equal(formatClock(3_723_000), '1:02:03')
    assert.equal(formatClock(Number.NaN), '00:00')
  })
  test('거리는 소수 둘째 자리 버림(목표 전에 목표 값으로 보이지 않는다)', () => {
    assert.equal(formatDistanceKm2(1420), '1.42')
    assert.equal(formatDistanceKm2(2999), '2.99')
    assert.equal(formatDistanceKm2(0), '0.00')
  })
  test('페이스가 없으면 —', () => {
    assert.equal(formatPaceOrDash(null), '—')
    assert.equal(formatPaceOrDash(416), '6:56')
  })
})
