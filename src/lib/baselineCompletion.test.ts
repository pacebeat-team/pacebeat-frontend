import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { BASELINE_MIN_VALID_MS } from '../features/measurement/baseline.ts'
import type { GeolocationLike, PositionErrorLike, PositionLike } from '../features/measurement/geolocationSource.ts'
import { createMetrics } from '../features/measurement/metrics.ts'
import { pauseSession, startSession, stopSession } from '../features/measurement/session.ts'
import { saveMeasurement } from '../features/measurement/sessionPersistence.ts'
import type { StorageLike } from '../features/measurement/sessionPersistence.ts'
import type { MeasurementSession, MetricsState } from '../features/measurement/types.ts'
import type { VirtualClock } from '../features/measurement/virtualGeolocation.ts'
import { createMeasurementStore } from '../stores/measurementStore.ts'
import type { RunSource } from '../stores/measurementStore.ts'
import { isBaselineMeasurementCompleted, startBaselineCompletionSync } from './baselineCompletion.ts'

const BASE = 1_700_000_000_000
const REAL: RunSource = { kind: 'real' }
const VIRTUAL: RunSource = { kind: 'virtual', scenarioId: 'steady' }

function metricsWith(validMs: number): MetricsState {
  return { ...createMetrics(), validMs }
}

function runningSession(): MeasurementSession {
  return startSession(null, BASE, () => 'test-session')
}

function finishedSession(reason: 'user' | 'auto' = 'user'): MeasurementSession {
  return stopSession(runningSession(), BASE + 200_000, reason)
}

describe('isBaselineMeasurementCompleted (순수 판정)', () => {
  test('실제 GPS + finished + 120초 → true', () => {
    assert.equal(
      isBaselineMeasurementCompleted({
        session: finishedSession(),
        runSource: REAL,
        metrics: metricsWith(BASELINE_MIN_VALID_MS),
      }),
      true,
    )
  })

  test('실제 GPS + finished + 119999ms → false', () => {
    assert.equal(
      isBaselineMeasurementCompleted({
        session: finishedSession(),
        runSource: REAL,
        metrics: metricsWith(BASELINE_MIN_VALID_MS - 1),
      }),
      false,
    )
  })

  test('가상 GPS + finished + 120초 이상 → false', () => {
    assert.equal(
      isBaselineMeasurementCompleted({
        session: finishedSession('auto'),
        runSource: VIRTUAL,
        metrics: metricsWith(BASELINE_MIN_VALID_MS * 2),
      }),
      false,
    )
  })

  test('세션 미존재 → false (runSource가 없어도 false)', () => {
    assert.equal(
      isBaselineMeasurementCompleted({ session: null, runSource: REAL, metrics: metricsWith(999_999) }),
      false,
    )
    assert.equal(
      isBaselineMeasurementCompleted({ session: null, runSource: null, metrics: createMetrics() }),
      false,
    )
  })

  test('측정 중 → false', () => {
    assert.equal(
      isBaselineMeasurementCompleted({
        session: runningSession(),
        runSource: REAL,
        metrics: metricsWith(BASELINE_MIN_VALID_MS * 2),
      }),
      false,
    )
  })

  test('일시정지 → false', () => {
    assert.equal(
      isBaselineMeasurementCompleted({
        session: pauseSession(runningSession(), BASE + 150_000),
        runSource: REAL,
        metrics: metricsWith(BASELINE_MIN_VALID_MS * 2),
      }),
      false,
    )
  })

  test('종료 사유(사용자/자동)는 판정에 영향을 주지 않는다', () => {
    for (const reason of ['user', 'auto'] as const) {
      assert.equal(
        isBaselineMeasurementCompleted({
          session: finishedSession(reason),
          runSource: REAL,
          metrics: metricsWith(BASELINE_MIN_VALID_MS),
        }),
        true,
      )
    }
  })
})

// ----- 실제 측정 Store와 연결하는 테스트 (측정 엔진은 그대로 쓰고, 시계와 위치만 가짜) -----

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

  advanceTo(seconds: number): void {
    this.advance(BASE + seconds * 1000 - this.current)
  }
}

