import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createGeolocationSource } from '../features/measurement/geolocationSource.ts'
import type { GeolocationEnv, GpsSource } from '../features/measurement/geolocationSource.ts'
import { applyGpsError, createGpsTracker, processFix } from '../features/measurement/gpsTracker.ts'
import { addFix, createMetrics } from '../features/measurement/metrics.ts'
import {
  isSessionActive,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
} from '../features/measurement/session.ts'
import type {
  GpsErrorReason,
  GpsTrackerState,
  MeasurementSession,
  MetricsState,
  RawFix,
  SessionEndReason,
} from '../features/measurement/types.ts'
import { createVirtualGeolocation, SYSTEM_CLOCK } from '../features/measurement/virtualGeolocation.ts'
import type { VirtualClock } from '../features/measurement/virtualGeolocation.ts'
import { VIRTUAL_SCENARIOS } from '../features/measurement/virtualScenarios.ts'
import type { VirtualScenarioId } from '../features/measurement/virtualScenarios.ts'

// 측정 Store: 엔진의 순수 함수들을 한 줄로 잇는다.
//   GPS 공급원(실제 또는 가상) → RawFix → gpsTracker(processFix) → ValidFix → metrics(addFix) → 이 Store → 화면
// - 계산은 하지 않는다. 경과 시간, 지표, GPS 상태 같은 파생값은 저장하지 않고 화면 쪽(toMeasurementView)에서
//   엔진 함수로 그때그때 구한다. 이 Store는 원본 상태(session, tracker, metrics)와 현재 시각(now)만 가진다.
// - 실제 GPS와 가상 GPS는 같은 createGeolocationSource를 거친다. 다른 점은 geolocation 객체뿐이다.
// - 목표 시간에 의한 자동 종료는 없다(목표 설정 단계에서 추가). 종료는 사용자 종료, 가상 시나리오 완료뿐이다.
// - 세션, 좌표 시각, 공급원은 모두 같은 시계(deps.clock, 기본 Date.now)를 쓴다.
// - 저장하지 않는다(새로고침하면 사라진다).

export type RunSource =
  | { readonly kind: 'real' }
  | { readonly kind: 'virtual'; readonly scenarioId: VirtualScenarioId }

export interface StartOptions {
  // 있으면 이 가상 시나리오로 측정하고, 없으면 실제 GPS를 쓴다.
  readonly virtual?: VirtualScenarioId
}

export interface MeasurementData {
  readonly session: MeasurementSession | null
  readonly tracker: GpsTrackerState
  readonly metrics: MetricsState
  // 화면 갱신용 현재 시각(epoch ms). 틱 타이머와 좌표 수신 때 갱신한다.
  readonly now: number
  // 이번(또는 마지막) 측정의 데이터 출처. 측정한 적이 없으면 null
  readonly runSource: RunSource | null
}

export interface MeasurementActions {
  // 활성 세션이 있으면 아무 것도 하지 않는다(중복 시작 방지). 종료된 뒤에는 새 측정으로 초기화한다.
  start: (options?: StartOptions) => void
  pause: () => void
  resume: () => void
  // 사용자 종료. 이미 종료됐으면 아무 것도 하지 않는다.
  stop: () => void
  // 측정 화면을 떠날 때 부른다. 현재 이벤트 루프가 끝난 뒤에도 세션이 활성이면 종료한다.
  // 그 사이에 cancelLeaveStop이 불리면(개발 환경 StrictMode의 즉시 재마운트) 취소한다.
  scheduleLeaveStop: () => void
  cancelLeaveStop: () => void
}

export type MeasurementState = MeasurementData & MeasurementActions

export interface MeasurementDeps {
  // 현재 시각과 일회성 타이머. 테스트는 수동 시계를 넣는다.
  readonly clock: VirtualClock
  // 실제 GPS 모드의 실행 환경. 기본값은 브라우저(navigator.geolocation)이다.
  readonly realEnv?: () => GeolocationEnv
}

const TICK_MS = 500

// 주소의 ?virtual=... 값을 읽는다. 없으면 null, 값 없이 ?virtual이면 steady, 모르는 값이면 null(실제 GPS).
export function isVirtualScenarioId(value: string): value is VirtualScenarioId {
  return Object.hasOwn(VIRTUAL_SCENARIOS, value)
}

export function parseVirtualParam(search: string): VirtualScenarioId | null {
  const value = new URLSearchParams(search).get('virtual')
  if (value === null) {
    return null
  }
  if (value === '') {
    return 'steady'
  }
  return isVirtualScenarioId(value) ? value : null
}

// 주소에서 읽는 개발·시연용 모드.
// - ?virtual=steady|stop-and-go|gps-lost|gps-glitch : 가상 GPS로 측정한다. 개발과 배포 환경 모두에서 동작한다.
//   값 없이 ?virtual이면 steady. 모르는 값이면 가상 모드를 켜지 않는다(실제 GPS).
// - ?scenario=... : Mock(예시) 데이터. 개발 환경(isDev)에서만 켜진다. ?virtual이 함께 있으면 ?virtual이 우선한다.
export interface UrlMode {
  readonly virtual: VirtualScenarioId | null
  readonly mock: boolean
}

export function parseUrlMode(search: string, isDev: boolean): UrlMode {
  const virtual = parseVirtualParam(search)
  return {
    virtual,
    mock: isDev && virtual === null && new URLSearchParams(search).has('scenario'),
  }
}

