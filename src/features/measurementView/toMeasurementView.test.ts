import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createGpsTracker, processFix } from '../measurement/gpsTracker.ts'
import { addFix, createMetrics } from '../measurement/metrics.ts'
import { pauseSession, startSession, stopSession } from '../measurement/session.ts'
import type { GpsTrackerState, MeasurementSession, MetricsState, RawFix } from '../measurement/types.ts'
import { toMeasurementView, toRestoreView } from './toMeasurementView.ts'

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
    const view = toMeasurementView({ targetDurationMs: null, session: null, tracker: createGpsTracker(), metrics: createMetrics(), now: BASE })
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

  test('이번 단계에서 다루지 않는 값은 항상 null이다 (최소 저장, 케이던스, 보폭, 품질, 첫 목표)', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3])
    const view = toMeasurementView({ targetDurationMs: null, session, tracker, metrics, now: BASE + 3000 })
    assert.equal(view.active.minSaveSec, null)
    assert.equal(view.active.cadenceSpm, null)
    assert.deepEqual(
      [view.result.cadenceSpm, view.result.strideM, view.result.quality, view.result.firstGoal],
      [null, null, null, null],
    )
  })

  test('목표 시간: Store가 넘긴 ms를 초로 보여 주고, 없으면 null이다 (세션이 없어도 Guide에 보인다)', () => {
    const base = { tracker: createGpsTracker(), metrics: createMetrics(), now: BASE }
    const none = toMeasurementView({ ...base, session: null, targetDurationMs: 600_000 })
    assert.equal(none.guide.targetDurationSec, 600)
    assert.equal(none.active.targetDurationSec, 600)
    const running = toMeasurementView({ ...base, session, targetDurationMs: 600_000 })
    assert.equal(running.guide.targetDurationSec, 600)
    assert.equal(running.active.targetDurationSec, 600)
    const virtual = toMeasurementView({ ...base, session, targetDurationMs: null })
    assert.equal(virtual.guide.targetDurationSec, null)
    assert.equal(virtual.active.targetDurationSec, null)
  })

  test('시작했지만 이어진 좌표 쌍이 없으면 경과 시간은 있고 거리는 null이다 (검색 중은 GPS null)', () => {
    const view = toMeasurementView({ targetDurationMs: null, session, tracker: createGpsTracker(), metrics: createMetrics(), now: BASE + 4500 })
    assert.equal(view.active.elapsedSec, 4)
    assert.equal(view.active.distanceM, null)
    assert.equal(view.active.gpsStatus, null)
  })

  test('좌표가 하나뿐이어도 거리는 아직 null이다', () => {
    const { tracker, metrics } = run(session, [0])
    const view = toMeasurementView({ targetDurationMs: null, session, tracker, metrics, now: BASE + 500 })
    assert.equal(view.active.distanceM, null)
    assert.equal(view.active.gpsStatus, 'good')
  })

  test('측정 중: 경과 시간은 내림 정수 초, 거리와 현재 페이스는 엔진 값 그대로이다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const view = toMeasurementView({ targetDurationMs: null, session, tracker, metrics, now: BASE + 10_999 })
    assert.equal(view.active.elapsedSec, 10)
    assert.ok(view.active.distanceM !== null && Math.abs(view.active.distanceM - 30) < 0.01)
    assert.equal(view.active.currentPaceSecPerKm, 333) // 3 m/s → 333 sec/km
    assert.equal(view.active.gpsStatus, 'good')
  })

  test('GPS 상태: 마지막 좌표 후 10초를 넘기면 lost이고 현재 페이스는 null, 거리는 유지', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5])
    const view = toMeasurementView({ targetDurationMs: null, session, tracker, metrics, now: BASE + 5000 + 10_001 })
    assert.equal(view.active.gpsStatus, 'lost')
    assert.equal(view.active.currentPaceSecPerKm, null)
    assert.ok(view.active.distanceM !== null && view.active.distanceM > 14)
  })

  test('권한 거부 등 사용 불가는 unavailable이다', () => {
    const view = toMeasurementView({ targetDurationMs: null,
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
    const view = toMeasurementView({ targetDurationMs: null, session: paused, tracker, metrics, now: BASE + 30_000 })
    assert.equal(view.active.elapsedSec, 10)
    assert.equal(view.active.currentPaceSecPerKm, null)
  })

  test('종료된 세션: 결과 값은 종료 시각 기준이고 시간이 지나도 바뀌지 않는다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5])
    const ended = stopSession(session, BASE + 5000, 'user')
    const atEnd = toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + 5000 })
    const later = toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + 600_000 })
    assert.deepEqual(later, atEnd)
    assert.equal(atEnd.result.elapsedSec, 5)
    assert.ok(atEnd.result.distanceM !== null && Math.abs(atEnd.result.distanceM - 15) < 0.01)
    assert.equal(atEnd.active.gpsStatus, 'good') // 종료 후 시간이 지나도 '끊김'이 되지 않는다
    assert.equal(atEnd.active.currentPaceSecPerKm, null)
  })

  test('active와 result의 경과 시간·거리는 같은 측정값에서 나온다', () => {
    const { tracker, metrics } = run(session, [0, 1, 2, 3])
    const view = toMeasurementView({ targetDurationMs: null, session, tracker, metrics, now: BASE + 3000 })
    assert.equal(view.result.elapsedSec, view.active.elapsedSec)
    assert.equal(view.result.distanceM, view.active.distanceM)
  })

  test('결과의 GPS 상태는 항상 null이다: 마지막 신호 상태만으로 측정 전체가 안정이라고 표시하지 않는다', () => {
    // 0~5초 수신, 6~9초 끊김, 10~12초 복구. 종료 시점(12초)의 GPS 상태는 'good'이지만 4초가 미측정이다.
    const { tracker, metrics } = run(session, [0, 1, 2, 3, 4, 5, 10, 11, 12])
    const ended = stopSession(session, BASE + 12_000, 'user')
    const view = toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + 12_000 })
    assert.equal(view.active.gpsStatus, 'good') // 진행 중 화면은 지금의 신호 상태를 그대로 보여 준다
    assert.equal(view.result.gpsStatus, null)
    // 다른 결과 값은 그대로이다.
    assert.equal(view.result.elapsedSec, 12)
    assert.ok(view.result.distanceM !== null && view.result.distanceM > 0)
  })

  test('결과의 GPS 상태는 신호 상태와 무관하게 null이다 (끊김, 사용 불가, 검색 중)', () => {
    const ended = stopSession(session, BASE + 30_000, 'user')
    const lost = run(session, [0, 1, 2])
    const lostView = toMeasurementView({ targetDurationMs: null, session: ended, ...lost, now: BASE + 30_000 })
    assert.equal(lostView.active.gpsStatus, 'lost')
    assert.equal(lostView.result.gpsStatus, null)

    const unavailableView = toMeasurementView({ targetDurationMs: null,
      session: ended,
      tracker: { ...createGpsTracker(), unavailableReason: 'permission-denied' },
      metrics: createMetrics(),
      now: BASE + 30_000,
    })
    assert.equal(unavailableView.result.gpsStatus, null)

    const searchingView = toMeasurementView({ targetDurationMs: null,
      session: ended,
      tracker: createGpsTracker(),
      metrics: createMetrics(),
      now: BASE + 30_000,
    })
    assert.equal(searchingView.result.gpsStatus, null)
  })

  describe('기준 페이스', () => {
    const baselineOf = (seconds: number[], end: number) => {
      const { tracker, metrics } = run(session, seconds)
      const ended = stopSession(session, BASE + end * 1000, 'user')
      return toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + end * 1000 })
    }
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

    test('3 m/s로 2분 달리면 333 sec/km이다 (엔진의 평균 페이스 그대로)', () => {
      const view = baselineOf(range(0, 120), 120)
      assert.equal(view.result.baselinePaceSecPerKm, 333)
    })

    test('유효 측정 시간 119초는 null이고 120초는 값이 있다', () => {
      assert.equal(baselineOf(range(0, 119), 119).result.baselinePaceSecPerKm, null)
      assert.equal(baselineOf(range(0, 120), 120).result.baselinePaceSecPerKm, 333)
    })

    test('전체 경과 시간은 3분이어도 GPS 유효 시간이 2분 미만이면 null이다', () => {
      // 0~50초 수신, 50~130초 끊김, 130~180초 수신: 경과 180초, 유효 100초
      const view = baselineOf([...range(0, 50), ...range(130, 180)], 180)
      assert.equal(view.result.elapsedSec, 180)
      assert.equal(view.result.baselinePaceSecPerKm, null)
    })

    test('거리 0, 데이터 부족, 이어진 좌표 쌍 없음은 null이다', () => {
      // 이어진 좌표 쌍 없음(검색 중), 좌표 하나뿐
      assert.equal(baselineOf([], 300).result.baselinePaceSecPerKm, null)
      assert.equal(baselineOf([0], 300).result.baselinePaceSecPerKm, null)
      // 제자리(거리 0): 2분 넘게 같은 자리에서 좌표만 받는다
      const stationary = createGpsTracker()
      let tracker: GpsTrackerState = stationary
      let metrics: MetricsState = createMetrics()
      for (let sec = 0; sec <= 130; sec += 1) {
        const processed = processFix(tracker, { ...fixAt(0), deviceTime: BASE + sec * 1000, receivedAt: BASE + sec * 1000 })
        tracker = processed.state
        if (processed.result.accepted) metrics = addFix(metrics, processed.result.fix, session)
      }
      const ended = stopSession(session, BASE + 130_000, 'user')
      const view = toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + 130_000 })
      assert.equal(view.result.baselinePaceSecPerKm, null)
    })

    test('엔진의 최저 속도보다 느리면 유효 시간이 길어도 null이다', () => {
      // 0.05 m/s로 3분: 엔진의 minPaceSpeedMps 미만
      let tracker: GpsTrackerState = createGpsTracker()
      let metrics: MetricsState = createMetrics()
      for (let sec = 0; sec <= 180; sec += 1) {
        const raw: RawFix = { ...fixAt(0), lng: (sec * 0.05) / METERS_PER_DEGREE, deviceTime: BASE + sec * 1000, receivedAt: BASE + sec * 1000 }
        const processed = processFix(tracker, raw)
        tracker = processed.state
        if (processed.result.accepted) metrics = addFix(metrics, processed.result.fix, session)
      }
      const ended = stopSession(session, BASE + 180_000, 'user')
      const view = toMeasurementView({ targetDurationMs: null, session: ended, tracker, metrics, now: BASE + 180_000 })
      assert.equal(view.result.baselinePaceSecPerKm, null)
    })

    test('세션이 없으면 null이고, 첫 목표는 어떤 경우에도 null이다', () => {
      const none = toMeasurementView({ targetDurationMs: null, session: null, tracker: createGpsTracker(), metrics: createMetrics(), now: BASE })
      assert.equal(none.result.baselinePaceSecPerKm, null)
      assert.equal(none.result.firstGoal, null)
      assert.equal(baselineOf(range(0, 300), 300).result.firstGoal, null)
      assert.equal(baselineOf(range(0, 300), 300).active.minSaveSec, null)
    })
  })
})

