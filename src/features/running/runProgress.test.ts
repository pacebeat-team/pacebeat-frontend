import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, formatDistanceKm2, formatPaceOrDash } from './format.ts'
import {
  computeStagePaceGuidance,
  getCountdownValue,
  getGoalProgress,
  getRequiredPaceSecPerKm,
} from './runProgress.ts'

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

describe('P!PACE 3구간 및 85% 이후 실시간 필요 페이스 (PDF 3절 & 4절)', () => {
  test('몸풀기(0~15%) → 리듬 유지(15~85%) → 실시간 필요 페이스(85% 이후, 남은 시간 5% 단축)', () => {
    // 3km, 21분(1260초), 7:00/km(420초)
    const warmup = computeStagePaceGuidance({ goal: GOAL, distanceM: 300, elapsedMs: 120_000 })
    assert.equal(warmup?.section, 'warmup')
    assert.equal(warmup?.displayPaceSecPerKm, 440) // 7:20/km

    const rhythm = computeStagePaceGuidance({ goal: GOAL, distanceM: 1500, elapsedMs: 600_000 })
    assert.equal(rhythm?.section, 'rhythm')
    assert.equal(rhythm?.displayPaceSecPerKm, 415) // 6:55/km

    // 85% 지점(2550m), 예상 경과 시간 17분 51초(1071초 = 1,071,000ms), 남은 시간 189초(3분 9초)
    // 조기 도착 단축 = 189 * 5% = 9.45초, 남은 거리 0.45km → (189 - 9.45) / 0.45 = 399초 → 5초 반올림 400초(6:40/km)
    const at85 = computeStagePaceGuidance({ goal: GOAL, distanceM: 2550, elapsedMs: 1_071_000 })
    assert.equal(at85?.section, 'realtime')
    assert.equal(at85?.mode, 'realtime_pace')
    assert.equal(at85?.stepBucketIndex, 0)
    assert.equal(at85?.displayPaceSecPerKm, 400) // 약 6:40/km
  })

  test('조기 도착 시간은 최대 60초로 제한되고, 95% 이후에는 마지막 계산값을 고정 유지한다', () => {
    const bigGoal = { targetDistanceKm: 5 as const, targetDurationSec: 3000 }
    // 85% 지점(4250m)에서 남은 시간이 1500초이면 5%는 75초이나 최대 60초로 제한
    const g = computeStagePaceGuidance({ goal: bigGoal, distanceM: 4250, elapsedMs: 1_500_000 })
    assert.equal(g?.earlyArrivalSec, 60)

    // 95% 이후(3km 기준 2850m 이상)에는 lastCalculatedRawPaceSecPerKm을 그대로 유지
    const frozen = computeStagePaceGuidance({
      goal: GOAL,
      distanceM: 2900,
      elapsedMs: 1_190_000,
      lastCalculatedRawPaceSecPerKm: 401,
    })
    assert.equal(frozen?.isFrozenAfter95Pct, true)
    assert.equal(frozen?.rawRequiredPaceSecPerKm, 401)
    assert.equal(frozen?.displayPaceSecPerKm, 400)
  })

  test('필요 페이스가 목표 페이스보다 10% 이상 빠르거나 4:00/km보다 빠르면 완주 우선 안내(completion_first)로 전환한다', () => {
    // 3km 21:00(420초/km)에서 10% 이상 빠름 = 378초/km 이하가 필요한 경우
    const tooBehind = computeStagePaceGuidance({ goal: GOAL, distanceM: 2550, elapsedMs: 1_120_000 })
    assert.equal(tooBehind?.isCompletionFirst, true)
    assert.equal(tooBehind?.mode, 'completion_first')
    assert.equal(tooBehind?.displayPaceSecPerKm, null)
  })
})
