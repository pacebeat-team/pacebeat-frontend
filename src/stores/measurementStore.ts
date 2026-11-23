import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createGeolocationSource } from '../features/measurement/geolocationSource.ts'
import type { GeolocationEnv, GpsSource } from '../features/measurement/geolocationSource.ts'
import { applyGpsError, createGpsTracker, processFix } from '../features/measurement/gpsTracker.ts'
import { addFix, createMetrics } from '../features/measurement/metrics.ts'
import {
  getElapsedMs,
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
import { isGpsReadyToResume } from '../features/measurement/restore.ts'
import { getBrowserStorage, loadMeasurement, saveMeasurement } from '../features/measurement/sessionPersistence.ts'
import type { StorageLike } from '../features/measurement/sessionPersistence.ts'
import { isDevBuild } from '../lib/devEnv.ts'
import { createVirtualGeolocation, SYSTEM_CLOCK } from '../features/measurement/virtualGeolocation.ts'
import type { VirtualClock } from '../features/measurement/virtualGeolocation.ts'
import { VIRTUAL_SCENARIOS } from '../features/measurement/virtualScenarios.ts'
import type { VirtualScenarioId } from '../features/measurement/virtualScenarios.ts'

// 측정 Store: 엔진의 순수 함수들을 한 줄로 잇는다.
//   GPS 공급원(실제 또는 가상) → RawFix → gpsTracker(processFix) → ValidFix → metrics(addFix) → 이 Store → 화면
// - 계산은 하지 않는다. 경과 시간, 지표, GPS 상태 같은 파생값은 저장하지 않고 화면 쪽(toMeasurementView)에서
//   엔진 함수로 그때그때 구한다. 이 Store는 원본 상태(session, tracker, metrics)와 현재 시각(now)만 가진다.
// - 실제 GPS와 가상 GPS는 같은 createGeolocationSource를 거친다. 다른 점은 geolocation 객체뿐이다.
// - 종료는 사용자 종료, 가상 시나리오 완료, 실제 GPS 측정의 목표 시간(10분) 도달 세 가지이다.
//   목표 시간은 실제 GPS 측정에만 적용하고, 일시정지한 시간은 세지 않는다. 가상 측정은 시나리오가 끝나면 끝난다.
// - 세션, 좌표 시각, 공급원은 모두 같은 시계(deps.clock, 기본 Date.now)를 쓴다.
// - 실제 GPS 측정만 저장한다(session과 metrics, localStorage). 시작, 일시정지, 재개, 종료 때와 측정 중 약 5초마다,
//   그리고 saveNow()(화면을 떠날 때 등)에서 저장한다. 저장이 실패해도 측정과 Store 상태에는 영향이 없다.
//   가상 측정은 storage를 읽지도, 쓰지도, 지우지도 않는다.
// - 새로고침 복원: hydrate()가 저장된 실제 측정을 읽어 진행 중이던 세션은 "저장 시각에 일시정지"한 상태로 복원한다.
//   (새로고침으로 비어 있던 시간은 일시정지로 처리되어 측정 시간에 들어가지 않는다.)
//   복원된 세션(needsGpsReverify)은 GPS를 다시 확인한 뒤 사용자가 resume()해야 이어진다. GPS 확인은 attach()가 시작한다.

export type RunSource =
  | { readonly kind: 'real' }
  | { readonly kind: 'virtual'; readonly scenarioId: VirtualScenarioId }

// 실제 GPS 측정의 목표(기초 측정) 시간. 일시정지 시간을 뺀 경과 시간이 이만큼 되면 자동 종료한다.
export const REAL_TARGET_DURATION_MS = 600_000

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
  // 이번(또는 마지막) 측정의 목표 시간(ms). 목표가 없는 측정(가상)이거나 측정한 적이 없으면 null
  readonly targetDurationMs: number | null
  // 새로고침으로 복원된 진행 중 세션이 아직 재개되지 않았는가. 저장하지 않는 값이다.
  readonly needsGpsReverify: boolean
}

export interface MeasurementActions {
  // 활성 세션이 있으면 아무 것도 하지 않는다(중복 시작 방지). 종료된 뒤에는 새 측정으로 초기화한다.
  // 새로고침으로 복원된 세션(아직 재개 전)은 활성으로 보지 않고, 새 측정이 그 세션을 교체한다.
  start: (options?: StartOptions) => void
  pause: () => void
  resume: () => void
  // 사용자 종료. 이미 종료됐으면 아무 것도 하지 않는다.
  stop: () => void
  // 측정 화면을 떠날 때 부른다. 현재 이벤트 루프가 끝난 뒤에도 세션이 활성이면 종료한다.
  // 그 사이에 cancelLeaveStop이 불리면(개발 환경 StrictMode의 즉시 재마운트) 취소한다.
  scheduleLeaveStop: () => void
  cancelLeaveStop: () => void
  // 지금 상태를 바로 저장한다(실제 GPS 측정만). 페이지를 떠나기 직전(pagehide)에 부른다. 실패해도 아무 일도 없다.
  saveNow: () => void
  // 앱 시작 때 한 번, 저장된 실제 측정을 복원한다. 이미 세션이 있거나 저장분이 없으면 아무 일도 없다.
  hydrate: () => void
  // 복원된 세션의 GPS 재확인을 시작한다(Active 화면이 열릴 때). 복원 세션이 아니면 아무 일도 없고, 여러 번 불러도 한 번만 시작한다.
  attach: () => void
  // 페이지를 떠나는 중(pagehide)이면 true. 이 동안에는 예약된 화면 이탈 종료를 실행하지 않아 새로고침이 세션을 끝내지 않는다.
  setUnloading: (unloading: boolean) => void
}

