import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { GeolocationEnv, GeolocationLike, PositionErrorLike, PositionLike } from '../features/measurement/geolocationSource.ts'
import { getGpsStatus } from '../features/measurement/gpsTracker.ts'
import { getMetrics } from '../features/measurement/metrics.ts'
import type { MeasurementMetrics } from '../features/measurement/types.ts'
import type { VirtualClock } from '../features/measurement/virtualGeolocation.ts'
import { STORAGE_KEY } from '../features/measurement/sessionPersistence.ts'
import type { StorageLike } from '../features/measurement/sessionPersistence.ts'
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
  const store = createMeasurementStore({ allowVirtual: true, clock, realEnv: env })
  return { clock, store }
}

function setupReal() {
  const clock = new ManualClock(BASE)
  const geo = createFakeGeolocation(clock)
  const store = createMeasurementStore({
    allowVirtual: true,
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
      allowVirtual: true,
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

})

describe('실제 GPS 측정의 10분 자동 종료', () => {
  const TARGET = 600_000

  test('목표 시간은 실제 측정만 600초이고 가상 측정과 측정 전은 null이다', () => {
    const { store } = setup()
    assert.equal(store.getState().targetDurationMs, null)
    store.getState().start(virtual('steady'))
    assert.equal(store.getState().targetDurationMs, null)
    const real = setupReal()
    real.store.getState().start()
    assert.equal(real.store.getState().targetDurationMs, TARGET)
  })

  test('600초에 auto로 종료되고 경과 시간은 정확히 600초이며 감시와 타이머가 정리된다', () => {
    const { clock, geo, store } = setupReal()
    store.getState().start()
    geo.emitRunnerAt(0)
    clock.advanceTo(599)
    assert.equal(store.getState().session?.status, 'running')
    clock.advanceTo(600)
    const session = store.getState().session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'auto')
    assert.equal(session?.endedAt, BASE + TARGET)
    assert.equal(metricsOf(store).elapsedMs, TARGET)
    assert.equal(geo.activeWatches, 0)
    assert.equal(clock.pending, 0)
  })

  test('종료 후에는 시간이 지나도 결과가 바뀌지 않는다', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    clock.advance(TARGET)
    const ended = store.getState().session
    clock.advance(3_600_000)
    assert.equal(store.getState().session, ended)
    assert.equal(metricsOf(store).elapsedMs, TARGET)
  })

  test('일시정지한 시간은 세지 않는다 (5분, 3분 정지, 5분 뒤 종료)', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    clock.advance(300_000)
    store.getState().pause()
    assert.equal(clock.pending, 1) // 틱 1개만 남는다 (목표 타이머는 취소됨)
    clock.advance(180_000)
    assert.equal(store.getState().session?.status, 'paused')
    store.getState().resume()
    clock.advance(299_999)
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(1)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(metricsOf(store).elapsedMs, TARGET)
    assert.equal(store.getState().session?.endedAt, BASE + 780_000)
  })

  test('여러 번 일시정지해도 남은 시간으로 다시 예약한다', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    for (let i = 0; i < 4; i += 1) {
      clock.advance(100_000)
      store.getState().pause()
      clock.advance(50_000)
      store.getState().resume()
    }
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(199_999)
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(1)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(metricsOf(store).elapsedMs, TARGET)
  })

  test('일시정지 중에 사용자가 종료하면 user로 남고 타이머가 남지 않는다', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    clock.advance(10_000)
    store.getState().pause()
    store.getState().stop()
    assert.equal(store.getState().session?.endReason, 'user')
    clock.advance(TARGET * 2)
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(clock.pending, 0)
  })

  test('사용자 종료와 화면 이탈 종료 뒤에는 목표 타이머가 남지 않는다', () => {
    const a = setupReal()
    a.store.getState().start()
    a.clock.advance(1000)
    a.store.getState().stop()
    assert.equal(a.clock.pending, 0)

    const b = setupReal()
    b.store.getState().start()
    b.store.getState().scheduleLeaveStop()
    b.clock.advance(0)
    assert.equal(b.store.getState().session?.endReason, 'user')
    assert.equal(b.clock.pending, 0)
  })

  test('종료 후 새 측정을 시작하면 목표 시간을 처음부터 다시 센다 (타이머가 겹치지 않는다)', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    clock.advance(100_000)
    store.getState().stop()
    store.getState().start()
    clock.advance(TARGET - 1)
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(1)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(clock.pending, 0)
  })

  test('중복 start는 목표 타이머를 다시 걸지 않는다', () => {
    const { clock, store } = setupReal()
    store.getState().start()
    clock.advance(200_000)
    store.getState().start()
    clock.advance(TARGET - 200_000)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(metricsOf(store).elapsedMs, TARGET)
  })

  test('위치를 쓸 수 없는 환경(시간만 측정)에서도 10분에 자동 종료된다', () => {
    const { clock, store } = setup(() => ({ isSecureContext: false, geolocation: null }))
    store.getState().start()
    clock.advance(TARGET)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(clock.pending, 0)
  })

  test('타이머가 늦게 불려도 종료 시각은 목표 시각이다 (경과 시간이 600초를 넘지 않는다)', () => {
    // 백그라운드 탭처럼 1초 이상의 타이머가 5초 늦게 불리는 시계
    class LateClock extends ManualClock {
      override schedule(callback: () => void, delayMs: number): () => void {
        return super.schedule(callback, delayMs >= 1000 ? delayMs + 5000 : delayMs)
      }
    }
    const clock = new LateClock(BASE)
    const store = createMeasurementStore({
      allowVirtual: true,
      clock,
      realEnv: () => ({ isSecureContext: true, geolocation: createFakeGeolocation(clock).geolocation }),
    })
    store.getState().start()
    clock.advance(TARGET + 5000)
    const session = store.getState().session
    assert.equal(session?.endReason, 'auto')
    assert.equal(session?.endedAt, BASE + TARGET)
    assert.equal(metricsOf(store).elapsedMs, TARGET)
  })

  test('가상 측정은 10분 타이머 없이 시나리오 완료로만 끝난다', () => {
    const { clock, store } = setup()
    store.getState().start(virtual('steady'))
    assert.equal(clock.pending, 2) // 틱 1개 + 가상 감시 1개 (목표 타이머 없음)
    clock.advance(180_000)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(store.getState().session?.endedAt, BASE + 180_000)
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

  test('가상 모드는 배포 환경(isDev=false)에서는 ?virtual이 있어도 켜지지 않는다 (실제 GPS)', () => {
    assert.deepEqual(parseUrlMode('?virtual=steady', false), { virtual: null, mock: false })
    assert.deepEqual(parseUrlMode('?virtual', false), { virtual: null, mock: false })
    assert.deepEqual(parseUrlMode('?virtual=gps-lost&scenario=normal', false), { virtual: null, mock: false })
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

// 호출 기록이 남는 가짜 storage. failSet이 true이면 setItem이 예외를 던진다.
function createFakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const calls: string[] = []
  const state = { failSet: false, failAll: false }
  const storage: StorageLike = {
    getItem(key) {
      calls.push('get')
      if (state.failAll) throw new Error('blocked')
      return data.get(key) ?? null
    },
    setItem(key, value) {
      calls.push('set')
      if (state.failSet || state.failAll) throw new DOMException('quota', 'QuotaExceededError')
      data.set(key, value)
    },
    removeItem(key) {
      calls.push('remove')
      if (state.failAll) throw new Error('blocked')
      data.delete(key)
    },
  }
  return { storage, data, calls, state }
}

function setupStored(initial: Record<string, string> = {}) {
  const clock = new ManualClock(BASE)
  const geo = createFakeGeolocation(clock)
  const fake = createFakeStorage(initial)
  const store = createMeasurementStore({
    allowVirtual: true,
    clock,
    realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
    storage: fake.storage,
  })
  return { clock, geo, store, ...fake }
}

function savedOf(data: Map<string, string>) {
  const raw = data.get(STORAGE_KEY)
  return raw === undefined ? null : JSON.parse(raw)
}

describe('실제 측정 저장', () => {
  test('시작하면 {version, savedAt, session, metrics}를 키 pacebeat:measurement:v1에 저장한다 (tracker 없음)', () => {
    const { store, data } = setupStored()
    store.getState().start()
    const saved = savedOf(data)
    assert.deepEqual(Object.keys(saved).sort(), ['metrics', 'savedAt', 'session', 'version'])
    assert.equal(saved.version, 1)
    assert.equal(saved.savedAt, BASE)
    assert.deepEqual(saved.session, store.getState().session)
    assert.deepEqual(saved.metrics, store.getState().metrics)
    assert.deepEqual([...data.keys()], ['pacebeat:measurement:v1'])
  })

  test('일시정지, 재개, 종료 때 저장한다', () => {
    const { clock, store, data } = setupStored()
    store.getState().start()
    clock.advance(2000)
    store.getState().pause()
    assert.equal(savedOf(data).session.status, 'paused')
    assert.equal(savedOf(data).savedAt, BASE + 2000)
    clock.advance(1000)
    store.getState().resume()
    assert.equal(savedOf(data).session.status, 'running')
    clock.advance(1000)
    store.getState().stop()
    assert.equal(savedOf(data).session.status, 'finished')
    assert.equal(savedOf(data).session.endReason, 'user')
  })

  test('사용자 종료 후 Result 데이터(session과 지표)가 저장되어 있다', () => {
    const { clock, geo, store, data } = setupStored()
    store.getState().start()
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(10)
    store.getState().stop()
    const saved = savedOf(data)
    assert.deepEqual(saved.session, store.getState().session)
    assert.deepEqual(saved.metrics, store.getState().metrics)
    assertClose(saved.metrics.distanceM, 30, 0.1)
  })

  test('10분 자동 종료와 화면 이탈 종료도 저장한다', () => {
    const a = setupStored()
    a.store.getState().start()
    a.clock.advance(600_000)
    assert.equal(savedOf(a.data).session.endReason, 'auto')

    const b = setupStored()
    b.store.getState().start()
    b.store.getState().scheduleLeaveStop()
    b.clock.advance(0)
    assert.equal(savedOf(b.data).session.endReason, 'user')
  })

  test('측정 중에는 약 5초마다 저장하고, 그 사이에는 저장하지 않는다', () => {
    const { clock, geo, store, data, calls } = setupStored()
    store.getState().start()
    assert.equal(calls.filter((c) => c === 'set').length, 1)
    for (let sec = 0; sec <= 4; sec += 1) geo.emitRunnerAt(sec)
    clock.advanceTo(4.9)
    assert.equal(calls.filter((c) => c === 'set').length, 1) // 5초 전에는 그대로
    clock.advanceTo(5)
    assert.equal(calls.filter((c) => c === 'set').length, 2)
    assert.equal(savedOf(data).savedAt, BASE + 5000)
    assert.ok(savedOf(data).metrics.distanceM > 0) // 그 사이 쌓인 지표가 들어 있다
    clock.advanceTo(9.9)
    assert.equal(calls.filter((c) => c === 'set').length, 2)
    clock.advanceTo(10)
    assert.equal(calls.filter((c) => c === 'set').length, 3)
    assert.equal(savedOf(data).savedAt, BASE + 10_000)
  })

  test('종료 후에는 주기 저장이 멈춘다', () => {
    const { clock, store, calls } = setupStored()
    store.getState().start()
    clock.advance(1000)
    store.getState().stop()
    const count = calls.filter((c) => c === 'set').length
    clock.advance(60_000)
    assert.equal(calls.filter((c) => c === 'set').length, count)
  })

  test('saveNow(pagehide)는 지금 상태를 바로 저장한다', () => {
    const { clock, geo, store, data, calls } = setupStored()
    store.getState().start()
    geo.emitRunnerAt(0)
    geo.emitRunnerAt(1)
    clock.advanceTo(1.2)
    const before = calls.filter((c) => c === 'set').length
    store.getState().saveNow()
    assert.equal(calls.filter((c) => c === 'set').length, before + 1)
    assert.equal(savedOf(data).savedAt, clock.now())
    assert.deepEqual(savedOf(data).metrics, store.getState().metrics)
  })

  test('saveNow는 측정 전과 종료 후에는 저장하지 않는다 (종료 후 저장 시각을 늘리지 않는다)', () => {
    const { clock, store, calls, data } = setupStored()
    store.getState().saveNow()
    assert.deepEqual(calls, [])
    store.getState().start()
    clock.advance(1000)
    store.getState().stop()
    const savedAt = savedOf(data).savedAt
    const count = calls.length
    clock.advance(10_000)
    store.getState().saveNow()
    assert.equal(calls.length, count)
    assert.equal(savedOf(data).savedAt, savedAt)
  })

  test('실제 측정을 시작하면 이전 저장 데이터를 새 세션으로 덮어쓴다', () => {
    const old = JSON.stringify({
      version: 1,
      savedAt: BASE - 60_000,
      session: { id: 'old-session', status: 'finished', startedAt: BASE - 120_000, endedAt: BASE - 60_000, endReason: 'user', pauses: [] },
      metrics: { lastFix: null, distanceM: 999, validMs: 1, recent: [] },
    })
    const { store, data } = setupStored({ [STORAGE_KEY]: old })
    store.getState().start()
    const saved = savedOf(data)
    assert.notEqual(saved.session.id, 'old-session')
    assert.equal(saved.session.id, store.getState().session?.id)
    assert.equal(saved.metrics.distanceM, 0)
  })

  test('중복 start는 다시 저장하지 않는다', () => {
    const { store, calls } = setupStored()
    store.getState().start()
    const count = calls.length
    store.getState().start()
    assert.equal(calls.length, count)
  })
})

describe('저장 실패가 측정에 영향을 주지 않는다', () => {
  test('setItem이 계속 예외를 던져도 측정과 종료가 정상이고, 상태가 저장 성공 때와 같다', () => {
    const failing = setupStored()
    failing.state.failSet = true
    const ok = setupStored()
    for (const ctx of [failing, ok]) {
      ctx.store.getState().start()
      for (let sec = 0; sec <= 12; sec += 1) ctx.geo.emitRunnerAt(sec)
      ctx.clock.advanceTo(12)
      ctx.store.getState().pause()
      ctx.clock.advance(3000)
      ctx.store.getState().resume()
      ctx.clock.advance(2000)
      ctx.store.getState().saveNow()
      ctx.store.getState().stop()
    }
    const a = failing.store.getState()
    const b = ok.store.getState()
    // 세션 id는 시작할 때마다 무작위로 만들어지므로 id만 빼고 비교한다.
    assert.deepEqual({ ...a.session, id: '' }, { ...b.session, id: '' })
    assert.deepEqual(a.metrics, b.metrics)
    assert.deepEqual(a.tracker, b.tracker)
    assert.equal(a.session?.endReason, 'user')
    assertClose(metricsOf(failing.store).distanceM, 36, 0.1)
    assert.equal(failing.geo.activeWatches, 0)
    assert.equal(failing.clock.pending, 0)
  })

  test('setItem이 예외를 던져도 10분 자동 종료가 동작한다', () => {
    const { clock, store, state } = setupStored()
    state.failSet = true
    store.getState().start()
    clock.advance(600_000)
    assert.equal(store.getState().session?.endReason, 'auto')
  })

  test('storage 접근이 모두 막혀 있어도(getItem, removeItem 포함) 측정이 정상이다', () => {
    const { clock, store, state } = setupStored()
    state.failAll = true
    store.getState().start()
    clock.advance(20_000)
    store.getState().pause()
    store.getState().resume()
    store.getState().stop()
    assert.equal(store.getState().session?.status, 'finished')
  })

  test('storage 없이(null, 생략) 만든 Store도 정상이다', () => {
    for (const storage of [null, undefined]) {
      const clock = new ManualClock(BASE)
      const geo = createFakeGeolocation(clock)
      const store = createMeasurementStore({
        allowVirtual: true,
        clock,
        realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
        storage,
      })
      store.getState().start()
      clock.advance(5000)
      store.getState().saveNow()
      store.getState().stop()
      assert.equal(store.getState().session?.endReason, 'user')
    }
  })
})

describe('가상 측정과 저장', () => {
  function setupVirtualStored(initial: Record<string, string> = {}) {
    const clock = new ManualClock(BASE)
    const fake = createFakeStorage(initial)
    const store = createMeasurementStore({ allowVirtual: true, clock, storage: fake.storage })
    return { clock, store, ...fake }
  }

  test('가상 측정의 시작, 진행, 일시정지, 완료, saveNow 동안 storage 호출이 0회이다', () => {
    const { clock, store, calls } = setupVirtualStored()
    store.getState().start(virtual('steady'))
    clock.advance(30_000)
    store.getState().pause()
    store.getState().resume()
    store.getState().saveNow()
    clock.advance(150_000)
    assert.equal(store.getState().session?.endReason, 'auto')
    store.getState().saveNow()
    assert.deepEqual(calls, [])
  })

  test('모든 가상 시나리오와 사용자 종료, 화면 이탈 종료에서도 storage 호출이 0회이다', () => {
    for (const id of ['steady', 'stop-and-go', 'gps-lost', 'gps-glitch'] as const) {
      const { clock, store, calls } = setupVirtualStored()
      store.getState().start(virtual(id))
      clock.advance(200_000)
      assert.deepEqual(calls, [], id)
    }
    const a = setupVirtualStored()
    a.store.getState().start(virtual('steady'))
    a.clock.advance(10_000)
    a.store.getState().stop()
    const b = setupVirtualStored()
    b.store.getState().start(virtual('steady'))
    b.store.getState().scheduleLeaveStop()
    b.clock.advance(0)
    assert.deepEqual([...a.calls, ...b.calls], [])
  })

  test('가상 측정 전에 저장해 둔 실제 데이터가 가상 측정 뒤에도 그대로 남는다', () => {
    const real = setupStored()
    real.store.getState().start()
    real.clock.advance(7000)
    real.store.getState().pause()
    const before = real.data.get(STORAGE_KEY)
    assert.ok(before !== undefined)

    const { clock, store, data, calls } = setupVirtualStored({ [STORAGE_KEY]: before })
    store.getState().start(virtual('gps-lost'))
    clock.advance(200_000)
    assert.equal(data.get(STORAGE_KEY), before)
    assert.deepEqual(calls, [])
  })

  test('가상 측정을 마친 뒤 같은 Store로 실제 측정을 시작하면 그때부터 저장한다', () => {
    const clock = new ManualClock(BASE)
    const geo = createFakeGeolocation(clock)
    const fake = createFakeStorage()
    const store = createMeasurementStore({
      allowVirtual: true,
      clock,
      realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
      storage: fake.storage,
    })
    store.getState().start(virtual('steady'))
    clock.advance(180_000)
    assert.deepEqual(fake.calls, [])
    store.getState().start()
    assert.equal(savedOf(fake.data).session.id, store.getState().session?.id)
  })
})

// ---------------------------------------------------------------------------
// 새로고침 복원

// 실제 측정을 seconds초 동안 3 m/s로 달리고 저장한 문자열(저장 시각 = BASE + seconds초)을 만든다.
function savedRun(seconds = 10) {
  const a = setupStored()
  a.store.getState().start()
  for (let sec = 0; sec <= seconds; sec += 1) a.geo.emitRunnerAt(sec)
  a.store.getState().saveNow()
  const raw = a.data.get(STORAGE_KEY)
  if (raw === undefined) throw new Error('저장되지 않았다')
  return { raw, sessionId: a.store.getState().session?.id }
}

// 앱을 다시 연 상황: 새 Store, 새 시계(저장 시각으로부터 afterMs 뒤), 같은 storage 내용. hydrate까지 한다.
function setupRestored(raw: string, afterMs: number, seconds = 10) {
  const clock = new ManualClock(BASE + seconds * 1000 + afterMs)
  const geo = createFakeGeolocation(clock)
  const fake = createFakeStorage({ [STORAGE_KEY]: raw })
  const store = createMeasurementStore({
    allowVirtual: true,
    clock,
    realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
    storage: fake.storage,
  })
  store.getState().hydrate()
  return { clock, geo, store, ...fake }
}

const MIN = 60_000

describe('새로고침 복원 (hydrate)', () => {
  test('진행 중이던 세션은 일시정지로 복원되고, 누적 시간과 거리가 저장 시점 그대로이다', () => {
    const { raw, sessionId } = savedRun(10)
    const { store, geo } = setupRestored(raw, 5 * MIN)
    const state = store.getState()
    assert.equal(state.session?.status, 'paused')
    assert.equal(state.session?.id, sessionId)
    assert.equal(state.needsGpsReverify, true)
    assert.deepEqual(state.runSource, { kind: 'real' })
    assert.equal(state.targetDurationMs, 600_000)
    assertClose(metricsOf(store).distanceM, 30, 0.1)
    assert.equal(metricsOf(store).elapsedMs, 10_000) // 새로고침으로 비어 있던 5분은 들어가지 않는다
    assert.equal(geo.watchCalls, 0) // GPS는 아직 시작하지 않는다
  })

  test('복원 직후 직전 좌표와 최근 구간은 비워지고 tracker는 새로 만들어진다', () => {
    const { raw } = savedRun(10)
    const { store } = setupRestored(raw, MIN)
    assert.equal(store.getState().metrics.lastFix, null)
    assert.deepEqual(store.getState().metrics.recent, [])
    assert.equal(store.getState().tracker.acceptedCount, 0)
  })

  test('복원은 저장하지 않는다: 저장 시각이 그대로이고, 시간이 지나도 주기·pagehide 저장이 없다', () => {
    const { raw } = savedRun(10)
    const { clock, store, data, calls } = setupRestored(raw, MIN)
    store.getState().attach()
    store.getState().saveNow()
    clock.advance(60_000)
    store.getState().saveNow()
    assert.equal(calls.filter((c) => c === 'set').length, 0)
    assert.equal(data.get(STORAGE_KEY), raw)
  })

  test('시간이 아무리 지나도 복원된 일시정지 세션의 경과 시간은 늘지 않는다', () => {
    const { raw } = savedRun(10)
    const { clock, store } = setupRestored(raw, 0)
    store.getState().attach()
    clock.advance(25 * MIN)
    assert.equal(store.getState().session?.status, 'paused')
    assert.equal(metricsOf(store).elapsedMs, 10_000)
  })

  test('복원한 세션을 다시 새로고침해도 같은 상태로 복원된다 (저장 시각이 늘지 않는다)', () => {
    const { raw } = savedRun(10)
    const first = setupRestored(raw, 10 * MIN)
    first.store.getState().attach()
    first.clock.advance(5 * MIN)
    first.store.getState().saveNow() // pagehide
    // 두 번째 새로고침: 저장 내용은 그대로이다
    assert.equal(first.data.get(STORAGE_KEY), raw)
    const second = setupRestored(first.data.get(STORAGE_KEY) ?? '', 20 * MIN)
    assert.equal(second.store.getState().session?.status, 'paused')
    assert.equal(metricsOf(second.store).elapsedMs, 10_000)
    assertClose(metricsOf(second.store).distanceM, 30, 0.1)
  })

  test('이미 일시정지로 저장된 세션도 그대로 복원된다', () => {
    const a = setupStored()
    a.store.getState().start()
    a.clock.advance(20_000)
    a.store.getState().pause()
    const raw = a.data.get(STORAGE_KEY) ?? ''
    const { store } = setupRestored(raw, 3 * MIN, 20)
    assert.equal(store.getState().session?.status, 'paused')
    assert.equal(metricsOf(store).elapsedMs, 20_000)
    assert.equal(store.getState().needsGpsReverify, true)
  })

  test('종료된 세션(Result)은 그대로 복원되고 재개 대상이 아니다', () => {
    const a = setupStored()
    a.store.getState().start()
    for (let sec = 0; sec <= 10; sec += 1) a.geo.emitRunnerAt(sec)
    a.store.getState().stop()
    const raw = a.data.get(STORAGE_KEY) ?? ''
    const { store, geo, clock } = setupRestored(raw, MIN)
    assert.equal(store.getState().session?.status, 'finished')
    assert.equal(store.getState().session?.endReason, 'user')
    assert.deepEqual(store.getState().metrics, a.store.getState().metrics)
    assert.equal(store.getState().needsGpsReverify, false)
    store.getState().attach()
    assert.equal(geo.watchCalls, 0)
    assert.equal(clock.pending, 0)
  })

  test('30분이 지났거나 손상된 저장분은 복원하지 않고 지운다', () => {
    const { raw } = savedRun(10)
    const expired = setupRestored(raw, 31 * MIN)
    assert.equal(expired.store.getState().session, null)
    assert.equal(expired.data.has(STORAGE_KEY), false)
    const broken = setupRestored('{"version":1,', 0)
    assert.equal(broken.store.getState().session, null)
    assert.equal(broken.data.has(STORAGE_KEY), false)
    const ok = setupRestored(raw, 29 * MIN)
    assert.equal(ok.store.getState().session?.status, 'paused')
  })

  test('hydrate를 부르기 전에는 storage를 읽지 않고, 이미 세션이 있으면 복원하지 않는다', () => {
    const { raw } = savedRun(10)
    const clock = new ManualClock(BASE + 20_000)
    const geo = createFakeGeolocation(clock)
    const fake = createFakeStorage({ [STORAGE_KEY]: raw })
    const store = createMeasurementStore({
      allowVirtual: true,
      clock,
      realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
      storage: fake.storage,
    })
    assert.deepEqual(fake.calls, [])
    store.getState().start()
    const id = store.getState().session?.id
    store.getState().hydrate()
    assert.equal(store.getState().session?.id, id)
    assert.equal(store.getState().needsGpsReverify, false)
  })

  test('storage가 없으면 hydrate는 아무 일도 하지 않는다', () => {
    const clock = new ManualClock(BASE)
    const store = createMeasurementStore({ allowVirtual: true, clock, storage: null })
    store.getState().hydrate()
    assert.equal(store.getState().session, null)
  })
})

describe('복원 후 GPS 재확인과 재개', () => {
  test('attach 전에는 GPS 감시가 없고, attach하면 한 번만 시작한다 (중복 호출 무해)', () => {
    const { raw } = savedRun(10)
    const { store, geo } = setupRestored(raw, MIN)
    assert.equal(geo.watchCalls, 0)
    store.getState().attach()
    store.getState().attach()
    assert.equal(geo.watchCalls, 1)
    assert.equal(geo.activeWatches, 1)
  })

  test('attach하면 화면용 시각(now)이 계속 갱신된다 (신호 끊김을 화면이 알 수 있다)', () => {
    const { raw } = savedRun(10)
    const { clock, geo, store } = setupRestored(raw, MIN)
    store.getState().attach()
    geo.emit(0)
    clock.advance(11_000)
    assert.equal(store.getState().now, clock.now())
    assert.equal(getGpsStatus(store.getState().tracker, store.getState().now), 'lost')
  })

  test('GPS가 확인되기 전에는 resume()이 재개하지 않는다', () => {
    const { raw } = savedRun(10)
    const { clock, store } = setupRestored(raw, MIN)
    store.getState().attach()
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'paused')
    assert.equal(store.getState().needsGpsReverify, true)
    clock.advance(30_000)
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'paused')
  })

  test('GPS가 확인된 뒤 resume()하면 이어지고, 누적 시간과 거리를 유지한 채 새 구간부터 계산한다', () => {
    const { raw } = savedRun(10)
    const { clock, geo, store } = setupRestored(raw, 10 * MIN)
    store.getState().attach()
    geo.emit(0.01) // 멀리 떨어진 곳에서 첫 좌표: 재확인용 (일시정지 중이라 지표에 반영되지 않는다)
    assert.equal(store.getState().tracker.acceptedCount, 1)
    assertClose(metricsOf(store).distanceM, 30, 0.1)
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(store.getState().needsGpsReverify, false)
    clock.advance(1000)
    geo.emit(0.01) // 재개 뒤 첫 좌표: 새 구간의 시작점
    clock.advance(1000)
    geo.emit(0.01 + 3 / METERS_PER_DEGREE) // 3 m 이동
    // 거리는 저장된 30 m + 재개 뒤 3 m이다. 이전 위치와의 먼 거리가 더해지지 않는다.
    assertClose(metricsOf(store).distanceM, 33, 0.2)
    // 경과 시간은 저장된 10초 + 재개 뒤 2초이다. 새로고침으로 비어 있던 10분은 들어가지 않는다.
    assert.equal(metricsOf(store).elapsedMs, 12_000)
  })

  test('GPS가 한 번 확인됐어도 신호가 끊기면 다시 재개할 수 없다', () => {
    const { raw } = savedRun(10)
    const { clock, geo, store } = setupRestored(raw, MIN)
    store.getState().attach()
    geo.emit(0)
    clock.advance(10_001)
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'paused')
    geo.emit(0)
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'running')
  })

  test('권한 거부로 GPS를 쓸 수 없으면 재개할 수 없지만 종료할 수 있다', () => {
    const { raw } = savedRun(10)
    const { clock, geo, store } = setupRestored(raw, MIN)
    store.getState().attach()
    geo.fail(1)
    store.getState().resume()
    assert.equal(store.getState().session?.status, 'paused')
    store.getState().stop()
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(clock.pending, 0)
    assert.equal(geo.activeWatches, 0)
  })

  test('재개하면 남은 시간만큼 타이머를 다시 예약하고 600초에 자동 종료한다 (복원 대기 시간 제외)', () => {
    const { raw } = savedRun(100)
    const { clock, geo, store } = setupRestored(raw, 8 * MIN, 100)
    store.getState().attach()
    geo.emit(0)
    store.getState().resume()
    clock.advance(499_999)
    assert.equal(store.getState().session?.status, 'running')
    clock.advance(1)
    assert.equal(store.getState().session?.endReason, 'auto')
    assert.equal(metricsOf(store).elapsedMs, 600_000)
  })

  test('재개하면 저장이 다시 시작되고, 그 뒤 새로고침하면 재개 이후 시간까지 복원된다', () => {
    const { raw } = savedRun(10)
    const first = setupRestored(raw, MIN)
    first.store.getState().attach()
    first.geo.emit(0)
    first.store.getState().resume()
    first.clock.advance(7000)
    first.store.getState().saveNow()
    const saved = first.data.get(STORAGE_KEY) ?? ''
    assert.notEqual(saved, raw)
    const second = setupRestored(saved, 2 * MIN, 17)
    assert.equal(second.store.getState().session?.status, 'paused')
    assert.equal(metricsOf(second.store).elapsedMs, 17_000)
  })

  test('복원된 세션을 종료하면 종료 상태가 저장되고 GPS 감시가 정리된다', () => {
    const { raw } = savedRun(10)
    const { clock, geo, store, data } = setupRestored(raw, MIN)
    store.getState().attach()
    store.getState().stop()
    assert.equal(store.getState().session?.status, 'finished')
    assert.equal(store.getState().needsGpsReverify, false)
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? '').session.status, 'finished')
    assert.equal(geo.activeWatches, 0)
    assert.equal(clock.pending, 0)
  })

  test('일반 측정에서는 복원 상태가 아니고 attach는 아무 일도 하지 않는다', () => {
    const { geo, store } = setupStored()
    store.getState().start()
    assert.equal(store.getState().needsGpsReverify, false)
    store.getState().attach()
    assert.equal(geo.watchCalls, 1) // start가 시작한 감시 하나뿐
  })
})

