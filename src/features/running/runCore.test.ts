import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { canSaveRun, isGoalReached, MIN_SAVE_MS, targetDistanceM } from './policy.ts'
import { buildRunRecord, createRecordId, NO_GOAL } from './record.ts'
import { createGpsRunState, feedGpsFix, getGpsRunMetrics, getTimeRunMetrics } from './runMetrics.ts'
import { getRunElapsedMs, isRunActive, pauseRun, resumeRun, startRun, stopRun } from './runSession.ts'
import { appendDistanceSample, computeSplits } from './splits.ts'
import type { DistanceSample, RunGoal } from './types.ts'

const BASE = 1_700_000_000_000
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180
const goal3k: RunGoal = { targetDistanceKm: 3, targetDurationSec: 1320 }

function fixAt(seconds: number, speedMps = 3) {
  const at = BASE + seconds * 1000
  return { lat: 0, lng: (seconds * speedMps) / METERS_PER_DEGREE, accuracyM: 5, deviceTime: at, receivedAt: at }
}

describe('최소 저장 판정(60초)', () => {
  test('59.9초는 불가, 60초는 가능하다', () => {
    assert.equal(MIN_SAVE_MS, 60_000)
    assert.equal(canSaveRun(59_900), false)
    assert.equal(canSaveRun(60_000), true)
    assert.equal(canSaveRun(0), false)
  })
  test('올바르지 않은 값은 저장할 수 없다', () => {
    assert.equal(canSaveRun(Number.NaN), false)
  })
})

describe('목표 달성 판정', () => {
  test('GPS 모드: 목표 거리 이상이면 도달, 미만이면 아니다', () => {
    assert.equal(targetDistanceM(3), 3000)
    assert.equal(isGoalReached('gps', goal3k, 3000), true)
    assert.equal(isGoalReached('gps', goal3k, 3200), true)
    assert.equal(isGoalReached('gps', goal3k, 2999.9), false)
  })
  test('TIME 모드와 목표 없음은 완주가 아니다', () => {
    assert.equal(isGoalReached('time', goal3k, 99999), false)
    assert.equal(isGoalReached('time', NO_GOAL, 3000), false)
    assert.equal(isGoalReached('gps', NO_GOAL, 3000), false)
    assert.equal(isGoalReached('gps', goal3k, null), false)
  })
})

describe('러닝 세션', () => {
  test('일시정지 시간은 경과 시간에서 빠지고 재개해도 같은 session id다', () => {
    let session = startRun(null, BASE, () => 'run-1')
    session = pauseRun(session, BASE + 30_000)
    session = resumeRun(session, BASE + 50_000)
    assert.equal(session.id, 'run-1')
    assert.equal(getRunElapsedMs(session, BASE + 70_000), 50_000) // 70초 - 일시정지 20초
  })
  test('활성 세션이 있으면 다시 시작해도 새로 만들지 않는다', () => {
    const first = startRun(null, BASE, () => 'run-1')
    assert.equal(startRun(first, BASE + 1000, () => 'run-2'), first)
  })
  test('목표 도달로 종료하면 종료 원인이 auto, 종료 후 경과 시간은 고정된다', () => {
    const stopped = stopRun(startRun(null, BASE, () => 's'), BASE + 90_000, 'goal')
    assert.equal(stopped.status, 'finished')
    assert.equal(stopped.endReason, 'auto')
    assert.equal(isRunActive(stopped), false)
    assert.equal(getRunElapsedMs(stopped, BASE + 999_999), 90_000)
  })
  test('일시정지 중에 종료하면 일시정지 시점 값으로 고정된다', () => {
    let session = startRun(null, BASE, () => 's')
    session = pauseRun(session, BASE + 40_000)
    session = stopRun(session, BASE + 100_000)
    assert.equal(getRunElapsedMs(session, BASE + 200_000), 40_000)
  })
  test('createRecordId는 매번 다른 id를 만든다', () => {
    assert.notEqual(createRecordId(), createRecordId())
  })
})

