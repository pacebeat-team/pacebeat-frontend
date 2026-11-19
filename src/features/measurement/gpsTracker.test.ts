import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineMeters } from './geo.ts'
import {
  DEFAULT_GPS_CONFIG,
  applyGpsError,
  createGpsTracker,
  getGpsStatus,
  isGpsVerified,
  processFix,
} from './gpsTracker.ts'
import type {
  GpsConfig,
  GpsProcessResult,
  GpsTrackerState,
  RawFix,
  RejectReason,
  ValidFix,
} from './types.ts'

const BASE = 1_700_000_000_000
// 기준 시각(BASE)에서 seconds초 뒤의 시각(ms)
const t = (seconds: number) => BASE + Math.round(seconds * 1000)

// 위도 1°의 길이(m). 북쪽으로 meters만큼 이동한 좌표를 만들 때 쓴다.
const METERS_PER_DEGREE_LAT = (Math.PI * 6_371_000) / 180
const START = { lat: 37.5665, lng: 126.978 }
const northOf = (meters: number) => START.lat + meters / METERS_PER_DEGREE_LAT

// seconds초에 받은 좌표. 기본은 시작점에서 북쪽으로 meters만큼, 정확도 8m, 기기 시각 = 수신 시각
function fix(seconds: number, meters = 0, overrides: Partial<RawFix> = {}): RawFix {
  return {
    lat: northOf(meters),
    lng: START.lng,
    accuracyM: 8,
    deviceTime: t(seconds),
    receivedAt: t(seconds),
    ...overrides,
  }
}

function feed(fixes: RawFix[], initial: GpsTrackerState = createGpsTracker(), config?: GpsConfig) {
  let state = initial
  const results: GpsProcessResult[] = []
  for (const raw of fixes) {
    const processed = processFix(state, raw, config)
    state = processed.state
    results.push(processed.result)
  }
  return { state, results }
}

function expectAccepted(result: GpsProcessResult): ValidFix {
  if (!result.accepted) {
    assert.fail(`유효해야 하는데 버려짐: ${result.reason}`)
  }
  return result.fix
}