describe('복원된 세션과 새 측정', () => {
  test('복원된 세션이 있을 때 새 측정을 시작하면 복원 세션을 교체한다', () => {
    const { raw, sessionId } = savedRun(10)
    const { store, geo, data } = setupRestored(raw, MIN)
    store.getState().attach()
    assert.equal(geo.activeWatches, 1)
    store.getState().start()
    const state = store.getState()
    assert.equal(state.session?.status, 'running')
    assert.notEqual(state.session?.id, sessionId)
    assert.equal(state.needsGpsReverify, false)
    assert.equal(state.metrics.distanceM, 0)
    assert.equal(geo.activeWatches, 1) // 이전 감시는 정리되고 새 감시 하나만 남는다
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? '').session.id, state.session?.id) // 저장분도 교체됨
  })

  test('복원된 종료 세션 뒤의 새 측정은 기존처럼 시작된다', () => {
    const a = setupStored()
    a.store.getState().start()
    a.clock.advance(5000)
    a.store.getState().stop()
    const { store } = setupRestored(a.data.get(STORAGE_KEY) ?? '', MIN, 0)
    store.getState().start()
    assert.equal(store.getState().session?.status, 'running')
  })
})

describe('새로고침과 화면 이탈 구분 (unloading)', () => {
  test('언로드 중(pagehide)에 예약된 이탈 종료는 실행되지 않는다', () => {
    const { clock, store, data } = setupStored()
    store.getState().start()
    clock.advance(3000)
    store.getState().saveNow()
    store.getState().setUnloading(true)
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session?.status, 'running')
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? '').session.status, 'running')
  })

  test('pageshow로 풀리면(unloading=false) 이탈 종료가 평소처럼 동작한다', () => {
    const { clock, store } = setupStored()
    store.getState().start()
    store.getState().setUnloading(true)
    store.getState().setUnloading(false)
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session?.endReason, 'user')
  })

  test('평소의 화면 이탈은 종료한다 (SPA 이동)', () => {
    const { clock, store, data } = setupStored()
    store.getState().start()
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session?.status, 'finished')
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? '').session.status, 'finished')
  })

  test('복원된 세션에서 화면을 떠나면 종료한다', () => {
    const { raw } = savedRun(10)
    const { clock, store, geo } = setupRestored(raw, MIN)
    store.getState().attach()
    store.getState().scheduleLeaveStop()
    clock.advance(0)
    assert.equal(store.getState().session?.endReason, 'user')
    assert.equal(geo.activeWatches, 0)
  })

  test('StrictMode처럼 마운트, 언마운트, 마운트가 같은 틱에 일어나도 복원된 세션이 끝나지 않는다', () => {
    const { raw } = savedRun(10)
    const { clock, store, geo } = setupRestored(raw, MIN)
    store.getState().cancelLeaveStop()
    store.getState().attach()
    store.getState().scheduleLeaveStop()
    store.getState().cancelLeaveStop()
    store.getState().attach()
    clock.advance(0)
    assert.equal(store.getState().session?.status, 'paused')
    assert.equal(geo.watchCalls, 1)
  })

  test('사용자 종료와 10분 자동 종료는 언로드 플래그와 무관하게 동작한다', () => {
    const a = setupStored()
    a.store.getState().start()
    a.store.getState().setUnloading(true)
    a.store.getState().stop()
    assert.equal(a.store.getState().session?.endReason, 'user')
    const b = setupStored()
    b.store.getState().start()
    b.store.getState().setUnloading(true)
    b.clock.advance(600_000)
    assert.equal(b.store.getState().session?.endReason, 'auto')
  })

  test('일시정지 중에는 주기 저장과 saveNow가 저장하지 않는다 (running일 때만)', () => {
    const { clock, store, calls } = setupStored()
    store.getState().start()
    clock.advance(1000)
    store.getState().pause()
    const count = calls.filter((c) => c === 'set').length
    clock.advance(30_000)
    store.getState().saveNow()
    assert.equal(calls.filter((c) => c === 'set').length, count)
  })
})