describe('러닝 지표', () => {
  test('GPS 모드: 3m/s로 달리면 거리·페이스가 계산된다', () => {
    const session = startRun(null, BASE, () => 's')
    let state = createGpsRunState()
    for (let s = 0; s <= 40; s += 1) state = feedGpsFix(state, fixAt(s), session).state
    const live = getGpsRunMetrics(state, session, BASE + 40_000)
    assert.equal(live.mode, 'gps')
    assert.ok(live.distanceM !== null && Math.abs(live.distanceM - 120) < 1)
    assert.ok(live.avgPaceSecPerKm !== null && Math.abs(live.avgPaceSecPerKm - 333) <= 1)
    assert.equal(live.gpsSignal, 'good')
  })
  test('GPS 모드: 좌표가 없으면 거리 0, 페이스는 0이 아니라 null이다', () => {
    const session = startRun(null, BASE, () => 's')
    const live = getGpsRunMetrics(createGpsRunState(), session, BASE + 5000)
    assert.equal(live.distanceM, 0)
    assert.equal(live.avgPaceSecPerKm, null)
    assert.equal(live.currentPaceSecPerKm, null)
    assert.equal(live.gpsSignal, null)
  })
  test('GPS 신호가 끊기면 현재 페이스는 null이고 거리는 보존된다', () => {
    const session = startRun(null, BASE, () => 's')
    let state = createGpsRunState()
    for (let s = 0; s <= 30; s += 1) state = feedGpsFix(state, fixAt(s), session).state
    const live = getGpsRunMetrics(state, session, BASE + 60_000) // 마지막 좌표 후 30초
    assert.equal(live.gpsSignal, 'lost')
    assert.equal(live.currentPaceSecPerKm, null)
    assert.ok(live.distanceM !== null && live.distanceM > 80)
  })
  test('검증에 실패한 좌표는 거리에 반영되지 않는다', () => {
    const session = startRun(null, BASE, () => 's')
    const bad = { ...fixAt(1), accuracyM: 500 }
    const fed = feedGpsFix(createGpsRunState(), bad, session)
    assert.equal(fed.result.accepted, false)
    assert.equal(getGpsRunMetrics(fed.state, session, BASE + 1000).distanceM, 0)
  })
  test('TIME 모드: 경과 시간만 계산하고 거리·페이스·GPS는 null이다', () => {
    let session = startRun(null, BASE, () => 's')
    session = pauseRun(session, BASE + 20_000)
    session = resumeRun(session, BASE + 30_000)
    const live = getTimeRunMetrics(session, BASE + 60_000)
    assert.equal(live.mode, 'time')
    assert.equal(live.elapsedMs, 50_000)
    assert.equal(live.distanceM, null)
    assert.equal(live.avgPaceSecPerKm, null)
    assert.equal(live.currentPaceSecPerKm, null)
    assert.equal(live.gpsSignal, null)
  })
})

