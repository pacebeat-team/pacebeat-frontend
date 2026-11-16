import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createGpsTracker, processFix } from '../measurement/gpsTracker.ts'
import { addFix, createMetrics } from '../measurement/metrics.ts'
import { pauseSession, startSession, stopSession } from '../measurement/session.ts'
import type { GpsTrackerState, MeasurementSession, MetricsState, RawFix } from '../measurement/types.ts'
import { toMeasurementView } from './toMeasurementView.ts'

const BASE = 1_700_000_000_000
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

// t초 시점에 3 m/s로 달려 온 좌표
function fixAt(seconds: number): RawFix {
  return {
    lat: 0,
    lng: (seconds * 3) / METERS_PER_DEGREE,
    accuracyM: 5,
    deviceTime: BASE + seconds * 1000,
    receivedAt: BASE + seconds * 1000,
  }
}

function run(session: MeasurementSession, seconds: number[]) {
  let tracker: GpsTrackerState = createGpsTracker()
  let metrics: MetricsState = createMetrics()
  for (const sec of seconds) {
    const processed = processFix(tracker, fixAt(sec))
    tracker = processed.state
    if (processed.result.accepted) metrics = addFix(metrics, processed.result.fix, session)
  }
  return { tracker, metrics }
}

const session = startSession(null, BASE, () => 'test-session')