// 정책: 가상 GPS는 개발 환경에서만 켜진다. 배포 환경에서는 가상을 요청해도(주소, 개발자 도구 등) 실제 GPS 흐름으로 처리한다.
describe('가상 GPS 배포 차단 (allowVirtual=false 또는 기본값)', () => {
  function setupBlocked(allowVirtual?: boolean) {
    const clock = new ManualClock(BASE)
    const geo = createFakeGeolocation(clock)
    const fake = createFakeStorage()
    const store = createMeasurementStore({
      clock,
      realEnv: () => ({ isSecureContext: true, geolocation: geo.geolocation }),
      storage: fake.storage,
      ...(allowVirtual === undefined ? {} : { allowVirtual }),
    })
    return { clock, geo, store, ...fake }
  }

  test('가상을 요청해도 실제 GPS로 시작한다: 실제 위치 감시 1회, 가상 시나리오 없음', () => {
    const { geo, store } = setupBlocked(false)
    store.getState().start(virtual('steady'))
    assert.deepEqual(store.getState().runSource, { kind: 'real' })
    assert.equal(geo.watchCalls, 1)
    assert.equal(store.getState().targetDurationMs, 600_000)
  })

  test('가상 좌표·타이머가 실행되지 않는다: 시간이 흘러도 거리가 쌓이지 않고 시나리오 완료로 끝나지 않는다', () => {
    const { clock, store } = setupBlocked(false)
    store.getState().start(virtual('steady'))
    clock.advance(200_000) // 가상 steady는 이 안에 자동 완료된다
    const { session, tracker } = store.getState()
    assert.equal(session?.status, 'running')
    assert.equal(tracker.acceptedCount, 0)
    assert.equal(metricsOf(store).distanceM, 0)
  })

  test('실제 좌표만 거리에 반영되고, 실제 측정으로 저장된다', () => {
    const { geo, store, calls } = setupBlocked(false)
    store.getState().start(virtual('gps-lost'))
    for (let sec = 0; sec <= 10; sec += 1) geo.emitRunnerAt(sec)
    assertClose(metricsOf(store).distanceM, 30)
    assert.ok(calls.includes('set'), '실제 측정은 저장된다')
  })

  test('허용 여부를 정하지 않으면(테스트·개발 빌드가 아닌 환경) 차단이 기본이다', () => {
    const { geo, store } = setupBlocked()
    store.getState().start(virtual('steady'))
    assert.deepEqual(store.getState().runSource, { kind: 'real' })
    assert.equal(geo.watchCalls, 1)
  })

  test('허용하면(개발 환경) 기존처럼 가상 GPS로 시작하고 저장하지 않는다', () => {
    const { store, calls } = setupBlocked(true)
    store.getState().start(virtual('steady'))
    assert.deepEqual(store.getState().runSource, { kind: 'virtual', scenarioId: 'steady' })
    assert.deepEqual(calls, [])
  })

  test('실제 GPS를 요청하는 일반 시작은 차단 여부와 상관없이 같다', () => {
    const { geo, store } = setupBlocked(false)
    store.getState().start()
    assert.deepEqual(store.getState().runSource, { kind: 'real' })
    assert.equal(geo.watchCalls, 1)
  })
})