export type MeasurementState = MeasurementData & MeasurementActions

export interface MeasurementDeps {
  // 현재 시각과 일회성 타이머. 테스트는 수동 시계를 넣는다.
  readonly clock: VirtualClock
  // 실제 GPS 모드의 실행 환경. 기본값은 브라우저(navigator.geolocation)이다.
  readonly realEnv?: () => GeolocationEnv
  // 실제 GPS 측정을 저장할 곳. 없으면 저장하지 않는다. (앱은 localStorage, 테스트는 가짜)
  readonly storage?: StorageLike | null
  // 가상 GPS를 시작할 수 있는가. 기본값은 개발 빌드 여부(isDevBuild)이다. false이면 start({ virtual })가 와도 가상 공급원을 만들지 않고 실제 GPS로 시작한다.
  readonly allowVirtual?: boolean
}

const TICK_MS = 500
// 측정 중 저장 간격(ms)
const SAVE_INTERVAL_MS = 5000

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
// - ?virtual=steady|stop-and-go|gps-lost|gps-glitch : 가상 GPS로 측정한다. 개발 환경(isDev)에서만 켜진다. 배포 환경에서는 무시한다.
//   값 없이 ?virtual이면 steady. 모르는 값이면 가상 모드를 켜지 않는다(실제 GPS).
// - ?scenario=... : Mock(예시) 데이터. 개발 환경(isDev)에서만 켜진다. ?virtual이 함께 있으면 ?virtual이 우선한다.
export interface UrlMode {
  readonly virtual: VirtualScenarioId | null
  readonly mock: boolean
}

export function parseUrlMode(search: string, isDev: boolean): UrlMode {
  // 가상 GPS도 Mock과 같이 개발 환경에서만 켠다. 배포 환경에서는 주소에 ?virtual이 있어도 무시한다(실제 GPS).
  const virtual = isDev ? parseVirtualParam(search) : null
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
  targetDurationMs: null,
  needsGpsReverify: false,
}

