import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineMeters } from './geo.ts'
import { toRawFix } from './geolocationSource.ts'
import type { PositionLike } from './geolocationSource.ts'
import { createGpsTracker, processFix } from './gpsTracker.ts'
import { DEFAULT_METRICS_CONFIG, addFix, createMetrics, getMetrics } from './metrics.ts'
import { pauseSession, resumeSession, startSession, stopSession } from './session.ts'
import type { MeasurementSession, MetricsConfig, MetricsState, RawFix, ValidFix } from './types.ts'

const BASE = 1_700_000_000_000
// 기준 시각(BASE)에서 seconds초 뒤의 시각(ms)
const t = (seconds: number) => BASE + Math.round(seconds * 1000)

// 위도 1°의 길이(m). 북쪽으로 meters만큼 이동한 좌표를 만들 때 쓴다.
const METERS_PER_DEGREE_LAT = (Math.PI * 6_371_000) / 180
const START = { lat: 37.5665, lng: 126.978 }
const northOf = (meters: number) => START.lat + meters / METERS_PER_DEGREE_LAT

function assertClose(actual: number | null, expected: number, tolerance = 0.01) {
  assert.ok(actual !== null, `값이 null이다 (기대값 ${expected})`)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual}은(는) ${expected}에서 ±${tolerance} 안에 있어야 함`,
  )
}

// 검증을 통과한 좌표. seconds초에 시작점에서 북쪽으로 meters만큼 떨어진 곳.
function vf(seconds: number, meters: number, connected = true): ValidFix {
  return {
    lat: northOf(meters),
    lng: START.lng,
    accuracyM: 8,
    deviceTime: t(seconds),
    at: t(seconds),
    connected,
  }
}

// 브라우저가 알려 준 좌표(검증 전)
function raw(seconds: number, meters: number): RawFix {
  return { lat: northOf(meters), lng: START.lng, accuracyM: 8, deviceTime: t(seconds), receivedAt: t(seconds) }
}

function runningSession(): MeasurementSession {
  return startSession(null, BASE, () => 'test-session')
}

function feedAll(
  fixes: ValidFix[],
  session: MeasurementSession = runningSession(),
  initial: MetricsState = createMetrics(),
  config?: MetricsConfig,
): MetricsState {
  let state = initial
  for (const fix of fixes) {
    state = addFix(state, fix, session, config)
  }
  return state
}

// 검증(gpsTracker)을 거쳐서 지표에 반영한다. 실제 GPS와 가상 데이터가 지나는 경로와 같다.
function feedRaw(fixes: RawFix[], session: MeasurementSession = runningSession()): MetricsState {
  let tracker = createGpsTracker()
  let metrics = createMetrics()
  for (const fix of fixes) {
    const processed = processFix(tracker, fix)
    tracker = processed.state
    if (processed.result.accepted) {
      metrics = addFix(metrics, processed.result.fix, session)
    }
  }
  return metrics
}

// 시작점에서 북쪽으로 speedMps로 1초마다 좌표를 만든다. (가상 러닝 데이터를 흉내 낸 것)
function straightRun(speedMps: number, seconds: number): ValidFix[] {
  return Array.from({ length: seconds + 1 }, (_, second) => vf(second, speedMps * second))
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child)
  }
  return Object.freeze(value)
}

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('기본 설정', () => {
  test('승인된 제안값으로 시작하고 동결되어 있다', () => {
    assert.deepEqual(DEFAULT_METRICS_CONFIG, {
      currentPaceWindowMs: 15_000,
      currentPaceMinValidMs: 5_000,
      avgPaceMinDistanceM: 20,
      avgPaceMinValidMs: 10_000,
      minPaceSpeedMps: 0.5,
      gpsLostAfterMs: 10_000,
    })
    assert.equal(Object.isFrozen(DEFAULT_METRICS_CONFIG), true)
  })
})

describe('거리와 유효 측정 시간 (이어진 좌표 쌍의 합)', () => {
  test('3m/s로 30초 달리면 거리 90m, 유효 시간 30초, 평균 속도 3m/s, 평균 페이스 333초/km이다', () => {
    const state = feedAll(straightRun(3, 30))
    const metrics = getMetrics(state, runningSession(), t(30))
    assertClose(metrics.distanceM, 90)
    assert.equal(metrics.validMs, 30_000)
    assertClose(metrics.avgSpeedMps, 3)
    assert.equal(metrics.avgPaceSecPerKm, 333)
    assert.equal(metrics.elapsedMs, 30_000)
    assert.equal(metrics.unmeasuredMs, 0)
  })

  test('거리는 연속한 좌표 쌍 거리의 단순 합이다 (곡선 구간도 쌍마다 더한다)', () => {
    // 동쪽으로 갔다가 북쪽으로 가는 ㄴ자 경로
    const east = (meters: number) => START.lng + meters / (METERS_PER_DEGREE_LAT * Math.cos((START.lat * Math.PI) / 180))
    const points = [
      { lat: START.lat, lng: START.lng },
      { lat: START.lat, lng: east(30) },
      { lat: northOf(40), lng: east(30) },
    ]
    const fixes: ValidFix[] = points.map((point, index) => ({
      ...vf(index * 5, 0),
      lat: point.lat,
      lng: point.lng,
    }))
    const expected =
      haversineMeters(points[0].lat, points[0].lng, points[1].lat, points[1].lng) +
      haversineMeters(points[1].lat, points[1].lng, points[2].lat, points[2].lng)
    const state = feedAll(fixes)
    assertClose(state.distanceM, expected, 1e-9)
    assertClose(state.distanceM, 70, 0.2)
  })

  test('첫 좌표만으로는 거리도 유효 시간도 없고, 시간은 모두 미측정이다', () => {
    const state = feedAll([vf(0, 0)])
    const metrics = getMetrics(state, runningSession(), t(5))
    assert.equal(metrics.distanceM, 0)
    assert.equal(metrics.validMs, 0)
    assert.equal(metrics.avgSpeedMps, null)
    assert.equal(metrics.avgPaceSecPerKm, null)
    assert.equal(metrics.unmeasuredMs, 5000)
  })

  test('좌표를 하나도 받지 못하면 거리 0, 나머지는 null이다 (0이 아님)', () => {
    const metrics = getMetrics(createMetrics(), runningSession(), t(3))
    assert.equal(metrics.distanceM, 0)
    assert.equal(metrics.avgSpeedMps, null)
    assert.equal(metrics.avgPaceSecPerKm, null)
    assert.equal(metrics.currentSpeedMps, null)
    assert.equal(metrics.currentPaceSecPerKm, null)
  })

  test('이어지지 않은 좌표(신호 끊김 뒤 복구)는 먼 좌표여도 거리와 시간을 더하지 않고 새 구간을 시작한다', () => {
    const state = feedAll([vf(0, 0), vf(1, 3), vf(40, 5000, false), vf(41, 5003)])
    assertClose(state.distanceM, 6) // 0→3, 5000→5003만
    assert.equal(state.validMs, 2000)
  })

  test('미측정 시간은 경과 시간에서 유효 측정 시간을 뺀 값이다', () => {
    const state = feedAll([vf(0, 0), vf(1, 3), vf(40, 5000, false), vf(41, 5003)])
    const metrics = getMetrics(state, runningSession(), t(41))
    assert.equal(metrics.elapsedMs, 41_000)
    assert.equal(metrics.validMs, 2000)
    assert.equal(metrics.unmeasuredMs, 39_000)
  })

  test('정지해 있으면(같은 좌표) 거리 0, 속도 0이고 페이스는 null이다', () => {
    const state = feedAll(Array.from({ length: 21 }, (_, second) => vf(second, 0)))
    const metrics = getMetrics(state, runningSession(), t(20))
    assert.equal(metrics.distanceM, 0)
    assert.equal(metrics.validMs, 20_000)
    assert.equal(metrics.avgSpeedMps, 0)
    assert.equal(metrics.avgPaceSecPerKm, null)
    assert.equal(metrics.currentSpeedMps, 0)
    assert.equal(metrics.currentPaceSecPerKm, null)
  })
})

describe('gpsTracker를 거친 입력', () => {
  test('튐 좌표는 거리에 섞이지 않는다', () => {
    const state = feedRaw([raw(0, 0), raw(1, 3), raw(2, 6), raw(3, 800), raw(4, 9)])
    assertClose(state.distanceM, 9)
    assert.equal(state.validMs, 4000) // 0→1, 1→2, 2→4 (튐은 버려지고 다음 정상 좌표와 이어짐)
  })

  test('재앵커된 좌표는 새 구간의 시작점이라 먼 거리가 더해지지 않는다', () => {
    const state = feedRaw([
      raw(0, 0),
      raw(1, 3),
      raw(2, 6),
      raw(3, 800),
      raw(4, 801),
      raw(5, 802),
      raw(6, 803), // 재앵커 (새 구간 시작)
      raw(7, 804),
    ])
    assertClose(state.distanceM, 7) // 0→6m 구간 6m + 803→804 구간 1m
    assert.equal(state.validMs, 3000) // 2초(0→2) + 1초(6→7)... 0→1, 1→2, 6→7
  })

  test('신호가 끊겼다 복구되면(10초 초과) 끊긴 동안의 시간은 유효 시간에 들어가지 않는다', () => {
    const state = feedRaw([raw(0, 0), raw(1, 3), raw(30, 90), raw(31, 93)])
    assertClose(state.distanceM, 6)
    assert.equal(state.validMs, 2000)
  })
})

describe('수동 일시정지', () => {
  test('일시정지 직전과 재개 직후의 좌표 쌍은 거리와 유효 시간에 포함되지 않는다', () => {
    const session = resumeSession(pauseSession(runningSession(), t(2.5)), t(5.5))
    // 2.4초(일시정지 직전) → 5.6초(재개 직후)는 일시정지를 가로지르는 쌍이다. (3 m/s로 계속 이동 중)
    const state = feedAll(
      [vf(0, 0), vf(1, 3), vf(2, 6), vf(2.4, 7.2), vf(5.6, 16.8), vf(6.6, 19.8)],
      session,
    )
    assertClose(state.distanceM, 3 + 3 + 1.2 + 3) // 가로지르는 쌍(9.6m)은 제외
    assert.equal(state.validMs, 1000 + 1000 + 400 + 1000)
  })

  test('일시정지를 가로지르는 쌍은 connected=true로 들어와도 버린다 (일시정지 3초)', () => {
    const session = resumeSession(pauseSession(runningSession(), t(2.5)), t(5.5))
    const state = feedAll([vf(0, 0), vf(1, 3), vf(2, 6), vf(6, 18), vf(7, 21)], session)
    assertClose(state.distanceM, 3 + 3 + 3)
    assert.equal(state.validMs, 3000)
  })

  test('일시정지 중에 도착한 좌표는 반영하지 않고, 재개 뒤 첫 좌표는 새 구간의 시작점이다', () => {
    const running = runningSession()
    const paused = pauseSession(running, t(2.5))
    const resumed = resumeSession(paused, t(5.5))

    let state = feedAll([vf(0, 0), vf(1, 3), vf(2, 6)], running)
    state = addFix(state, vf(3, 9), paused)
    state = addFix(state, vf(4, 12), paused)
    assert.equal(state.lastFix, null)
    assertClose(state.distanceM, 6)

    state = addFix(state, vf(6, 18), resumed)
    assert.equal(state.lastFix?.at, t(6))
    assertClose(state.distanceM, 6) // 아직 쌍이 없다
    state = addFix(state, vf(7, 21), resumed)
    assertClose(state.distanceM, 9)
    assert.equal(state.validMs, 3000)
  })

  test('재개하는 시각과 같은 시각의 좌표는 일시정지가 아니므로 새 구간의 시작점이 된다', () => {
    const session = resumeSession(pauseSession(runningSession(), t(2.5)), t(5.5))
    const state = addFix(createMetrics(), vf(5.5, 0), session)
    assert.equal(state.lastFix?.at, t(5.5))
  })

  test('경과 시간은 일시정지를 빼고, 미측정 시간에는 좌표 쌍이 없는 구간이 남는다', () => {
    const session = resumeSession(pauseSession(runningSession(), t(10)), t(20))
    const before = Array.from({ length: 10 }, (_, second) => vf(second, second * 3)) // 0~9초
    const after = Array.from({ length: 11 }, (_, index) => vf(20 + index, 60 + index * 3)) // 20~30초
    const state = feedAll([...before, ...after], session)
    const metrics = getMetrics(state, session, t(30))
    assert.equal(metrics.elapsedMs, 20_000) // 30초 − 일시정지 10초
    assert.equal(metrics.validMs, 19_000) // 0→9초(9초) + 20→30초(10초)
    assert.equal(metrics.unmeasuredMs, 1000) // 9초→10초 사이(일시정지 직전)
    assertClose(metrics.distanceM, 57)
  })

  test('일시정지를 여러 번 해도 가로지르는 쌍은 모두 버린다', () => {
    let session = runningSession()
    session = resumeSession(pauseSession(session, t(2.5)), t(3.5))
    session = resumeSession(pauseSession(session, t(5.5)), t(6.5))
    const state = feedAll([vf(2, 6), vf(4, 12), vf(5, 15), vf(7, 21), vf(8, 24)], session)
    // 2→4는 첫 일시정지를, 5→7은 둘째 일시정지를 가로지른다. 4→5와 7→8만 남는다.
    assertClose(state.distanceM, 3 + 3)
    assert.equal(state.validMs, 2000)
  })
})

describe('세션 범위 밖의 좌표와 방어', () => {
  test('세션 시작 전의 좌표는 반영하지 않는다', () => {
    const state = createMetrics()
    assert.equal(addFix(state, vf(-1, 0), runningSession()), state)
  })

  test('종료된 세션의 종료 시각 이후 좌표는 반영하지 않는다', () => {
    const session = stopSession(runningSession(), t(5))
    const state = feedAll([vf(0, 0), vf(1, 3)], session)
    assert.equal(addFix(state, vf(6, 18), session), state)
    assert.notEqual(addFix(state, vf(5, 15), session), state) // 종료 시각 정각은 반영
  })

  test('직전 좌표와 같거나 이른 시각의 좌표는 무시한다 (같은 객체를 돌려준다)', () => {
    const state = feedAll([vf(0, 0), vf(1, 3)])
    const session = runningSession()
    assert.equal(addFix(state, vf(1, 9), session), state)
    assert.equal(addFix(state, vf(0.5, 1), session), state)
  })

  test('시각이나 좌표가 숫자가 아니면 무시한다', () => {
    const state = feedAll([vf(0, 0)])
    const session = runningSession()
    assert.equal(addFix(state, { ...vf(1, 3), at: Number.NaN }, session), state)
    assert.equal(addFix(state, { ...vf(1, 3), lat: Number.NaN }, session), state)
    assert.equal(addFix(state, { ...vf(1, 3), lng: Number.POSITIVE_INFINITY }, session), state)
  })
})

describe('평균 속도와 평균 페이스 (유효 측정 시간 기준)', () => {
  test('평균 페이스는 거리 20m 이상, 유효 시간 10초 이상일 때만 계산한다', () => {
    const at = (meters: number, seconds: number) => getMetrics(feedAll([vf(0, 0), vf(seconds, meters)]), runningSession(), t(seconds))
    assert.equal(at(19.5, 10).avgPaceSecPerKm, null) // 거리 부족
    assert.equal(at(20.5, 10).avgPaceSecPerKm, 488) // 10000ms ÷ 20.5m
    assert.equal(at(30, 9.999).avgPaceSecPerKm, null) // 시간 부족
    assert.equal(at(30, 10).avgPaceSecPerKm, 333)
  })

  test('조건이 모자라도 평균 속도는 유효 시간이 있으면 구한다', () => {
    const metrics = getMetrics(feedAll([vf(0, 0), vf(5, 10)]), runningSession(), t(5))
    assertClose(metrics.avgSpeedMps, 2)
    assert.equal(metrics.avgPaceSecPerKm, null)
  })

  test('평균 페이스는 경과 시간이 아니라 유효 측정 시간으로 나눈다 (끊긴 시간이 페이스를 부풀리지 않는다)', () => {
    const state = feedAll([...straightRun(3, 30), vf(100, 5000, false)]) // 70초 동안 좌표 없음
    const metrics = getMetrics(state, runningSession(), t(100))
    assert.equal(metrics.avgPaceSecPerKm, 333) // 경과 시간 100초 기준이면 1000/90*100 ≈ 1111
    assert.equal(metrics.unmeasuredMs, 70_000)
  })

  test('속도가 0.5m/s 미만이면 평균 페이스는 null이고 속도는 그대로 돌려준다', () => {
    const slow = getMetrics(feedAll([vf(0, 0), vf(60, 29)]), runningSession(), t(60))
    assertClose(slow.avgSpeedMps, 29 / 60, 1e-6)
    assert.equal(slow.avgPaceSecPerKm, null)
    const justFast = getMetrics(feedAll([vf(0, 0), vf(60, 31)]), runningSession(), t(60))
    assert.equal(justFast.avgPaceSecPerKm, 1935) // 60000 ÷ 31
  })

  test('설정으로 조건을 바꿀 수 있다', () => {
    const config = { ...DEFAULT_METRICS_CONFIG, avgPaceMinDistanceM: 5, avgPaceMinValidMs: 2000 }
    const state = feedAll([vf(0, 0), vf(2, 6)])
    assert.equal(getMetrics(state, runningSession(), t(2), config).avgPaceSecPerKm, 333)
    assert.equal(getMetrics(state, runningSession(), t(2)).avgPaceSecPerKm, null)
  })
})

describe('현재 속도와 현재 페이스 (최근 15초 창)', () => {
  test('일정한 속도로 달리면 현재 속도와 페이스가 평균과 같다', () => {
    const metrics = getMetrics(feedAll(straightRun(3, 30)), runningSession(), t(30))
    assertClose(metrics.currentSpeedMps, 3)
    assert.equal(metrics.currentPaceSecPerKm, 333)
  })

  test('창이 좌표 쌍의 중간에서 시작하면 겹치는 부분만 비례해서 거리와 시간을 계산한다', () => {
    // 0→10초: 10m (1 m/s), 10→20초: 30m (3 m/s). 창은 [5초, 20초].
    // 첫 쌍은 5초만 겹치므로 5m, 둘째 쌍은 전부 30m → 35m ÷ 15초
    const metrics = getMetrics(feedAll([vf(0, 0), vf(10, 10), vf(20, 40)]), runningSession(), t(20))
    assertClose(metrics.currentSpeedMps, 35 / 15, 1e-6)
    assert.equal(metrics.currentPaceSecPerKm, 429) // 15000 ÷ 35 = 428.57
    // 쌍 전체를 쓰면 (10+30)m ÷ 20초 = 2 m/s가 되어 다르다
    assert.notEqual(Math.round((metrics.currentSpeedMps ?? 0) * 1000), 2000)
  })

  test('창 밖으로 완전히 벗어난 쌍은 쓰지 않고, 걸치는 쌍은 일부만 쓴다', () => {
    // 창 [15초, 30초]: 0→10초 쌍은 제외, 10→20초 쌍은 15→20초(5초) 일부, 20→30초 쌍은 전부
    const metrics = getMetrics(feedAll([vf(0, 0), vf(10, 10), vf(20, 40), vf(30, 70)]), runningSession(), t(30))
    assertClose(metrics.currentSpeedMps, 45 / 15, 1e-6) // 15m + 30m
    assert.equal(metrics.currentPaceSecPerKm, 333)
  })

  test('창은 now가 아니라 마지막 좌표 시각에서 거꾸로 잰다 (now가 늦어져도 같은 값)', () => {
    // 0~20초 1 m/s, 20~30초 3 m/s. 마지막 좌표 30초 → 창 [15초, 30초] = 5m + 30m = 35m ÷ 15초
    const slow = straightRun(1, 20)
    const fast = Array.from({ length: 10 }, (_, index) => vf(21 + index, 20 + 3 * (index + 1)))
    const state = feedAll([...slow, ...fast])
    const atLastFix = getMetrics(state, runningSession(), t(30))
    const later = getMetrics(state, runningSession(), t(35))
    assertClose(atLastFix.currentSpeedMps, 35 / 15, 1e-6)
    assertClose(later.currentSpeedMps, 35 / 15, 1e-6)
  })

  test('창보다 짧은 기록은 있는 만큼만 쓴다 (8초)', () => {
    const metrics = getMetrics(feedAll(straightRun(2, 8)), runningSession(), t(8))
    assertClose(metrics.currentSpeedMps, 2)
    assert.equal(metrics.currentPaceSecPerKm, 500)
  })

  test('창 안의 유효 시간이 5초 미만이면 null이고, 정확히 5초면 계산한다', () => {
    const four = getMetrics(feedAll([vf(0, 0), vf(4, 12)]), runningSession(), t(4))
    assert.equal(four.currentSpeedMps, null)
    assert.equal(four.currentPaceSecPerKm, null)
    const five = getMetrics(feedAll([vf(0, 0), vf(5, 15)]), runningSession(), t(5))
    assertClose(five.currentSpeedMps, 3)
    assert.equal(five.currentPaceSecPerKm, 333)
  })

  test('속도가 바뀌면 현재 값은 따라가고 평균은 천천히 변한다', () => {
    const slow = straightRun(2, 30) // 0~30초, 2 m/s
    const fast = Array.from({ length: 30 }, (_, index) => vf(31 + index, 60 + 4 * (index + 1))) // 31~60초, 4 m/s
    const metrics = getMetrics(feedAll([...slow, ...fast]), runningSession(), t(60))
    assertClose(metrics.currentSpeedMps, 4, 0.05)
    assert.equal(metrics.currentPaceSecPerKm, 250)
    assert.equal(metrics.avgPaceSecPerKm, 333) // 약 3 m/s
  })

  test('창 길이와 최소 시간은 설정으로 바꿀 수 있다 (창 5초, 최소 2초)', () => {
    const config = { ...DEFAULT_METRICS_CONFIG, currentPaceWindowMs: 5000, currentPaceMinValidMs: 2000 }
    const slow = straightRun(2, 20)
    const fast = Array.from({ length: 6 }, (_, index) => vf(21 + index, 40 + 4 * (index + 1)))
    const state = feedAll([...slow, ...fast], runningSession(), createMetrics(), config)
    const metrics = getMetrics(state, runningSession(), t(26), config)
    assertClose(metrics.currentSpeedMps, 4, 0.05)
  })

  test('창 밖의 오래된 쌍은 상태에서 지워서 목록이 계속 커지지 않는다', () => {
    const state = feedAll(straightRun(3, 600))
    assert.ok(state.recent.length <= 16, `recent ${state.recent.length}개`)
  })
})

describe('현재 페이스는 GPS 끊김, 일시정지, 종료에서 null이다', () => {
  const state = feedAll(straightRun(3, 30)) // 마지막 좌표 30초

  test('마지막 좌표 후 10초까지는 계산하고, 10초를 넘기면 GPS가 끊긴 것으로 보고 null이다', () => {
    const atEdge = getMetrics(state, runningSession(), t(40))
    assert.equal(atEdge.currentPaceSecPerKm, 333)
    const lost = getMetrics(state, runningSession(), t(40) + 1)
    assert.equal(lost.currentSpeedMps, null)
    assert.equal(lost.currentPaceSecPerKm, null)
  })

  test('GPS가 끊겨도 누적 거리와 평균 페이스는 유지된다', () => {
    const lost = getMetrics(state, runningSession(), t(60))
    assertClose(lost.distanceM, 90)
    assert.equal(lost.avgPaceSecPerKm, 333)
  })

  test('일시정지 중에는 null이고 평균은 유지된다', () => {
    const paused = pauseSession(runningSession(), t(31))
    const metrics = getMetrics(state, paused, t(32))
    assert.equal(metrics.currentSpeedMps, null)
    assert.equal(metrics.currentPaceSecPerKm, null)
    assert.equal(metrics.avgPaceSecPerKm, 333)
  })

  test('종료된 뒤에는 null이다', () => {
    const finished = stopSession(runningSession(), t(30))
    const metrics = getMetrics(state, finished, t(30))
    assert.equal(metrics.currentSpeedMps, null)
    assert.equal(metrics.currentPaceSecPerKm, null)
    assert.equal(metrics.elapsedMs, 30_000)
  })

  test('재개한 직후에는 새 좌표가 5초 이상 쌓이기 전까지 이전 값을 보여 주지 않는다', () => {
    const session = resumeSession(pauseSession(runningSession(), t(31)), t(35))
    assert.equal(getMetrics(state, session, t(36)).currentPaceSecPerKm, null)

    // 재개 후 좌표: 36초(새 구간 시작), 37~40초 (4초분) → 아직 부족
    let next = state
    next = addFix(next, vf(36, 108), session)
    for (const second of [37, 38, 39, 40]) next = addFix(next, vf(second, 108 + (second - 36) * 3), session)
    assert.equal(getMetrics(next, session, t(40)).currentPaceSecPerKm, null)
    // 41초에 5초분이 쌓이면 계산한다
    next = addFix(next, vf(41, 123), session)
    assert.equal(getMetrics(next, session, t(41)).currentPaceSecPerKm, 333)
  })

  test('신호가 끊겼다 복구된 직후도 새 구간이 5초 이상 쌓이기 전까지 null이다', () => {
    let next = state
    next = addFix(next, vf(50, 5000, false), runningSession())
    next = addFix(next, vf(51, 5003), runningSession())
    assert.equal(getMetrics(next, runningSession(), t(51)).currentPaceSecPerKm, null)
    for (const second of [52, 53, 54, 55, 56]) next = addFix(next, vf(second, 5000 + (second - 50) * 3), runningSession())
    assert.equal(getMetrics(next, runningSession(), t(56)).currentPaceSecPerKm, 333)
  })

  test('일시정지 중에 도착한 좌표 뒤에는 현재 값이 없다', () => {
    const paused = pauseSession(runningSession(), t(31))
    const next = addFix(state, vf(32, 96), paused)
    const resumed = resumeSession(paused, t(35))
    assert.equal(getMetrics(next, resumed, t(36)).currentPaceSecPerKm, null)
  })

  test('now가 숫자가 아니면 현재 값은 null이고 나머지는 계산된다', () => {
    const metrics = getMetrics(state, runningSession(), Number.NaN)
    assert.equal(metrics.currentSpeedMps, null)
    assertClose(metrics.distanceM, 90)
  })
})

describe('속도가 0.5m/s 미만이면 페이스는 null이다', () => {
  test('현재 속도 0.45m/s: 속도는 값으로 주고 페이스는 null', () => {
    const metrics = getMetrics(feedAll(straightRun(0.45, 20)), runningSession(), t(20))
    assertClose(metrics.currentSpeedMps, 0.45, 1e-6)
    assert.equal(metrics.currentPaceSecPerKm, null)
  })

  test('현재 속도 0.55m/s: 페이스 1818초/km', () => {
    const metrics = getMetrics(feedAll(straightRun(0.55, 20)), runningSession(), t(20))
    assertClose(metrics.currentSpeedMps, 0.55, 1e-6)
    assert.equal(metrics.currentPaceSecPerKm, 1818)
  })

  test('최소 속도는 설정으로 바꿀 수 있다 (1m/s)', () => {
    const config = { ...DEFAULT_METRICS_CONFIG, minPaceSpeedMps: 1 }
    const metrics = getMetrics(feedAll(straightRun(0.8, 20)), runningSession(), t(20), config)
    assertClose(metrics.currentSpeedMps, 0.8, 1e-6)
    assert.equal(metrics.currentPaceSecPerKm, null)
  })
})

describe('실제 GPS와 가상 데이터가 같은 입력 구조를 쓴다', () => {
  test('가상 러닝(RawFix)과 브라우저 위치(PositionLike → toRawFix)가 같은 결과를 낸다', () => {
    const seconds = 40
    const virtual: RawFix[] = Array.from({ length: seconds + 1 }, (_, second) => raw(second, 3 * second))
    const positions: PositionLike[] = Array.from({ length: seconds + 1 }, (_, second) => ({
      coords: { latitude: northOf(3 * second), longitude: START.lng, accuracy: 8 },
      timestamp: t(second),
    }))
    const real = positions.map((position) => toRawFix(position, position.timestamp))

    const fromVirtual = feedRaw(virtual)
    const fromReal = feedRaw(real)
    assert.deepEqual(fromReal, fromVirtual)

    const metrics = getMetrics(fromVirtual, runningSession(), t(seconds))
    assertClose(metrics.distanceM, 120)
    assert.equal(metrics.avgPaceSecPerKm, 333)
    assert.equal(metrics.currentPaceSecPerKm, 333)
  })
})

describe('불변성과 불변식', () => {
  test('입력을 동결해도 오류 없이 동작하고 입력을 바꾸지 않는다', () => {
    const session = deepFreeze(resumeSession(pauseSession(runningSession(), t(10)), t(12)))
    const state = deepFreeze(feedAll(straightRun(3, 8), session))
    const snapshot = JSON.stringify(state)
    const fix = deepFreeze(vf(15, 45))
    assert.doesNotThrow(() => {
      addFix(state, fix, session)
      getMetrics(state, session, t(16))
    })
    assert.equal(JSON.stringify(state), snapshot)
  })

  test('같은 입력은 항상 같은 결과를 낸다', () => {
    const fixes = straightRun(3, 20)
    const first = feedAll(fixes)
    const second = feedAll(fixes)
    assert.deepEqual(first, second)
    assert.deepEqual(getMetrics(first, runningSession(), t(20)), getMetrics(second, runningSession(), t(20)))
  })

  test('일시정지 없이 모두 이어지면 거리는 쌍 거리의 합, 유효 시간은 처음~마지막 좌표의 시간이다', () => {
    const rng = createRng(99)
    let meters = 0
    let clock = 0
    const fixes: ValidFix[] = []
    for (let index = 0; index < 200; index += 1) {
      clock += 0.5 + rng() * 2
      meters += rng() * 6
      fixes.push(vf(clock, meters))
    }
    const state = feedAll(fixes)
    let expected = 0
    for (let index = 1; index < fixes.length; index += 1) {
      expected += haversineMeters(fixes[index - 1].lat, fixes[index - 1].lng, fixes[index].lat, fixes[index].lng)
    }
    assertClose(state.distanceM, expected, 1e-6)
    assert.equal(state.validMs, fixes[fixes.length - 1].at - fixes[0].at)
  })

  test('무작위 이동, 끊김, 일시정지, 일시정지 중 좌표 속에서도 불변식이 유지된다', () => {
    const rng = createRng(2024)
    let session = runningSession()
    let state = createMetrics()
    let clock = 0
    let meters = 0
    let previousDistance = 0
    let previousValid = 0

    for (let step = 0; step < 400; step += 1) {
      clock += 0.3 + rng() * 2.5
      const action = rng()
      if (action < 0.06 && session.status === 'running') {
        session = pauseSession(session, t(clock))
      } else if (action < 0.14 && session.status === 'paused') {
        session = resumeSession(session, t(clock))
      } else {
        meters += rng() * 5
        const connected = rng() < 0.85
        if (!connected) meters += rng() * 500
        state = addFix(state, vf(clock, meters, connected), session)
      }

      const metrics = getMetrics(state, session, t(clock))
      assert.ok(metrics.distanceM >= previousDistance - 1e-9, '거리가 줄어듦')
      assert.ok(metrics.validMs >= previousValid, '유효 시간이 줄어듦')
      assert.ok(metrics.validMs <= metrics.elapsedMs, '유효 시간이 경과 시간보다 큼')
      assert.ok(metrics.unmeasuredMs >= 0)
      assert.equal(metrics.unmeasuredMs, metrics.elapsedMs - metrics.validMs)
      for (const pace of [metrics.avgPaceSecPerKm, metrics.currentPaceSecPerKm]) {
        assert.ok(pace === null || (Number.isInteger(pace) && pace > 0), `페이스 ${pace}`)
      }
      if (session.status !== 'running') {
        assert.equal(metrics.currentSpeedMps, null)
        assert.equal(metrics.currentPaceSecPerKm, null)
      }
      previousDistance = metrics.distanceM
      previousValid = metrics.validMs
    }
    assert.ok(state.recent.length < 40)
  })
})