describe('구간(split) 계산', () => {
  // 1km를 300초에 달리는 일정한 페이스(3.333 m/s)
  const steady: DistanceSample[] = [
    { elapsedMs: 150_000, distanceM: 500 },
    { elapsedMs: 300_000, distanceM: 1000 },
    { elapsedMs: 450_000, distanceM: 1500 },
    { elapsedMs: 600_000, distanceM: 2000 },
    { elapsedMs: 690_000, distanceM: 2300 },
  ]

  test('1km 단위 구간과 마지막 잔여 구간', () => {
    const splits = computeSplits(steady)
    assert.equal(splits.length, 3)
    assert.deepEqual(splits[0], { index: 1, distanceM: 1000, durationMs: 300_000, paceSecPerKm: 300 })
    assert.deepEqual(splits[1], { index: 2, distanceM: 1000, durationMs: 300_000, paceSecPerKm: 300 })
    assert.deepEqual(splits[2], { index: 3, distanceM: 300, durationMs: 90_000, paceSecPerKm: 300 })
  })
  test('1km 경계는 샘플 사이를 보간한다', () => {
    const splits = computeSplits([
      { elapsedMs: 100_000, distanceM: 400 },
      { elapsedMs: 400_000, distanceM: 1200 },
    ])
    assert.equal(splits[0].durationMs, 325_000) // 400m→1200m 구간에서 1000m 지점 = 100 + 300×0.75초
    assert.equal(splits[1].distanceM, 200)
  })
  test('정확히 1km의 배수이면 잔여 구간이 없다', () => {
    assert.equal(computeSplits(steady.slice(0, 2)).length, 1)
  })
  test('1km 미만이면 잔여 구간 하나뿐이다. 거리가 없으면 구간도 없다', () => {
    const splits = computeSplits([{ elapsedMs: 60_000, distanceM: 200 }])
    assert.equal(splits.length, 1)
    assert.equal(splits[0].distanceM, 200)
    assert.deepEqual(computeSplits([]), [])
    assert.deepEqual(computeSplits([{ elapsedMs: 5000, distanceM: 0 }]), [])
  })
  test('appendDistanceSample: 거리가 줄거나 시간이 거꾸로 간 샘플은 버린다', () => {
    let samples: DistanceSample[] = []
    samples = appendDistanceSample(samples, { elapsedMs: 1000, distanceM: 10 })
    samples = appendDistanceSample(samples, { elapsedMs: 2000, distanceM: 5 })
    samples = appendDistanceSample(samples, { elapsedMs: 500, distanceM: 20 })
    samples = appendDistanceSample(samples, { elapsedMs: 3000, distanceM: Number.NaN })
    samples = appendDistanceSample(samples, { elapsedMs: 3000, distanceM: 30 })
    assert.equal(samples.length, 2)
    assert.equal(samples[1].distanceM, 30)
  })
})

describe('RunRecord 생성', () => {
  const finished = stopRun(startRun(null, BASE, () => 'sess-1'), BASE + 900_000, 'goal')
  const samples: DistanceSample[] = [
    { elapsedMs: 300_000, distanceM: 1000 },
    { elapsedMs: 900_000, distanceM: 3000 },
  ]
  const base = {
    recordId: 'rec-1',
    session: finished,
    goal: goal3k,
    musicTrackId: 'morning-stride',
    distanceM: 3000,
    avgPaceSecPerKm: 300,
    distanceSamples: samples,
    gpsGaps: [{ lostAtMs: 100_000, recoveredAtMs: 110_000 }],
    goalReached: true,
  }

  test('GPS 완주: goal, 거리·페이스·구간·손실 구간을 담는다. 센서 리포트·회고는 null', () => {
    const record = buildRunRecord({ ...base, mode: 'gps' })
    assert.equal(record.recordId, 'rec-1')
    assert.equal(record.sessionId, 'sess-1')
    assert.equal(record.result.completion, 'goal')
    assert.equal(record.result.elapsedMs, 900_000)
    assert.equal(record.result.distanceM, 3000)
    assert.equal(record.result.avgPaceSecPerKm, 300)
    assert.equal(record.result.splits.length, 3)
    assert.equal(record.result.gpsGaps.length, 1)
    assert.deepEqual(record.goal, goal3k)
    assert.equal(record.musicTrackId, 'morning-stride')
    assert.equal(record.reflection, null)
    assert.equal(record.sensorReport, null)
  })
  test('GPS 목표 전 종료는 partial', () => {
    assert.equal(buildRunRecord({ ...base, mode: 'gps', goalReached: false }).result.completion, 'partial')
  })
  test('TIME 기록: 거리·페이스는 null, 구간은 비어 있고 목표는 없다(0이나 추정값 없음)', () => {
    const record = buildRunRecord({ ...base, mode: 'time' })
    assert.equal(record.mode, 'time')
    assert.equal(record.result.completion, 'time')
    assert.equal(record.result.distanceM, null)
    assert.equal(record.result.avgPaceSecPerKm, null)
    assert.deepEqual(record.result.splits, [])
    assert.deepEqual(record.result.gpsGaps, [])
    assert.deepEqual(record.goal, NO_GOAL)
    assert.equal(record.result.elapsedMs, 900_000)
  })
  test('종료되지 않은 세션은 기록으로 만들 수 없다', () => {
    const running = startRun(null, BASE, () => 's')
    assert.throws(() => buildRunRecord({ ...base, session: running, mode: 'gps' }), RangeError)
  })
})