export function createMeasurementStore(deps: MeasurementDeps = { clock: SYSTEM_CLOCK }) {
  const { clock } = deps
  const allowVirtual = deps.allowVirtual ?? isDevBuild()

  // 직렬화할 필요도, 화면을 다시 그릴 필요도 없는 것들은 상태가 아니라 클로저에 둔다.
  let source: GpsSource | null = null
  let cancelTick: (() => void) | null = null
  let cancelLeave: (() => void) | null = null
  let cancelTarget: (() => void) | null = null
  let lastSavedAt = 0
  let unloading = false
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

    // 실제 GPS 측정의 session과 metrics를 저장한다. 가상 측정과 측정 전에는 storage를 건드리지 않는다.
    // 저장 실패는 무시한다(측정과 Store 상태에 영향을 주지 않는다).
    function persist(): void {
      const { session, metrics, runSource } = get()
      if (session === null || runSource?.kind !== 'real' || !deps.storage) {
        return
      }
      const now = clock.now()
      lastSavedAt = now
      saveMeasurement(deps.storage, { session, metrics }, now) // 던지지 않는다. 실패(false)는 무시한다.
    }

    function stopTarget(): void {
      cancelTarget?.()
      cancelTarget = null
    }

    // 목표 시간 도달 예약. 측정 중(running)일 때만 걸고, 남은 시간 = 목표 − (일시정지를 뺀) 경과 시간이다.
    // 일시정지하면 취소하고 재개할 때 남은 시간으로 다시 건다.
    function armTarget(): void {
      stopTarget()
      const { session, targetDurationMs } = get()
      if (session === null || session.status !== 'running' || targetDurationMs === null) {
        return
      }
      const remaining = targetDurationMs - getElapsedMs(session, clock.now())
      cancelTarget = clock.schedule(() => {
        cancelTarget = null
        const current = get().session
        if (current === null || current.status !== 'running') {
          return
        }
        // 타이머가 늦게 불려도 종료 시각은 목표 시각에 맞춘다(경과 시간이 목표를 넘지 않게).
        const now = clock.now()
        const over = getElapsedMs(current, now) - targetDurationMs
        finish('auto', over > 0 ? now - over : now)
      }, Math.max(0, remaining))
    }

    function startTick(): void {
      cancelTick = clock.schedule(() => {
        cancelTick = null
        if (!isSessionActive(get().session)) {
          return
        }
        set({ now: clock.now() })
        // 주기 저장은 측정 중에만 한다. 일시정지 상태는 바뀌지 않았고, 다시 저장하면 저장 시각이 늘어난다.
        if (get().session?.status === 'running' && clock.now() - lastSavedAt >= SAVE_INTERVAL_MS) {
          persist()
        }
        startTick()
      }, TICK_MS)
    }

    // 세션을 끝내고 공급원과 타이머를 정리한다. 사용자 종료와 가상 완료가 모두 이 한 곳을 지나므로
    // 어느 쪽이든 같은 종료 상태(status 'finished')가 만들어진다.
    function finish(reason: SessionEndReason, endAt: number = clock.now()): void {
      const session = get().session
      if (session === null || session.status === 'finished') {
        return
      }
      const ended = stopSession(session, endAt, reason)
      set({ session: ended, now: ended.endedAt ?? clock.now(), needsGpsReverify: false })
      stopSource()
      stopTick()
      stopTarget()
      persist()
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
        if (isSessionActive(get().session) && !get().needsGpsReverify) {
          return
        }
        // 이전 측정이 남긴 정리 예약, 공급원, 타이머를 비운다.
        cancelLeave?.()
        cancelLeave = null
        stopSource()
        stopTick()
        stopTarget()

        const now = clock.now()
        // 가상 GPS의 최종 관문: 허용되지 않은 환경(배포)에서는 가상을 요청해도 실제 GPS로 시작한다. (가상 공급원·타이머를 만들지 않는다.)
        const runSource: RunSource =
          options.virtual === undefined || !allowVirtual
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
          targetDurationMs: runSource.kind === 'real' ? REAL_TARGET_DURATION_MS : null,
          needsGpsReverify: false,
        })
        persist()
        armTarget()
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
        stopTarget()
        persist()
      },

      resume: () => {
        const session = get().session
        if (session === null || session.status !== 'paused') {
          return
        }
        const now = clock.now()
        // 복원된 세션은 GPS가 다시 확인되기 전에는 재개하지 않는다.
        if (get().needsGpsReverify && !isGpsReadyToResume(get().tracker, now)) {
          return
        }
        set({ session: resumeSession(session, now), now, needsGpsReverify: false })
        armTarget()
        persist()
      },

      stop: () => finish('user'),

      scheduleLeaveStop: () => {
        cancelLeave?.()
        cancelLeave = clock.schedule(() => {
          cancelLeave = null
          // 페이지를 떠나는 중(새로고침, 탭 닫기)에는 종료하지 않는다. 화면 이동(SPA)일 때만 종료한다.
          if (!unloading && isSessionActive(get().session)) {
            finish('user')
          }
        }, 0)
      },

      cancelLeaveStop: () => {
        cancelLeave?.()
        cancelLeave = null
      },

      saveNow: () => {
        // 종료된 세션은 종료할 때 이미 저장했다. 다시 저장하면 저장 시각이 갱신되어 보관 기간이 늘어나므로 건너뛴다.
        if (get().session?.status === 'running') {
          persist()
        }
      },

      setUnloading: (value) => {
        unloading = value
      },

      hydrate: () => {
        if (get().session !== null) {
          return
        }
        const now = clock.now()
        const saved = loadMeasurement(deps.storage, now)
        if (saved === null) {
          return
        }
        const { session, metrics } = saved
        const realSource: RunSource = { kind: 'real' }
        const common = { tracker: createGpsTracker(), now, runSource: realSource }
        if (session.status === 'finished') {
          set({ ...common, session, metrics, targetDurationMs: REAL_TARGET_DURATION_MS, needsGpsReverify: false })
          return
        }
        // 진행 중이던 세션은 저장 시각에 일시정지한 것으로 본다. 그 뒤 새로고침으로 비어 있던 시간은 세지 않는다.
        // 직전 좌표와 최근 구간은 비워서, 재개 뒤 첫 좌표가 새 구간의 시작이 되게 한다. 누적 거리와 시간은 유지한다.
        set({
          ...common,
          session: session.status === 'running' ? pauseSession(session, saved.savedAt) : session,
          metrics: { ...metrics, lastFix: null, recent: [] },
          targetDurationMs: REAL_TARGET_DURATION_MS,
          needsGpsReverify: true,
        })
      },

      attach: () => {
        const { session, needsGpsReverify } = get()
        if (!needsGpsReverify || !isSessionActive(session) || source !== null) {
          return
        }
        startTick()
        source = createSource({ kind: 'real' })
        source.start()
      },
    }
  })

  return store
}

export const measurementStore = createMeasurementStore({ clock: SYSTEM_CLOCK, storage: getBrowserStorage() })

export function useMeasurementStore<T>(selector: (state: MeasurementState) => T): T {
  return useStore(measurementStore, selector)
}