describe('toRestoreView', () => {
  const paused = pauseSession(session, BASE + 1000)
  const base = { tracker: createGpsTracker(), now: BASE + 5000 }

  test('복원된 세션이 아니면 null이다 (일반 측정, 세션 없음, 종료)', () => {
    assert.equal(toRestoreView({ ...base, session, needsGpsReverify: false }), null)
    assert.equal(toRestoreView({ ...base, session: paused, needsGpsReverify: false }), null)
    assert.equal(toRestoreView({ ...base, session: null, needsGpsReverify: true }), null)
    assert.equal(toRestoreView({ ...base, session: stopSession(session, BASE + 2000, 'user'), needsGpsReverify: true }), null)
    assert.equal(toRestoreView({ ...base, session, needsGpsReverify: true }), null) // 진행 중이면 일시정지 상태가 아니다
  })

  test('복원된 일시정지 세션은 GPS 확인 전에는 canResume이 false이다', () => {
    assert.deepEqual(toRestoreView({ ...base, session: paused, needsGpsReverify: true }), { canResume: false })
  })

  test('유효 좌표를 받았고 신호가 정상이면 canResume이 true이다', () => {
    const { tracker } = run(session, [3, 4])
    assert.deepEqual(toRestoreView({ tracker, now: BASE + 4500, session: paused, needsGpsReverify: true }), { canResume: true })
  })

  test('신호가 끊겼거나 사용할 수 없으면 canResume이 false이다', () => {
    const { tracker } = run(session, [3, 4])
    assert.deepEqual(toRestoreView({ tracker, now: BASE + 4000 + 10_001, session: paused, needsGpsReverify: true }), { canResume: false })
    const denied = { ...createGpsTracker(), unavailableReason: 'permission-denied' as const }
    assert.deepEqual(toRestoreView({ tracker: denied, now: BASE, session: paused, needsGpsReverify: true }), { canResume: false })
  })
})