describe('toMeasurementView', () => {
  test('세션이 없으면 측정값이 모두 null이다 (0이 아니다)', () => {
    const view = toMeasurementView({ session: null, tracker: createGpsTracker(), metrics: createMetrics(), now: BASE })
    assert.deepEqual(view.active, {
      elapsedSec: null,
      targetDurationSec: null,
      minSaveSec: null,
      distanceM: null,
      currentPaceSecPerKm: null,
      gpsStatus: null,
      cadenceSpm: null,
    })
    assert.equal(view.result.elapsedSec, null)
    assert.equal(view.result.distanceM, null)
    assert.equal(view.isSample, false)
  })

  test('이번 단계에서 다루지 않는 값은 항상 null이다 (목표 시간, 최소 저장, 케이던스, 기준 페이스 등)', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3])
    const view = toMeasurementView({ session, tracker, metrics, now: BASE + 3000 })
    assert.equal(view.guide.targetDurationSec, null)
    assert.equal(view.active.targetDurationSec, null)
    assert.equal(view.active.minSaveSec, null)
    assert.equal(view.active.cadenceSpm, null)
    assert.deepEqual(
      [view.result.baselinePaceSecPerKm, view.result.cadenceSpm, view.result.strideM, view.result.quality, view.result.firstGoal],
      [null, null, null, null, null],
    )
  })

  test('시작했지만 이어진 좌표 쌍이 없으면 경과 시간은 있고 거리는 null이다 (검색 중은 GPS null)', () => {
    const view = toMeasurementView({ session, tracker: createGpsTracker(), metrics: createMetrics(), now: BASE + 4500 })
    assert.equal(view.active.elapsedSec, 4)
    assert.equal(view.active.distanceM, null)
    assert.equal(view.active.gpsStatus, null)
  })

  test('좌표가 하나뿐이어도 거리는 아직 null이다', () => {
    const { tracker, metrics } = run(session, [0])
    const view = toMeasurementView({ session, tracker, metrics, now: BASE + 500 })
    assert.equal(view.active.distanceM, null)
    assert.equal(view.active.gpsStatus, 'good')
  })

  test('측정 중: 경과 시간은 내림 정수 초, 거리와 현재 페이스는 엔진 값 그대로이다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const view = toMeasurementView({ session, tracker, metrics, now: BASE + 10_999 })
    assert.equal(view.active.elapsedSec, 10)
    assert.ok(view.active.distanceM !== null && Math.abs(view.active.distanceM - 30) < 0.01)
    assert.equal(view.active.currentPaceSecPerKm, 333) // 3 m/s → 333 sec/km
    assert.equal(view.active.gpsStatus, 'good')
  })

  test('GPS 상태: 마지막 좌표 후 10초를 넘기면 lost이고 현재 페이스는 null, 거리는 유지', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5])
    const view = toMeasurementView({ session, tracker, metrics, now: BASE + 5000 + 10_001 })
    assert.equal(view.active.gpsStatus, 'lost')
    assert.equal(view.active.currentPaceSecPerKm, null)
    assert.ok(view.active.distanceM !== null && view.active.distanceM > 14)
  })

  test('권한 거부 등 사용 불가는 unavailable이다', () => {
    const view = toMeasurementView({
      session,
      tracker: { ...createGpsTracker(), unavailableReason: 'permission-denied' },
      metrics: createMetrics(),
      now: BASE + 2000,
    })
    assert.equal(view.active.gpsStatus, 'unavailable')
    assert.equal(view.active.elapsedSec, 2)
    assert.equal(view.active.distanceM, null)
  })

  test('일시정지 중: 경과 시간은 멈추고 현재 페이스는 null이다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const paused = pauseSession(session, BASE + 10_500)
    const view = toMeasurementView({ session: paused, tracker, metrics, now: BASE + 30_000 })
    assert.equal(view.active.elapsedSec, 10)
    assert.equal(view.active.currentPaceSecPerKm, null)
  })

  test('종료된 세션: 결과 값은 종료 시각 기준이고 시간이 지나도 바뀌지 않는다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5])
    const ended = stopSession(session, BASE + 5000, 'user')
    const atEnd = toMeasurementView({ session: ended, tracker, metrics, now: BASE + 5000 })
    const later = toMeasurementView({ session: ended, tracker, metrics, now: BASE + 600_000 })
    assert.deepEqual(later, atEnd)
    assert.equal(atEnd.result.elapsedSec, 5)
    assert.ok(atEnd.result.distanceM !== null && Math.abs(atEnd.result.distanceM - 15) < 0.01)
    assert.equal(atEnd.active.gpsStatus, 'good') // 종료 후 시간이 지나도 '끊김'이 되지 않는다
    assert.equal(atEnd.active.currentPaceSecPerKm, null)
  })

  test('active와 result의 경과 시간·거리는 같은 측정값에서 나온다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3])
    const view = toMeasurementView({ session, tracker, metrics, now: BASE + 3000 })
    assert.equal(view.result.elapsedSec, view.active.elapsedSec)
    assert.equal(view.result.distanceM, view.active.distanceM)
  })

  test('결과의 GPS 상태는 항상 null이다: 마지막 신호 상태만으로 측정 전체가 안정이라고 표시하지 않는다', () => {
    // 0~5초 수신, 6~9초 끊김, 10~12초 복구. 종료 시점(12초)의 GPS 상태는 'good'이지만 4초가 미측정이다.
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5, 10, 11, 12])
    const ended = stopSession(session, BASE + 12_000, 'user')
    const view = toMeasurementView({ session: ended, tracker, metrics, now: BASE + 12_000 })
    assert.equal(view.active.gpsStatus, 'good') // 진행 중 화면은 지금의 신호 상태를 그대로 보여 준다
    assert.equal(view.result.gpsStatus, null)
    // 다른 결과 값은 그대로이다.
    assert.equal(view.result.elapsedSec, 12)
    assert.ok(view.result.distanceM !== null && view.result.distanceM > 0)
  })

  test('결과의 GPS 상태는 신호 상태와 무관하게 null이다 (끊김, 사용 불가, 검색 중)', () => {
    const ended = stopSession(session, BASE + 30_000, 'user')
    const lost = run(session, [0, 1, 2])
    const lostView = toMeasurementView({ session: ended, ...lost, now: BASE + 30_000 })
    assert.equal(lostView.active.gpsStatus, 'lost')
    assert.equal(lostView.result.gpsStatus, null)

    const unavailableView = toMeasurementView({
      session: ended,
      tracker: { ...createGpsTracker(), unavailableReason: 'permission-denied' },
      metrics: createMetrics(),
      now: BASE + 30_000,
    })
    assert.equal(unavailableView.result.gpsStatus, null)

    const searchingView = toMeasurementView({
      session: ended,
      tracker: createGpsTracker(),
      metrics: createMetrics(),
      now: BASE + 30_000,
    })
    assert.equal(searchingView.result.gpsStatus, null)
  })
})