function expectRejected(result: GpsProcessResult): RejectReason {
  if (result.accepted) {
    assert.fail('버려져야 하는데 유효로 판정됨')
  }
  return result.reason
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

describe('정상 이동', () => {
  const walk = Array.from({ length: 30 }, (_, index) => fix(index, index * 3)) // 3m/s로 30초

  test('모든 좌표가 유효하고 첫 좌표만 이어지지 않는다', () => {
    const { results } = feed(walk)
    const fixes = results.map(expectAccepted)
    assert.equal(fixes.length, 30)
    assert.equal(fixes[0].connected, false)
    assert.ok(fixes.slice(1).every((valid) => valid.connected))
  })

  test('세션 시간 기준 시각(at)은 수신 시각이고 기기 시각은 따로 보관한다', () => {
    const raw = fix(5, 0, { deviceTime: t(4.5), receivedAt: t(5) })
    const valid = expectAccepted(processFix(createGpsTracker(), raw).result)
    assert.equal(valid.at, t(5))
    assert.equal(valid.deviceTime, t(4.5))
  })

  test('GPS 상태는 마지막 유효 좌표 후 10초까지 good이고 그 뒤에는 lost이다', () => {
    const { state } = feed(walk) // 마지막 좌표는 29초
    assert.equal(getGpsStatus(state, t(29)), 'good')
    assert.equal(getGpsStatus(state, t(39)), 'good') // 정확히 10초
    assert.equal(getGpsStatus(state, t(39) + 1), 'lost') // 10초 + 1ms
  })
})

describe('첫 좌표와 검증 상태', () => {
  test('새 추적 상태는 검색 중(null)이고 아직 검증되지 않았다', () => {
    const state = createGpsTracker()
    assert.equal(getGpsStatus(state, t(0)), null)
    assert.equal(isGpsVerified(state), false)
  })

  test('첫 유효 좌표가 들어오면 검증됨이 되고 이어지지 않는 구간의 시작이다', () => {
    const processed = processFix(createGpsTracker(), fix(0))
    assert.equal(expectAccepted(processed.result).connected, false)
    assert.equal(isGpsVerified(processed.state), true)
    assert.equal(processed.state.acceptedCount, 1)
    assert.equal(getGpsStatus(processed.state, t(0)), 'good')
  })

  test('정확도가 나쁜 첫 좌표는 검증되지 않고 검색 중으로 남는다', () => {
    const processed = processFix(createGpsTracker(), fix(0, 0, { accuracyM: 100 }))
    assert.equal(expectRejected(processed.result), 'poor-accuracy')
    assert.equal(isGpsVerified(processed.state), false)
    assert.equal(getGpsStatus(processed.state, t(0)), null)
  })
})

describe('정확도', () => {
  test('경계값: 30m는 유효하고 30.01m는 버린다', () => {
    assert.equal(processFix(createGpsTracker(), fix(0, 0, { accuracyM: 30 })).result.accepted, true)
    const over = processFix(createGpsTracker(), fix(0, 0, { accuracyM: 30.01 }))
    assert.equal(expectRejected(over.result), 'poor-accuracy')
  })

  test('정확도가 없거나(null) 올바르지 않은 값은 버린다', () => {
    for (const accuracyM of [null, Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      const processed = processFix(createGpsTracker(), fix(0, 0, { accuracyM }))
      assert.equal(expectRejected(processed.result), 'poor-accuracy', `accuracyM=${accuracyM}`)
    }
  })

  test('버려진 좌표는 직전 유효 좌표(기준)와 상태를 바꾸지 않는다', () => {
    const { state } = feed([fix(0), fix(1, 3)])
    const processed = processFix(state, fix(2, 6, { accuracyM: 80 }))
    assert.equal(expectRejected(processed.result), 'poor-accuracy')
    assert.equal(processed.state, state)
  })

  test('정확도가 나쁜 좌표가 끼어도 다음 정상 좌표는 직전 유효 좌표와 이어진다', () => {
    const { results } = feed([fix(0), fix(1, 3), fix(2, 6, { accuracyM: 80 }), fix(3, 9)])
    assert.equal(expectRejected(results[2]), 'poor-accuracy')
    assert.equal(expectAccepted(results[3]).connected, true)
  })

  test('설정으로 기준을 바꿀 수 있다 (maxAccuracyM 50)', () => {
    const raw = fix(0, 0, { accuracyM: 40 })
    assert.equal(processFix(createGpsTracker(), raw).result.accepted, false)
    assert.equal(processFix(createGpsTracker(), raw, { ...DEFAULT_GPS_CONFIG, maxAccuracyM: 50 }).result.accepted, true)
  })

  test('정확도가 나쁜 좌표만 계속 들어오면 10초 뒤 lost가 된다', () => {
    const poor = Array.from({ length: 15 }, (_, index) => fix(index + 1, index * 3, { accuracyM: 90 }))
    const { state, results } = feed([fix(0), ...poor])
    assert.ok(results.slice(1).every((result) => !result.accepted))
    assert.equal(getGpsStatus(state, t(10)), 'good')
    assert.equal(getGpsStatus(state, t(15)), 'lost')
  })
})

describe('GPS 튐', () => {
  test('1초 만에 500m 순간이동은 버리고 직전 유효 좌표를 유지한다', () => {
    const { state } = feed([fix(0), fix(1, 3)])
    const processed = processFix(state, fix(2, 500))
    assert.equal(expectRejected(processed.result), 'jump')
    assert.equal(processed.state.anchor, state.anchor)
  })

  test('튐 다음의 정상 좌표는 직전 유효 좌표와 이어진다', () => {
    const { results } = feed([fix(0), fix(1, 3), fix(2, 500), fix(3, 9)])
    assert.equal(expectRejected(results[2]), 'jump')
    assert.equal(expectAccepted(results[3]).connected, true)
  })

  test('오차 반경만큼의 흔들림은 한도 안이다 (정확도 10m+10m, 1초: 12×1+20 = 32m)', () => {
    const base = fix(0, 0, { accuracyM: 10 })
    const within = processFix(feed([base]).state, fix(1, 31.9, { accuracyM: 10 }))
    assert.equal(within.result.accepted, true)
    const beyond = processFix(feed([base]).state, fix(1, 32.1, { accuracyM: 10 }))
    assert.equal(expectRejected(beyond.result), 'jump')
  })

  test('시간 간격이 길수록 허용 한도가 커진다 (5초: 12×5+8+8 = 76m)', () => {
    const { state } = feed([fix(0)])
    assert.equal(processFix(state, fix(5, 75.9)).result.accepted, true)
    assert.equal(expectRejected(processFix(state, fix(5, 76.1)).result), 'jump')
  })

  test('최대 속도(12m/s)로 달려도 유효하다', () => {
    const run = Array.from({ length: 10 }, (_, index) => fix(index, index * 12))
    assert.ok(feed(run).results.every((result) => result.accepted))
  })

  test('설정으로 속도 한도를 바꿀 수 있다 (maxSpeedMps 3)', () => {
    const { state } = feed([fix(0)])
    const raw = fix(1, 20)
    assert.equal(processFix(state, raw).result.accepted, true) // 12×1+16 = 28
    assert.equal(
      expectRejected(processFix(state, raw, { ...DEFAULT_GPS_CONFIG, maxSpeedMps: 3 }).result), // 3×1+16 = 19
      'jump',
    )
  })
})

describe('재앵커 (기준 좌표가 잘못된 경우)', () => {
  test('횟수(3회)와 지속 시간(3초)을 모두 채우면 새 구간의 시작점으로 받아들인다', () => {
    // 튐 후보: 1s, 2s, 3s는 횟수만 채웠고(2초 지속), 4s에서 3초 지속
    const { results, state } = feed([fix(0), fix(1, 800), fix(2, 801), fix(3, 802), fix(4, 803)])
    assert.deepEqual(results.slice(1, 4).map(expectRejected), ['jump', 'jump', 'jump'])
    const reanchored = expectAccepted(results[4])
    assert.equal(reanchored.connected, false) // 이어지지 않는 새 구간
    assert.equal(state.pendingJumps.length, 0)
    assert.equal(state.anchor?.at, t(4))
  })

  test('짧은 시간 동안 튐이 연속되면 횟수가 많아도 재앵커하지 않는다', () => {
    // 1초 안에 10개가 몰려와도 지속 시간은 0.9초
    const burst = Array.from({ length: 10 }, (_, index) => fix(1 + index * 0.1, 800 + index))
    const { results, state } = feed([fix(0), ...burst])
    assert.ok(results.slice(1).every((result) => !result.accepted && result.reason === 'jump'))
    assert.equal(state.anchor?.at, t(0))
  })

  test('경계값: 지속 시간이 2,999ms면 버리고 3,000ms면 받아들인다', () => {
    const short = feed([fix(0), fix(1, 800), fix(2, 801), fix(3.999, 802)])
    assert.equal(expectRejected(short.results[3]), 'jump')
    const exact = feed([fix(0), fix(1, 800), fix(2, 801), fix(4, 802)])
    assert.equal(expectAccepted(exact.results[3]).connected, false)
  })

  test('지속 시간을 채워도 횟수가 모자라면 재앵커하지 않는다 (횟수 조건 유지)', () => {
    const { results } = feed([fix(0), fix(1, 800), fix(5, 801)]) // 후보 2개, 4초 지속
    assert.equal(expectRejected(results[1]), 'jump')
    assert.equal(expectRejected(results[2]), 'jump')
  })

  test('재앵커 뒤의 다음 좌표는 새 기준과 이어진다', () => {
    const { results } = feed([fix(0), fix(1, 800), fix(2, 801), fix(3, 802), fix(4, 803), fix(5, 804)])
    assert.equal(expectAccepted(results[5]).connected, true)
  })

  test('재앵커 횟수는 설정으로 바꿀 수 있다 (5회)', () => {
    const config = { ...DEFAULT_GPS_CONFIG, reanchorAfter: 5 }
    const { results } = feed([fix(0), ...[1, 2, 3, 4, 5].map((s) => fix(s, 800 + s))], createGpsTracker(), config)
    assert.deepEqual(results.slice(1, 5).map(expectRejected), ['jump', 'jump', 'jump', 'jump'])
    assert.equal(expectAccepted(results[5]).connected, false) // 5회째, 4초 지속
  })

  test('지속 시간은 설정으로 바꿀 수 있다 (0이면 시간 조건 없음, 1,500ms)', () => {
    const noTime = { ...DEFAULT_GPS_CONFIG, reanchorMinDurationMs: 0 }
    const first = feed([fix(0), fix(1, 800), fix(2, 801), fix(3, 802)], createGpsTracker(), noTime)
    assert.equal(expectAccepted(first.results[3]).connected, false) // 3회째에 바로
    const custom = { ...DEFAULT_GPS_CONFIG, reanchorMinDurationMs: 1_500 }
    const second = feed([fix(0), fix(1, 800), fix(2, 801), fix(3, 802)], createGpsTracker(), custom)
    assert.equal(expectAccepted(second.results[3]).connected, false) // 2초 지속 ≥ 1.5초
    const tooShort = feed([fix(0), fix(1, 800), fix(1.5, 801), fix(2, 802)], createGpsTracker(), custom)
    assert.equal(expectRejected(tooShort.results[3]), 'jump') // 1초 지속 < 1.5초
  })

  test('서로 일치하지 않는 무작위 튐은 몇 번이 와도 재앵커하지 않는다', () => {
    const { results, state } = feed([fix(0), fix(1, 800), fix(2, 1600), fix(3, 2400), fix(4, 3200), fix(5, 4000)])
    assert.deepEqual(results.slice(1).map(expectRejected), ['jump', 'jump', 'jump', 'jump', 'jump'])
    assert.equal(state.anchor?.at, t(0))
    assert.equal(state.pendingJumps.length, 1)
  })

  test('튐 사이에 정상 좌표가 오면 후보(횟수와 지속 시간)가 처음부터 다시 센다', () => {
    const { results, state } = feed([
      fix(0),
      fix(1, 800), // 튐 후보 시작
      fix(2, 801),
      fix(3, 3), // 정상(기준 근처) → 후보 초기화
      fix(4, 800), // 튐 후보 새로 시작
      fix(5, 801),
      fix(6, 802), // 후보 3개이지만 2초 지속 (초기화가 없었다면 5초 지속으로 승인됨)
      fix(7, 803), // 3초 지속 → 재앵커
    ])
    assert.equal(expectAccepted(results[3]).connected, true)
    assert.equal(state.pendingJumps.length, 0)
    assert.deepEqual(results.slice(4, 7).map(expectRejected), ['jump', 'jump', 'jump'])
    assert.equal(expectAccepted(results[7]).connected, false)
  })

  test('서로 이어지지 않는 튐이 끼면 후보가 이어지지 않고 새로 시작한다', () => {
    // 3초 동안 튐이 이어지다가 마지막 좌표가 후보와 일치하지 않음 → 후보 1개로 초기화
    const { results, state } = feed([fix(0), fix(1, 800), fix(2, 801), fix(3, 802), fix(4, 5000)])
    assert.equal(expectRejected(results[4]), 'jump')
    assert.equal(state.pendingJumps.length, 1)
    assert.equal(state.anchor?.at, t(0))
  })

  test('간격이 너무 길어(10초 초과) 신호가 끊긴 뒤에는 후보를 버리고 새 구간으로 시작한다', () => {
    const { results, state } = feed([fix(0), fix(1, 800), fix(2, 801), fix(12, 802)])
    assert.equal(expectRejected(results[2]), 'jump')
    assert.equal(expectAccepted(results[3]).connected, false)
    assert.equal(state.pendingJumps.length, 0)
  })

  test('튐 뒤에 신호가 끊겼다 복구되면 후보를 버리고 새 구간으로 시작한다', () => {
    const { results, state } = feed([fix(0), fix(1, 800), fix(30, 800)])
    assert.equal(expectRejected(results[1]), 'jump')
    assert.equal(expectAccepted(results[2]).connected, false)
    assert.equal(state.pendingJumps.length, 0)
  })
})

describe('중복 좌표와 시간 순서', () => {
  test('같은 기기 시각, 같은 좌표가 다시 오면 중복이고 상태는 그대로이다', () => {
    const { state } = feed([fix(0), fix(5, 15)])
    const processed = processFix(state, fix(5, 15))
    assert.equal(expectRejected(processed.result), 'duplicate')
    assert.equal(processed.state, state)
  })

  test('같은 기기 시각에 좌표만 다르면 먼저 받은 것을 유지한다 (중복)', () => {
    const { state } = feed([fix(0), fix(5, 15)])
    assert.equal(expectRejected(processFix(state, fix(5, 40)).result), 'duplicate')
  })

  test('같은 좌표라도 새 시각이면 유효하다 (정지 중, 이어짐)', () => {
    const { results } = feed([fix(0), fix(5, 15), fix(6, 15)])
    const stationary = expectAccepted(results[2])
    assert.equal(stationary.connected, true)
    assert.equal(stationary.at, t(6))
  })

  test('직전 유효 좌표보다 이른 기기 시각은 순서 오류이다 (수신이 늦어도 마찬가지)', () => {
    const { state } = feed([fix(0), fix(5, 15)])
    const late = fix(6, 18, { deviceTime: t(3) })
    assert.equal(expectRejected(processFix(state, late).result), 'out-of-order')
  })

  test('순서가 뒤바뀐 좌표를 버려도 이후 정상 좌표는 계속 이어진다', () => {
    const { results } = feed([fix(0), fix(5, 15), fix(6, 18, { deviceTime: t(3) }), fix(7, 21)])
    assert.equal(expectRejected(results[2]), 'out-of-order')
    assert.equal(expectAccepted(results[3]).connected, true)
  })
})

describe('오래된 좌표와 기기 시각', () => {
  test('경계값: 수신 − 기기 시각이 10,000ms면 유효하고 10,001ms면 오래된 좌표이다', () => {
    const edge = fix(20, 0, { deviceTime: t(10) })
    assert.equal(processFix(createGpsTracker(), edge).result.accepted, true)
    const stale = fix(20, 0, { deviceTime: t(10) - 1 })
    assert.equal(expectRejected(processFix(createGpsTracker(), stale).result), 'stale')
  })

  test('감시 시작 직후 도착한 캐시된 좌표(5분 전)는 버리고, 이후 새 좌표를 받아들인다', () => {
    const cached = fix(100, 0, { deviceTime: t(100) - 5 * 60 * 1000 })
    const { results, state } = feed([cached, fix(101, 3)])
    assert.equal(expectRejected(results[0]), 'stale')
    assert.equal(expectAccepted(results[1]).connected, false)
    assert.equal(isGpsVerified(state), true)
  })

  test('한꺼번에 밀려와 오래된 좌표는 채워 넣지 않고 버린다', () => {
    const { state } = feed([fix(0)])
    // 수신은 모두 40초인데 기기 시각은 20, 24, 28, 31초 (나이 20, 16, 12, 9초)
    const batch = [20, 24, 28, 31].map((second) => fix(40, second, { deviceTime: t(second) }))
    const { results } = feed(batch, state)
    assert.deepEqual(results.slice(0, 3).map(expectRejected), ['stale', 'stale', 'stale'])
    // 10초 이내인 마지막 좌표만 받아들이고, 간격이 벌어졌으므로 이어지지 않는다
    assert.equal(expectAccepted(results[3]).connected, false)
  })

  test('기기 시각이 수신보다 한참 앞서면 수신 시각을 기준으로 쓰고, 이후 정상 좌표를 막지 않는다', () => {
    const futureDevice = fix(10, 0, { deviceTime: t(10) + 60_000 })
    const first = processFix(createGpsTracker(), futureDevice)
    expectAccepted(first.result)
    assert.equal(first.state.anchor?.time, t(10))
    const next = processFix(first.state, fix(11, 3))
    assert.equal(expectAccepted(next.result).connected, true)
  })

  test('경계값: 기기 시각이 10,000ms 앞서면 기기 시각을, 10,001ms 앞서면 수신 시각을 기준으로 쓴다', () => {
    const edge = processFix(createGpsTracker(), fix(10, 0, { deviceTime: t(10) + 10_000 }))
    assert.equal(edge.state.anchor?.time, t(10) + 10_000)
    const beyond = processFix(createGpsTracker(), fix(10, 0, { deviceTime: t(10) + 10_001 }))
    assert.equal(beyond.state.anchor?.time, t(10))
  })

  test('시간 값이 올바르지 않으면 버린다', () => {
    for (const overrides of [
      { deviceTime: Number.NaN },
      { receivedAt: Number.NaN },
      { deviceTime: Number.POSITIVE_INFINITY },
    ]) {
      const processed = processFix(createGpsTracker(), fix(0, 0, overrides))
      assert.equal(expectRejected(processed.result), 'invalid-time')
    }
  })

  test('좌표 값이 올바르지 않으면 버린다', () => {
    for (const overrides of [{ lat: 91 }, { lng: -181 }, { lat: Number.NaN }, { lng: Number.POSITIVE_INFINITY }]) {
      const processed = processFix(createGpsTracker(), fix(0, 0, overrides))
      assert.equal(expectRejected(processed.result), 'invalid-coordinates')
    }
  })

  test('수신 시각이 거꾸로 가도 세션 시간 기준 시각(at)은 줄어들지 않는다', () => {
    const { results } = feed([fix(10), fix(11, 3, { receivedAt: t(8), deviceTime: t(11) })])
    const second = expectAccepted(results[1])
    assert.equal(second.at, t(10))
    assert.equal(second.connected, true)
  })
})

describe('신호 끊김과 복구', () => {
  const beforeLoss = Array.from({ length: 11 }, (_, index) => fix(index, index * 3)) // 0~10초

  test('좌표가 끊기면 10초까지는 good, 그 뒤에는 lost이다 (경계값 포함)', () => {
    const { state } = feed(beforeLoss) // 마지막 유효 좌표 10초
    assert.equal(getGpsStatus(state, t(15)), 'good')
    assert.equal(getGpsStatus(state, t(20)), 'good') // 정확히 10초
    assert.equal(getGpsStatus(state, t(20) + 1), 'lost')
    assert.equal(getGpsStatus(state, t(35)), 'lost')
  })

  test('복구된 좌표는 유효하지만 이전과 이어지지 않는다 (먼 좌표여도 속도 판단을 하지 않는다)', () => {
    const { state } = feed(beforeLoss)
    const recovered = processFix(state, fix(40, 5000)) // 30초 만에 5km: 이어졌다면 튐
    assert.equal(expectAccepted(recovered.result).connected, false)
    assert.equal(getGpsStatus(recovered.state, t(40)), 'good')
  })

  test('복구된 다음 좌표부터는 다시 이어진다', () => {
    const { results } = feed([...beforeLoss, fix(40, 5000), fix(41, 5003)])
    assert.equal(expectAccepted(results[12]).connected, true)
  })

  test('경계값: 유효 좌표 사이 간격이 10,000ms면 이어지고 10,001ms면 끊긴다', () => {
    const { state } = feed([fix(0)])
    assert.equal(expectAccepted(processFix(state, fix(10, 5)).result).connected, true)
    const justOver = fix(10, 5, { deviceTime: t(10) + 1, receivedAt: t(10) + 1 })
    assert.equal(expectAccepted(processFix(state, justOver).result).connected, false)
  })

  test('설정으로 이어짐 간격을 바꿀 수 있다 (2초)', () => {
    const { state } = feed([fix(0)])
    const config = { ...DEFAULT_GPS_CONFIG, connectGapMs: 2000 }
    assert.equal(expectAccepted(processFix(state, fix(3, 1), config).result).connected, false)
    assert.equal(getGpsStatus(state, t(3), config), 'lost')
  })
})

describe('GPS 오류와 사용 불가', () => {
  test('권한 거부, 비보안, 미지원은 사용 불가이다', () => {
    for (const reason of ['permission-denied', 'insecure-context', 'unsupported'] as const) {
      const state = applyGpsError(createGpsTracker(), reason)
      assert.equal(state.unavailableReason, reason)
      assert.equal(getGpsStatus(state, t(0)), 'unavailable')
    }
  })

  test('일시적 오류(position-unavailable, timeout)는 상태를 바꾸지 않는다', () => {
    const { state } = feed([fix(0)])
    assert.equal(applyGpsError(state, 'position-unavailable'), state)
    assert.equal(applyGpsError(state, 'timeout'), state)
    assert.equal(getGpsStatus(state, t(5)), 'good')
    assert.equal(getGpsStatus(state, t(15)), 'lost') // 끊긴 시간으로 판정
  })

  test('최근 좌표가 있어도 사용 불가가 우선한다', () => {
    const { state } = feed([fix(0)])
    const denied = applyGpsError(state, 'permission-denied')
    assert.equal(getGpsStatus(denied, t(1)), 'unavailable')
    assert.equal(denied.anchor, state.anchor)
  })

  test('사용 불가 상태에서 버려진 좌표는 상태를 바꾸지 않고, 유효 좌표가 오면 해제된다', () => {
    const denied = applyGpsError(createGpsTracker(), 'permission-denied')
    const rejected = processFix(denied, fix(0, 0, { accuracyM: 90 }))
    assert.equal(getGpsStatus(rejected.state, t(0)), 'unavailable')
    const recovered = processFix(rejected.state, fix(1))
    expectAccepted(recovered.result)
    assert.equal(recovered.state.unavailableReason, null)
    assert.equal(getGpsStatus(recovered.state, t(1)), 'good')
  })

  test('같은 사유가 반복되면 같은 객체를 돌려준다', () => {
    const denied = applyGpsError(createGpsTracker(), 'permission-denied')
    assert.equal(applyGpsError(denied, 'permission-denied'), denied)
  })
})

describe('getGpsStatus와 isGpsVerified', () => {
  test('유효하지 않은 now는 마지막 유효 좌표 시각으로 본다', () => {
    const { state } = feed([fix(0)])
    assert.equal(getGpsStatus(state, Number.NaN), 'good')
  })

  test('now가 마지막 좌표보다 이전이어도 good이다 (시계가 거꾸로 감)', () => {
    const { state } = feed([fix(10)])
    assert.equal(getGpsStatus(state, t(5)), 'good')
  })

  test('weak 같은 약함 상태는 만들지 않는다', () => {
    const { state } = feed([fix(0, 0, { accuracyM: 29 })]) // 기준에 가까운 낮은 정확도
    const seen = new Set([getGpsStatus(state, t(0)), getGpsStatus(state, t(5)), getGpsStatus(state, t(30))])
    assert.deepEqual([...seen].sort(), ['good', 'lost'])
  })

  test('검증됨은 새 추적 상태를 만들기 전까지 유지된다', () => {
    const { state } = feed([fix(0)])
    assert.equal(isGpsVerified(state), true)
    assert.equal(isGpsVerified(applyGpsError(state, 'timeout')), true)
    assert.equal(isGpsVerified(createGpsTracker()), false)
  })
})

describe('설정 상수', () => {
  test('기본 설정은 동결되어 있어 실수로 바뀌지 않는다', () => {
    assert.equal(Object.isFrozen(DEFAULT_GPS_CONFIG), true)
  })
})

describe('불변성과 불변식', () => {
  test('입력을 동결해도 오류 없이 동작하고 입력을 바꾸지 않는다', () => {
    const state = deepFreeze(feed([fix(0), fix(1, 3)]).state)
    const snapshot = JSON.stringify(state)
    const raw = deepFreeze(fix(2, 500))
    assert.doesNotThrow(() => {
      processFix(state, raw)
      applyGpsError(state, 'permission-denied')
      getGpsStatus(state, t(5))
    })
    assert.equal(JSON.stringify(state), snapshot)
  })

  test('같은 입력은 항상 같은 결과를 낸다', () => {
    const inputs = [fix(0), fix(1, 3), fix(2, 500), fix(3, 9), fix(3, 9), fix(20, 100)]
    assert.deepEqual(feed(inputs), feed(inputs))
  })

  test('무작위 600개 좌표를 넣어도 불변식이 유지된다', () => {
    const allowed = new Set<RejectReason>([
      'invalid-time', 'invalid-coordinates', 'poor-accuracy', 'stale', 'duplicate', 'out-of-order', 'jump',
    ])
    const rng = createRng(4242)
    let state = createGpsTracker()
    let clock = 0
    let meters = 0
    let lastRaw: RawFix = fix(0)

    for (let step = 0; step < 600; step += 1) {
      clock += 0.5 + rng() * 3
      const kind = rng()
      let raw: RawFix
      if (kind < 0.55) {
        meters += 2 + rng() * 4
        raw = fix(clock, meters)
      } else if (kind < 0.65) {
        raw = fix(clock, meters, { accuracyM: 31 + rng() * 100 })
      } else if (kind < 0.75) {
        raw = fix(clock, meters + 300 + rng() * 2000)
      } else if (kind < 0.82) {
        raw = lastRaw
      } else if (kind < 0.88) {
        raw = fix(clock, meters, { deviceTime: t(clock - 5 - rng() * 5) })
      } else if (kind < 0.93) {
        raw = fix(clock, meters, { deviceTime: t(clock - 30) })
      } else {
        clock += 15 + rng() * 30
        meters += rng() * 100
        raw = fix(clock, meters)
      }
      lastRaw = raw

      const previous = state
      const processed = processFix(previous, raw)
      state = processed.state
      // 후보가 횟수를 채운 채 남아 있다면 지속 시간이 모자란 경우뿐이다.
      if (state.pendingJumps.length >= DEFAULT_GPS_CONFIG.reanchorAfter) {
        const span = state.pendingJumps[state.pendingJumps.length - 1].at - state.pendingJumps[0].at
        assert.ok(span < DEFAULT_GPS_CONFIG.reanchorMinDurationMs, '횟수와 시간을 모두 채운 튐 후보가 재앵커되지 않고 남음')
      }

      if (processed.result.accepted) {
        const valid = processed.result.fix
        assert.equal(state.acceptedCount, previous.acceptedCount + 1)
        if (previous.anchor !== null) {
          assert.ok(state.anchor !== null && state.anchor.time > previous.anchor.time, '유효 좌표의 기준 시각은 계속 늘어남')
          assert.ok(valid.at >= previous.anchor.at, '세션 시간 기준 시각이 줄어듦')
        }
        if (valid.connected) {
          assert.ok(previous.anchor !== null && state.anchor !== null, '이어짐은 직전 유효 좌표가 있을 때만')
          assert.ok(valid.at - previous.anchor.at <= DEFAULT_GPS_CONFIG.connectGapMs, '간격이 벌어졌는데 이어짐')
          const allowed =
            DEFAULT_GPS_CONFIG.maxSpeedMps * ((state.anchor.time - previous.anchor.time) / 1000) +
            previous.anchor.accuracyM +
            state.anchor.accuracyM
          assert.ok(
            haversineMeters(previous.anchor.lat, previous.anchor.lng, state.anchor.lat, state.anchor.lng) <= allowed,
            '이어진 좌표쌍이 속도 한도를 넘음',
          )
        }
      } else {
        assert.ok(allowed.has(processed.result.reason))
        assert.equal(state.acceptedCount, previous.acceptedCount)
        assert.equal(state.anchor, previous.anchor, '버려진 좌표가 기준을 바꿈')
      }
    }
  })
})