const INITIAL_DATA: Omit<MeasurementData, 'now'> = {
  session: null,
  tracker: createGpsTracker(),
  metrics: createMetrics(),
  runSource: null,
}

export function createMeasurementStore(deps: MeasurementDeps = { clock: SYSTEM_CLOCK }) {
  const { clock } = deps

  // 직렬화할 필요도, 화면을 다시 그릴 필요도 없는 것들은 상태가 아니라 클로저에 둔다.
  let source: GpsSource | null = null
  let cancelTick: (() => void) | null = null
  let cancelLeave: (() => void) | null = null
  // 이전 측정의 늦은 콜백이 새 측정에 섞이지 않는 것은 다른 장치가 보장한다:
  // 공급원은 stop() 뒤 콜백을 무시하고(geolocationSource), 가상 공급원은 clearWatch 때 완료 예약을 취소한다.

  const store = createStore<MeasurementState>()((set, get) => {
    function stopSource(): void {
      const running = source
      source = null
      running?.stop()
    }

    function stopTick(): void {
      cancelTick?.()
      cancelTick = null
    }

    function startTick(): void {
      cancelTick = clock.schedule(() => {
        cancelTick = null
        if (!isSessionActive(get().session)) {
          return
        }
        set({ now: clock.now() })
        startTick()
      }, TICK_MS)
    }

    // 세션을 끝내고 공급원과 타이머를 정리한다. 사용자 종료와 가상 완료가 모두 이 한 곳을 지나므로
    // 어느 쪽이든 같은 종료 상태(status 'finished')가 만들어진다.
    function finish(reason: SessionEndReason): void {
      const session = get().session
      if (session === null || session.status === 'finished') {
        return
      }
      const ended = stopSession(session, clock.now(), reason)
      set({ session: ended, now: ended.endedAt ?? clock.now() })
      stopSource()
      stopTick()
    }

    // 좌표 한 개: 검증 → (통과하면) 지표 반영을 한 번의 갱신으로 한다. 예외를 던지지 않는다.
    function handleFix(raw: RawFix): void {
      const { session, tracker, metrics, now } = get()
      if (session === null || session.status === 'finished') {
        return
      }
      const processed = processFix(tracker, raw)
      set({
        tracker: processed.state,
        metrics: processed.result.accepted ? addFix(metrics, processed.result.fix, session) : metrics,
        now: Math.max(now, raw.receivedAt),
      })
    }

    function handleError(reason: GpsErrorReason): void {
      const { session, tracker } = get()
      if (session === null || session.status === 'finished') {
        return
      }
      const next = applyGpsError(tracker, reason)
      if (next !== tracker) {
        set({ tracker: next })
      }
    }

    function createSource(runSource: RunSource): GpsSource {
      const handlers = {
        onFix: handleFix,
        onError: handleError,
      }
      if (runSource.kind === 'virtual') {
        const scenario = VIRTUAL_SCENARIOS[runSource.scenarioId]
        return createGeolocationSource(handlers, {
          now: () => clock.now(),
          env: () => ({
            isSecureContext: true,
            geolocation: createVirtualGeolocation(scenario, clock, {
              // 가상 시나리오가 끝났다. GPS 오류(onError)와는 별개의 경로이다.
              onComplete: () => finish('auto'),
            }),
          }),
        })
      }
      return createGeolocationSource(handlers, { now: () => clock.now(), env: deps.realEnv })
    }

    return {
      ...INITIAL_DATA,
      now: clock.now(),

      start: (options = {}) => {
        if (isSessionActive(get().session)) {
          return
        }
        // 이전 측정이 남긴 정리 예약, 공급원, 타이머를 비운다.
        cancelLeave?.()
        cancelLeave = null
        stopSource()
        stopTick()

        const now = clock.now()
        const runSource: RunSource =
          options.virtual === undefined
            ? { kind: 'real' }
            : { kind: 'virtual', scenarioId: options.virtual }

        // 상태를 먼저 만든 뒤 공급원을 시작한다. 위치를 쓸 수 없는 환경이면 start() 안에서
        // 동기로 오류가 전달되므로, 그때 이미 세션과 tracker가 있어야 한다.
        set({
          session: startSession(null, now),
          tracker: createGpsTracker(),
          metrics: createMetrics(),
          now,
          runSource,
        })
        startTick()
        source = createSource(runSource)
        source.start()
      },

      pause: () => {
        const session = get().session
        if (session === null || session.status !== 'running') {
          return
        }
        // GPS 감시는 계속 켜 둔다. 일시정지 중의 좌표는 metrics가 반영하지 않는다.
        const now = clock.now()
        set({ session: pauseSession(session, now), now })
      },

      resume: () => {
        const session = get().session
        if (session === null || session.status !== 'paused') {
          return
        }
        const now = clock.now()
        set({ session: resumeSession(session, now), now })
      },

      stop: () => finish('user'),

      scheduleLeaveStop: () => {
        cancelLeave?.()
        cancelLeave = clock.schedule(() => {
          cancelLeave = null
          if (isSessionActive(get().session)) {
            finish('user')
          }
        }, 0)
      },

      cancelLeaveStop: () => {
        cancelLeave?.()
        cancelLeave = null
      },
    }
  })

  return store
}

export const measurementStore = createMeasurementStore()

export function useMeasurementStore<T>(selector: (state: MeasurementState) => T): T {
  return useStore(measurementStore, selector)
}