const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

function createFakeGeolocation(clock: ManualClock) {
  const watches = new Map<
    number,
    { onSuccess: (position: PositionLike) => void; onError: (error: PositionErrorLike) => void }
  >()
  let nextId = 1
  const geolocation: GeolocationLike = {
    watchPosition(onSuccess, onError) {
      const id = nextId
      nextId += 1
      watches.set(id, { onSuccess, onError })
      return id
    },
    clearWatch(id) {
      watches.delete(id)
    },
  }
  return {
    geolocation,
    // t초 시점에 3 m/s로 달려 온 위치를 전달한다.
    emitRunnerAt(seconds: number) {
      clock.advanceTo(seconds)
      for (const watch of [...watches.values()]) {
        watch.onSuccess({
          coords: { latitude: 0, longitude: (seconds * 3) / METERS_PER_DEGREE, accuracy: 5 },
          timestamp: clock.now(),
        })
      }
    },
    // 위치 권한 거부(code 1) 같은 GPS 오류를 전달한다.
    fail(code: number) {
      for (const watch of [...watches.values()]) {
        watch.onError({ code })
      }
    },
  }
}

function createMemoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

// 온보딩 Store 대신 쓰는 가짜. completeBaselineMeasurement가 불린 횟수를 센다.
function createFakeOnboarding(initiallyCompleted = false) {
  const state = {
    baselineMeasurementCompleted: initiallyCompleted,
    calls: 0,
    completeBaselineMeasurement() {
      state.calls += 1
      state.baselineMeasurementCompleted = true
    },
  }
  return { getState: () => state, state }
}

function setup(options: { storage?: StorageLike } = {}) {
  const clock = new ManualClock(BASE)
  const fake = createFakeGeolocation(clock)
  const store = createMeasurementStore({
    allowVirtual: true,
    clock,
    storage: options.storage ?? null,
    realEnv: () => ({ isSecureContext: true, geolocation: fake.geolocation }),
  })
  return { clock, fake, store }
}

// 실제 GPS로 seconds초까지 1초마다 좌표를 받는다.
function runReal(env: ReturnType<typeof setup>, seconds: number): void {
  env.store.getState().start()
  for (let t = 1; t <= seconds; t += 1) {
    env.fake.emitRunnerAt(t)
  }
}

