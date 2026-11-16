import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { GeolocationEnv, GeolocationLike, PositionErrorLike, PositionLike } from '../features/measurement/geolocationSource.ts'
import { getGpsStatus } from '../features/measurement/gpsTracker.ts'
import { getMetrics } from '../features/measurement/metrics.ts'
import type { MeasurementMetrics } from '../features/measurement/types.ts'
import type { VirtualClock } from '../features/measurement/virtualGeolocation.ts'
import { createMeasurementStore, parseUrlMode, parseVirtualParam } from './measurementStore.ts'
import type { StartOptions } from './measurementStore.ts'

const BASE = 1_700_000_000_000
// 적도에서 경도 1도 = 111,194.93 m (virtualRun.ts의 지구 반지름과 같은 값). 3 m/s로 달리는 좌표를 만든다.
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

function assertClose(actual: number | null, expected: number, tolerance = 0.5) {
  assert.ok(actual !== null, `값이 null이다 (기대값 ${expected})`)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual}은(는) ${expected}에서 ±${tolerance} 안에 있어야 함`,
  )
}

// 실제 시간을 기다리지 않는 수동 시계. (virtualGeolocation.test.ts의 것과 같은 동작)
class ManualClock implements VirtualClock {
  private current: number
  private nextTaskId = 1
  private queue: { id: number; at: number; callback: () => void }[] = []

  constructor(start: number) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const task = { id: this.nextTaskId, at: this.current + Math.max(0, delayMs), callback }
    this.nextTaskId += 1
    this.queue.push(task)
    return () => {
      this.queue = this.queue.filter((queued) => queued !== task)
    }
  }

  get pending(): number {
    return this.queue.length
  }

  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const due = this.queue
        .filter((task) => task.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (due === undefined) break
      this.queue = this.queue.filter((task) => task !== due)
      this.current = Math.max(this.current, due.at)
      due.callback()
    }
    this.current = target
  }

  // 시각을 t초(BASE 기준)까지 진행한다.
  advanceTo(seconds: number): void {
    this.advance(BASE + seconds * 1000 - this.current)
  }
}

// 직접 좌표와 오류를 넣을 수 있는 가짜 브라우저 위치. (실제 GPS 경로 테스트용)
function createFakeGeolocation(clock: ManualClock) {
  const watches = new Map<
    number,
    { onSuccess: (position: PositionLike) => void; onError: (error: PositionErrorLike) => void }
  >()
  let nextId = 1
  let watchCalls = 0
  const geolocation: GeolocationLike = {
    watchPosition(onSuccess, onError) {
      const id = nextId
      nextId += 1
      watchCalls += 1
      watches.set(id, { onSuccess, onError })
      return id
    },
    clearWatch(id) {
      watches.delete(id)
    },
  }
  return {
    geolocation,
    get activeWatches() {
      return watches.size
    },
    get watchCalls() {
      return watchCalls
    },
    // 경도 lng(도)의 좌표를 지금 시각으로 전달한다.
    emit(lng: number, accuracy = 5) {
      for (const watch of [...watches.values()]) {
        watch.onSuccess({ coords: { latitude: 0, longitude: lng, accuracy }, timestamp: clock.now() })
      }
    },
    // t초 시점에 3 m/s로 달려 온 위치를 전달한다.
    emitRunnerAt(seconds: number) {
      clock.advanceTo(seconds)
      this.emit((seconds * 3) / METERS_PER_DEGREE)
    },
    fail(code: number) {
      for (const watch of [...watches.values()]) {
        watch.onError({ code })
      }
    },
  }
}

// clearWatch 뒤에도 콜백을 계속 보관하는 가짜 위치. 실제 브라우저에서 해제 직전에 이미 예약된 콜백이
// 해제 뒤에 도착하는 상황(늦은 콜백)을 만든다. (createFakeGeolocation은 해제하면 콜백도 버린다.)
function createLeakyGeolocation(clock: ManualClock) {
  const callbacks: {
    onSuccess: (position: PositionLike) => void
    onError: (error: PositionErrorLike) => void
  }[] = []
  const geolocation: GeolocationLike = {
    watchPosition(onSuccess, onError) {
      callbacks.push({ onSuccess, onError })
      return callbacks.length
    },
    clearWatch() {},
  }
  return {
    geolocation,
    get watchCalls() {
      return callbacks.length
    },
    // watchIndex번째(0부터) 감시의 콜백을 해제 여부와 상관없이 직접 부른다.
    emitTo(watchIndex: number, lng: number) {
      callbacks[watchIndex].onSuccess({
        coords: { latitude: 0, longitude: lng, accuracy: 5 },
        timestamp: clock.now(),
      })
    },
    failTo(watchIndex: number, code: number) {
      callbacks[watchIndex].onError({ code })
    },
  }
}

function setup(env?: () => GeolocationEnv) {
  const clock = new ManualClock(BASE)
  const store = createMeasurementStore({ clock, realEnv: env })
  return { clock, store }
}

function setupReal() {
  const clock = new ManualClock(BASE)
  const geo = createFakeGeolocation(clock)
  const store = createMeasurementStore({
    clock,
    realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
  })
  return { clock, geo, store }
}

function metricsOf(store: ReturnType<typeof createMeasurementStore>): MeasurementMetrics {
  const { session, metrics, now } = store.getState()
  if (session === null) throw new Error('세션이 없다')
  return getMetrics(metrics, session, now)
}

const virtual = (id: NonNullable<StartOptions['virtual']>): StartOptions => ({ virtual: id })

describe('초기 상태', () => {
  test('측정한 적이 없으면 세션과 출처가 없고 예약도 없다', () => {
    const { clock, store } = setup()
    const state = store.getState()
    assert.equal(state.session, null)
    assert.equal(state.runSource, null)
    assert.equal(state.metrics.distanceM, 0)
    assert.equal(clock.pending, 0)
  })
})

describe('가상 GPS 측정: 시작부터 완료까지', () => {
  test('steady: 완료되면 같은 종료 상태(auto)가 되고 540 m이다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    assert.equal(store.getState().session?.status, 'running')
    assert.deepEqual(store.getState().runSource, { kind: 'virtual', scenarioId: 'steady' })

    clock.advance(179_999)
    assert.equal(store.getState().session?.status, 'running')

    clock.advance(1)
    const session = store.getState().session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'auto')
    assert.equal(session?.endedAt, BASE + 180_000)
    const metrics = metricsOf(store)
    assertClose(metrics.distanceM, 540)
    assert.equal(metrics.elapsedMs, 180_000)
    assert.equal(metrics.currentPaceSecPerKm, null) // 종료 후에는 현재 값이 없다
    // 타이머와 가상 감시가 모두 정리됐다.
    assert.equal(clock.pending, 0)
  })

  test('가상 완료는 GPS 오류가 아니다: 상태가 unavailable이 되지 않는다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    assert.equal(store.getState().tracker.unavailableReason, null)
    assert.equal(getGpsStatus(store.getState().tracker, store.getState().now), 'good')
  })

  test('종료 후에는 시간이 지나도 값이 바뀌지 않는다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    const before = store.getState()
    clock.advance(600_000)
    assert.equal(store.getState(), before)
  })

  test('프리셋 4종은 엔진 단독 테스트와 같은 숫자가 나온다', () => {
    const expected = [
      { id: 'steady', ms: 180_000, distance: 540 },
      { id: 'stop-and-go', ms: 180_000, distance: 470 },
      { id: 'gps-lost', ms: 150_000, distance: 387 },
      { id: 'gps-glitch', ms: 120_000, distance: 336 },
    ] as const
    for (const { id, ms, distance } of expected) {
      const { clock, store } = setup()
      store.getState().start(virtual(id))
      clock.advance(ms)
      assert.equal(store.getState().session?.endReason, 'auto', id)
      assertClose(metricsOf(store).distanceM, distance, 1)
      assert.equal(clock.pending, 0, id)
    }
  })

  test('gps-lost: 끊긴 동안 GPS 상태가 lost이고 현재 페이스가 null이다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('gps-lost'))
    clock.advance(85_000) // 70~90초 구간이 끊김. 마지막 유효 좌표는 69초
    const state = store.getState()
    assert.equal(getGpsStatus(state.tracker, state.now), 'lost')
    assert.equal(metricsOf(store).currentPaceSecPerKm, null)
    clock.advance(10_000) // 95초: 복구
    assert.equal(getGpsStatus(store.getState().tracker, store.getState().now), 'good')
  })

  test('틱 타이머가 now를 갱신한다 (좌표가 없는 동안에도 경과 시간이 흐른다)', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('gps-lost'))
    clock.advance(75_000)
    assert.equal(store.getState().now, BASE + 75_000)
  })
})

describe('시작·종료 규칙', () => {
  test('활성 세션이 있을 때 다시 시작해도 세션과 공급원은 하나이다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    const first = store.getState().session
    clock.advance(5000)
    store.getState().start()
    store.getState().start(virtual('steady')) // 다른 출처를 요청해도 무시된다
    assert.equal(store.getState().session, first)
    assert.deepEqual(store.getState().runSource, { kind: 'real' })
    assert.equal(geo.watchCalls, 1)
    assert.equal(geo.activeWatches, 1)
  })

  test('사용자 종료: user로 끝나고 감시와 타이머가 정리된다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    geo.emitRunnerAt(1)
    clock.advanceTo(2)
    store.getState().stop()
    const session = store.getState().session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'user')
    assert.equal(geo.activeWatches, 0)
    assert.equal(clock.pending, 0)
  })

  test('종료 뒤에는 감시가 해제되어 좌표가 전달되지 않는다 (늦은 콜백은 아래 별도 테스트)', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    geo.emitRunnerAt(1)
    store.getState().stop()
    const before = store.getState()
    geo.emit(100 / METERS_PER_DEGREE)
    clock.advance(10_000)
    assert.equal(store.getState(), before)
  })

  test('stop은 세션이 없거나 이미 종료됐으면 아무 것도 하지 않는다', () => {
    const { clock, store } = setup()
    store.getState().stop()
    assert.equal(store.getState().session, null)
    store.getState().start(virtual('steady'))
    clock.advance(10_000)
    store.getState().stop()
    const ended = store.getState().session
    clock.advance(5000)
    store.getState().stop()
    assert.equal(store.getState().session, ended)
  })

  test('종료 후 다시 시작하면 새 세션이고 이전 측정값은 초기화된다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    const firstId = store.getState().session?.id
    assert.ok(metricsOf(store).distanceM > 500)

    store.getState().start(virtual('steady'))
    assert.notEqual(store.getState().session?.id, firstId)
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(store.getState().metrics.distanceM, 0)
    assert.equal(store.getState().tracker.acceptedCount, 0)
  })

  test('이전 측정의 늦은 완료가 새 측정을 끝내지 않는다 (시나리오는 매번 처음부터)', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(60_000)
    store.getState().stop()
    store.getState().start(virtual('steady'))
    clock.advance(179_000) // 첫 측정이었다면 이미 끝났을 시각(총 239초 시점)
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(1000)
    assert.equal(store.getState().session?.status, 'finished')
    assertClose(metricsOf(store).distanceM, 540)
  })
})

describe('이전 측정의 늦은 콜백 (실제 브라우저가 해제 뒤에 콜백을 보내는 경우)', () => {
  function setupLeaky() {
    const clock = new ManualClock(BASE)
    const geo = createLeakyGeolocation(clock)
    const store = createMeasurementStore({
      clock,
      realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
    })
    return { clock, geo, store }
  }

  test('종료 뒤 늦게 도착한 좌표와 오류는 Store를 바꾸지 않는다', () => {
    const { clock, geo, store } = setupLeaky()
    store.getState().start()
    geo.emitTo(0, 0)
    clock.advanceTo(1)
    store.getState().stop()
    const before = store.getState()
    geo.emitTo(0, 100 / METERS_PER_DEGREE)
    geo.failTo(0, 1)
    geo.failTo(0, 2)
    clock.advance(10_000)
    assert.equal(store.getState(), before)
  })

  test('종료 후 다시 시작해도 이전 감시의 늦은 좌표와 오류는 새 측정에 영향을 주지 않는다', () => {
    const { clock, geo, store } = setupLeaky()
    store.getState().start()
    geo.emitTo(0, 0)
    clock.advanceTo(2)
    store.getState().stop()
    store.getState().start()
    const second = store.getState().session
    assert.equal(geo.watchCalls, 2)

    // 첫 번째 감시의 늦은 콜백: 좌표, 권한 거부, 위치 확인 불가
    geo.emitTo(0, 50 / METERS_PER_DEGREE)
    geo.failTo(0, 1)
    geo.failTo(0, 2)
    const state = store.getState()
    assert.equal(state.session, second)
    assert.equal(state.session?.status, 'running')
    assert.equal(state.tracker.acceptedCount, 0)
    assert.equal(state.tracker.unavailableReason, null)
    assert.equal(state.metrics.distanceM, 0)

    // 두 번째 감시는 정상 동작한다.
    geo.emitTo(1, 0)
    assert.equal(store.getState().tracker.acceptedCount, 1)
  })
})

describe('사용자 종료와 가상 완료의 중복', () => {
  test('가상 완료 직전에 사용자가 종료하면 user로 남고, 이후 완료는 아무 영향도 없다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(179_999)
    store.getState().stop()
    const ended = store.getState().session
    assert.equal(ended?.endReason, 'user')
    clock.advance(10_000)
    assert.equal(store.getState().session, ended)
    assert.equal(clock.pending, 0)
  })

  test('가상 완료 뒤 사용자가 종료를 눌러도 auto로 남고 종료 시각은 그대로이다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    const ended = store.getState().session
    store.getState().stop()
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session, ended)
    assert.equal(ended?.endReason, 'auto')
  })

  test('종료 후 재시작해도 틱 타이머와 가상 감시가 겹쳐 쌓이지 않는다 (예약은 틱 1개 + 감시 1개)', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    assert.equal(clock.pending, 2)
    clock.advance(5000)
    store.getState().stop()
    assert.equal(clock.pending, 0)
    store.getState().start(virtual('steady'))
    assert.equal(clock.pending, 2)
    store.getState().stop()
    store.getState().start(virtual('steady'))
    assert.equal(clock.pending, 2)
  })
})

describe('실제 GPS 측정 (같은 엔진 경로)', () => {
  test('좌표가 검증과 지표 계산을 거쳐 Store에 반영된다', () => {
    const { geo, store } = setupReal()
    store.getState().start()
    assert.deepEqual(store.getState().runSource, { kind: 'real' })
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    assert.equal(store.getState().tracker.acceptedCount, 11)
    const metrics = metricsOf(store)
    assertClose(metrics.distanceM, 30)
    assertClose(metrics.currentSpeedMps, 3, 0.05)
  })

  test('좌표를 받으면 틱을 기다리지 않고 now가 그 수신 시각으로 갱신된다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    clock.advance(300) // 첫 틱(500ms) 전
    assert.equal(store.getState().now, BASE)
    geo.emit(0)
    assert.equal(store.getState().now, BASE + 300)
  })

  test('검증에서 거부된 좌표(정확도 나쁨)는 지표에 들어가지 않는다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    clock.advanceTo(1)
    geo.emit(3 / METERS_PER_DEGREE, 500)
    assert.equal(store.getState().tracker.acceptedCount, 1)
    assert.equal(store.getState().metrics.distanceM, 0)
  })

  test('실제 GPS 측정은 시간이 얼마나 지나도 자동 종료되지 않는다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    clock.advance(3_600_000)
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(getGpsStatus(store.getState().tracker, store.getState().now), 'lost')
  })
})

describe('GPS 오류와 권한 거부', () => {
  test('권한 거부: 상태는 unavailable, 세션은 계속, 감시는 정리되고 사용자가 종료할 수 있다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.fail(1)
    const state = store.getState()
    assert.equal(state.tracker.unavailableReason, 'permission-denied')
    assert.equal(getGpsStatus(state.tracker, state.now), 'unavailable')
    assert.equal(state.session?.status, 'running')
    assert.equal(geo.activeWatches, 0)
    clock.advance(5000)
    assert.equal(metricsOf(store).elapsedMs, 5000) // 시간만 측정된다
    assert.equal(metricsOf(store).distanceM, 0)
    store.getState().stop()
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(clock.pending, 0)
  })

  test('권한 거부 뒤에도 다시 시작할 수 있다 (종료 후)', () => {
    const { geo, store } = setupReal()
    store.getState().start()
    geo.fail(1)
    store.getState().stop()
    store.getState().start()
    assert.equal(geo.watchCalls, 2)
    assert.equal(store.getState().tracker.unavailableReason, null)
    assert.equal(geo.activeWatches, 1)
  })

  test('비보안 컨텍스트: start() 안에서 동기로 알리고, 세션은 시간만 측정한다', () => {
    const { clock, store } = setup(() => ({ isSecureContext: false, geolocation: null }))
    store.getState().start()
    assert.equal(store.getState().tracker.unavailableReason, 'insecure-context')
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(3000)
    assert.equal(metricsOf(store).elapsedMs, 3000)
    store.getState().stop()
    assert.equal(clock.pending, 0)
  })

  test('geolocation 미지원', () => {
    const { store } = setup(() => ({ isSecureContext: true, geolocation: null }))
    store.getState().start()
    assert.equal(store.getState().tracker.unavailableReason, 'unsupported')
    assert.equal(store.getState().session?.status, 'running')
  })

  test('일시적 오류(timeout, position-unavailable)는 상태를 바꾸지 않고 감시도 유지한다', () => {
    const { geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    const before = store.getState().tracker
    geo.fail(3)
    geo.fail(2)
    assert.equal(store.getState().tracker, before)
    assert.equal(geo.activeWatches, 1)
    assert.equal(store.getState().session?.status, 'running')
  })

  test('오류 뒤 유효 좌표가 다시 오면 사용 불가가 풀린다', () => {
    const { geo, store } = setupReal()
    store.getState().start()
    geo.fail(1) // 감시가 정리됐으므로 이후 좌표는 오지 않는다 → 풀리지 않는다
    geo.emitRunnerAt(1)
    assert.equal(store.getState().tracker.unavailableReason, 'permission-denied')
  })

  test('가상 측정의 일반 오류(위치 확인 불가)는 가상 완료와 섞이지 않는다', () => {
    // 가상 완료는 endReason 'auto'로만 나타나고, 실제 GPS 오류 처리는 세션을 끝내지 않는다.
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.fail(2)
    clock.advance(60_000)
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(store.getState().session?.endReason, null)
  })
})

describe('일시정지와 재개 (거리 회귀)', () => {
  test('일시정지 중에도 좌표가 계속 오면: 일시정지 구간과 가로지르는 쌍은 거리에 들어가지 않는다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(10.5)
    store.getState().pause()
    for (let sec = 11; sec <= 20; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(20.5)
    store.getState().resume()
    for (let sec = 21; sec <= 30; sec += 1) geo.emitRunnerAt(sec)
    store.getState().stop()

    const metrics = metricsOf(store)
    // 일시정지 전 0~10초(30 m) + 재개 후 21→30초(27 m). 10→21초 사이 33 m는 들어가지 않는다.
    assertClose(metrics.distanceM, 57)
    assert.equal(metrics.elapsedMs, 30_000 - 10_000)
    assert.equal(metrics.validMs, 19_000)
  })

  test('일시정지 중에 좌표가 없었다면(10초 이내): 가로지르는 쌍을 버린다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(10.5)
    store.getState().pause()
    clock.advanceTo(14.5)
    store.getState().resume()
    for (let sec = 15; sec <= 20; sec += 1) geo.emitRunnerAt(sec)
    // gpsTracker는 15초 좌표를 10초 좌표와 이어진 것(connected)으로 보지만, metrics가 일시정지를 보고 새 구간으로 시작한다.
    assert.equal(store.getState().tracker.acceptedCount, 17)
    assertClose(metricsOf(store).distanceM, 30 + 15) // 가로지르는 10→15초의 15 m는 제외
  })

  test('좌표 사이의 아주 짧은 일시정지(1초 미만)도 가로지르는 쌍을 버린다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 5; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(5.2)
    store.getState().pause()
    clock.advanceTo(5.8)
    store.getState().resume()
    for (let sec = 6; sec <= 8; sec += 1) geo.emitRunnerAt(sec)
    assertClose(metricsOf(store).distanceM, 15 + 6) // 5→6초 쌍은 제외
  })

  test('10초를 넘는 일시정지: tracker가 새 구간으로 표시하고 거리도 이어지지 않는다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 5; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(5.5)
    store.getState().pause()
    clock.advanceTo(25.5)
    store.getState().resume()
    for (let sec = 26; sec <= 28; sec += 1) geo.emitRunnerAt(sec)
    assertClose(metricsOf(store).distanceM, 15 + 6)
  })

  test('일시정지를 여러 번 해도 가로지르는 쌍은 모두 제외된다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 3; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(3.5)
    store.getState().pause()
    clock.advanceTo(5.5)
    store.getState().resume()
    for (let sec = 6; sec <= 8; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(8.5)
    store.getState().pause()
    clock.advanceTo(10.5)
    store.getState().resume()
    for (let sec = 11; sec <= 13; sec += 1) geo.emitRunnerAt(sec)
    // 0~3초(9 m) + 6~8초(6 m) + 11~13초(6 m)
    assertClose(metricsOf(store).distanceM, 9 + 6 + 6)
  })

  test('가상 GPS도 같다: 일시정지 중 시나리오는 계속 흐르지만 그 구간은 거리에 들어가지 않는다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(30_000)
    store.getState().pause()
    clock.advance(20_000)
    store.getState().resume()
    clock.advance(20_000)
    store.getState().stop()
    // 0~30초(90 m) + 재개 후 51→70초(19쌍 × 3 m = 57 m)
    assertClose(metricsOf(store).distanceM, 90 + 57)
    assert.equal(metricsOf(store).elapsedMs, 70_000 - 20_000)
  })

  test('일시정지 중에는 현재 페이스가 없고, 재개 직후에도 새 좌표가 쌓이기 전까지 없다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    assert.notEqual(metricsOf(store).currentPaceSecPerKm, null)
    clock.advanceTo(10.5)
    store.getState().pause()
    assert.equal(metricsOf(store).currentPaceSecPerKm, null)
    clock.advanceTo(12.5)
    store.getState().resume()
    assert.equal(metricsOf(store).currentPaceSecPerKm, null)
  })

  test('일시정지 중에 종료하면 경과 시간은 일시정지 시점 값이다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    clock.advanceTo(10.5)
    store.getState().pause()
    clock.advanceTo(20)
    store.getState().stop()
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(metricsOf(store).elapsedMs, 10_500)
    assert.equal(geo.activeWatches, 0)
  })

  test('잘못된 호출은 무시한다: 진행 중이 아닐 때 resume, 이미 일시정지일 때 pause, 세션 없이 호출', () => {
    const { clock, store } = setup()
    store.getState().pause()
    store.getState().resume()
    assert.equal(store.getState().session, null)

    store.getState().start(virtual('steady'))
    clock.advance(1000)
    const running = store.getState().session
    store.getState().resume()
    assert.equal(store.getState().session, running)
    store.getState().pause()
    const paused = store.getState().session
    assert.equal(paused?.status, 'paused')
    store.getState().pause()
    assert.equal(store.getState().session, paused)
  })

  test('종료 후의 pause와 resume은 무시한다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    const ended = store.getState().session
    store.getState().pause()
    store.getState().resume()
    assert.equal(store.getState().session, ended)
  })
})

describe('화면 이탈 정리', () => {
  test('이탈을 예약하면 이벤트 루프가 지난 뒤 활성 세션을 user로 종료한다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    store.getState().scheduleLeaveStop()
    assert.equal(store.getState().session?.status, 'running') // 아직은 종료하지 않는다
    clock.advance(0)
    assert.equal(store.getState().session?.status, 'finished')
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(geo.activeWatches, 0)
    assert.equal(clock.pending, 0)
  })

  test('StrictMode 모사: 언마운트 직후 같은 틱에 다시 마운트하면 세션이 유지된다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    // effect 실행 → cleanup → effect 다시 실행 (개발 환경의 이중 실행)
    store.getState().cancelLeaveStop()
    store.getState().scheduleLeaveStop()
    store.getState().cancelLeaveStop()
    clock.advance(10_000)
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(geo.activeWatches, 1)
  })

  test('이미 종료됐다면 이탈 정리는 아무 것도 하지 않는다 (그만하기 또는 가상 완료 뒤 이동)', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    const ended = store.getState().session
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session, ended)
    assert.equal(store.getState().session?.endReason, 'auto')
  })

  test('이탈 예약을 여러 번 해도 하나만 남고, 세션이 없으면 아무 일도 없다', () => {
    const { clock, store } = setup()
    store.getState().scheduleLeaveStop()
    store.getState().scheduleLeaveStop()
    assert.equal(clock.pending, 1)
    clock.advance(0)
    assert.equal(store.getState().session, null)
    assert.equal(clock.pending, 0)
  })

  test('측정을 새로 시작하면 이전 이탈 예약은 취소된다', () => {
    const { clock, store } = setup()
    store.getState().scheduleLeaveStop()
    store.getState().start(virtual('steady'))
    clock.advance(0)
    assert.equal(store.getState().session?.status, 'running')
  })
})

describe('?virtual 주소 값 읽기', () => {
  test('값이 없으면 null, 값 없이 ?virtual이면 steady', () => {
    assert.equal(parseVirtualParam(''), null)
    assert.equal(parseVirtualParam('?scenario=normal'), null)
    assert.equal(parseVirtualParam('?virtual'), 'steady')
    assert.equal(parseVirtualParam('?virtual='), 'steady')
  })

  test('프리셋 이름이면 그 시나리오, 모르는 값이면 null(실제 GPS)', () => {
    assert.equal(parseVirtualParam('?virtual=stop-and-go'), 'stop-and-go')
    assert.equal(parseVirtualParam('?virtual=gps-lost'), 'gps-lost')
    assert.equal(parseVirtualParam('?a=1&virtual=gps-glitch'), 'gps-glitch')
    assert.equal(parseVirtualParam('?virtual=nope'), null)
    assert.equal(parseVirtualParam('?virtual=toString'), null)
    assert.equal(parseVirtualParam('?virtual=__proto__'), null)
  })
})

describe('주소 모드 (parseUrlMode)', () => {
  test('쿼리가 없으면 가상도 Mock도 아니다 (개발·배포 모두)', () => {
    assert.deepEqual(parseUrlMode('', true), { virtual: null, mock: false })
    assert.deepEqual(parseUrlMode('', false), { virtual: null, mock: false })
    assert.deepEqual(parseUrlMode('?other=1', true), { virtual: null, mock: false })
  })

  test('?virtual은 기본 시나리오(steady)로 가상 모드가 켜진다', () => {
    assert.deepEqual(parseUrlMode('?virtual', true), { virtual: 'steady', mock: false })
  })

  test('?virtual=steady 등 프리셋 이름은 그 시나리오이다', () => {
    assert.deepEqual(parseUrlMode('?virtual=steady', true), { virtual: 'steady', mock: false })
    assert.deepEqual(parseUrlMode('?virtual=gps-lost', true), { virtual: 'gps-lost', mock: false })
  })

  test('알 수 없는 virtual 값이면 가상 모드가 꺼진다 (실제 GPS)', () => {
    assert.deepEqual(parseUrlMode('?virtual=nope', true), { virtual: null, mock: false })
    assert.deepEqual(parseUrlMode('?virtual=__proto__', false), { virtual: null, mock: false })
  })

  test('가상 모드는 배포 환경(isDev=false)에서도 켜진다', () => {
    assert.deepEqual(parseUrlMode('?virtual=steady', false), { virtual: 'steady', mock: false })
  })

  test('?scenario=는 개발 환경에서 기존 Mock 모드를 켠다', () => {
    assert.deepEqual(parseUrlMode('?scenario=gps-lost', true), { virtual: null, mock: true })
    assert.deepEqual(parseUrlMode('?scenario=normal', true), { virtual: null, mock: true })
  })

  test('isDev=false이면 ?scenario=가 있어도 Mock 모드가 꺼진다', () => {
    assert.deepEqual(parseUrlMode('?scenario=gps-lost', false), { virtual: null, mock: false })
  })

  test('?virtual과 ?scenario=가 함께 있으면 virtual이 우선하고 Mock은 꺼진다', () => {
    assert.deepEqual(parseUrlMode('?scenario=normal&virtual=steady', true), { virtual: 'steady', mock: false })
    assert.deepEqual(parseUrlMode('?virtual&scenario=empty', true), { virtual: 'steady', mock: false })
  })

  test('알 수 없는 virtual 값과 ?scenario=가 함께 있으면 기존 Mock 모드가 유지된다', () => {
    assert.deepEqual(parseUrlMode('?virtual=nope&scenario=normal', true), { virtual: null, mock: true })
  })
})