describe('startBaselineCompletionSync (Store 연결)', () => {
  test('등록 이후 실제 측정이 120초 이상으로 종료되면 완료를 기록한다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)

    runReal(env, 130)
    assert.equal(onboarding.state.calls, 0, '종료 전에는 기록하지 않는다')
    assert.ok(env.store.getState().metrics.validMs >= BASELINE_MIN_VALID_MS, '준비: 유효 시간이 120초 이상')

    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 1)
  })

  test('등록 직후 이미 종료된 완료 상태를 바로 확인한다', () => {
    const env = setup()
    runReal(env, 130)
    env.store.getState().stop()

    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)
    assert.equal(onboarding.state.calls, 1)
  })

  test('저장된 종료 세션을 hydrate로 복원하면(등록이 먼저여도 나중이어도) 완료를 기록한다', () => {
    const storage = createMemoryStorage()
    // 이전 실행에서 저장된 완료 측정을 만든다.
    const previous = setup({ storage })
    runReal(previous, 130)
    previous.store.getState().stop()

    // 등록 후 복원: 구독이 복원(set)을 받는다.
    const registeredFirst = setup({ storage })
    const onboardingA = createFakeOnboarding()
    startBaselineCompletionSync(registeredFirst.store, onboardingA)
    assert.equal(onboardingA.state.calls, 0, '복원 전에는 기록하지 않는다')
    registeredFirst.clock.advanceTo(200) // 새로고침 뒤: 저장 시각보다 나중
    registeredFirst.store.getState().hydrate()
    assert.equal(onboardingA.state.calls, 1)

    // 복원 후 등록: 등록 시 초기 확인이 잡는다.
    const hydratedFirst = setup({ storage })
    hydratedFirst.clock.advanceTo(200)
    hydratedFirst.store.getState().hydrate()
    const onboardingB = createFakeOnboarding()
    startBaselineCompletionSync(hydratedFirst.store, onboardingB)
    assert.equal(onboardingB.state.calls, 1)
  })

  test('복원된 진행 중(일시정지) 세션은 완료로 기록하지 않는다', () => {
    const storage = createMemoryStorage()
    saveMeasurement(
      storage,
      { session: pauseSession(runningSession(), BASE + 150_000), metrics: metricsWith(BASELINE_MIN_VALID_MS * 2) },
      BASE + 150_000,
    )
    const store = createMeasurementStore({ allowVirtual: true, clock: new ManualClock(BASE + 160_000), storage })
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(store, onboarding)
    store.getState().hydrate()
    assert.equal(store.getState().needsGpsReverify, true, '준비: 복원된 진행 중 세션')
    assert.equal(onboarding.state.calls, 0)
  })

  test('이미 완료로 기록돼 있으면 반복 갱신하지 않는다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding(true)
    startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 130)
    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 0)
  })

  test('측정 도중 Store가 여러 번 바뀌어도 완료 기록은 한 번이다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 130)
    env.store.getState().stop()
    // 종료 뒤에도 Store가 바뀐다(예: 새 측정 시작 전 상태 갱신). 이미 기록돼 있으므로 다시 부르지 않는다.
    env.store.getState().start()
    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 1)
  })

  test('유효 시간이 120초 미만이면 기록하지 않는다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 100)
    env.store.getState().stop()
    assert.ok(env.store.getState().metrics.validMs < BASELINE_MIN_VALID_MS, '준비: 유효 시간이 120초 미만')
    assert.equal(onboarding.state.calls, 0)
  })

  test('GPS 오류가 나도 오류 전까지 유효 시간이 120초 이상이면 기록한다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 130)
    env.fake.fail(1) // 위치 권한 거부 같은 GPS 오류. 세션은 끝나지 않고 tracker에만 기록된다.
    assert.equal(env.store.getState().session?.status, 'running', '준비: GPS 오류만으로 세션이 끝나지 않는다')
    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 1)
  })

  test('GPS 오류가 나고 유효 시간이 120초 미만이면 기록하지 않는다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 60)
    env.fake.fail(1)
    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 0)
  })

  test('가상 측정은 유효 시간이 120초를 넘어도 기록하지 않는다', () => {
    const clock = new ManualClock(BASE)
    const store = createMeasurementStore({ allowVirtual: true, clock, storage: null })
    const onboarding = createFakeOnboarding()
    startBaselineCompletionSync(store, onboarding)
    store.getState().start({ virtual: 'steady' })
    clock.advance(15 * 60_000)
    const { session, metrics, runSource } = store.getState()
    assert.equal(session?.status, 'finished', '준비: 가상 측정이 끝났다')
    assert.equal(runSource?.kind, 'virtual')
    assert.ok(metrics.validMs >= BASELINE_MIN_VALID_MS, '준비: 가상 측정의 유효 시간이 120초 이상')
    assert.equal(onboarding.state.calls, 0)
  })

  test('구독을 해제하면 이후에는 동기화하지 않는다', () => {
    const env = setup()
    const onboarding = createFakeOnboarding()
    const unsubscribe = startBaselineCompletionSync(env.store, onboarding)
    runReal(env, 130)
    unsubscribe()
    env.store.getState().stop()
    assert.equal(onboarding.state.calls, 0)
  })

  test('해제 함수를 돌려주므로 HMR dispose에 그대로 넘길 수 있다', () => {
    const env = setup()
    const unsubscribe = startBaselineCompletionSync(env.store, createFakeOnboarding())
    assert.equal(typeof unsubscribe, 'function')
    unsubscribe()
    unsubscribe() // 두 번 불러도 문제없다
  })
})
