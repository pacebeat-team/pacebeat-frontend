import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { createGeolocationSource } from '../measurement/geolocationSource.ts'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import { applyGpsError, getGpsStatus, processFix } from '../measurement/gpsTracker.ts'
import { createSessionId } from '../measurement/session.ts'
import type { GpsErrorReason, RawFix } from '../measurement/types.ts'
import { isGoalReached } from './policy.ts'
import { createGpsRunState, feedGpsFix, getGpsRunMetrics, getTimeRunMetrics } from './runMetrics.ts'
import type { GpsRunState, RunLiveMetrics } from './runMetrics.ts'
import { getRunElapsedMs } from './runSession.ts'
import type { RunEndReason } from './runSession.ts'
import { runStore } from './runStore.ts'
import type { RunStoreState } from './runStore.ts'
import type { RunMode } from './types.ts'

// 러닝 실행 중 상태(저장하지 않는 값)와 위치 수집 연결.
// - 세션·목표·거리 샘플·GPS 끊김 구간은 runStore가 가진다(진행 중에는 메모리에만 있다). 여기서는 좌표 검증 상태(tracker)·누적 거리(metrics)·현재 시각만 가진다.
// - 위치 수집은 화면(React)이 아니라 이 컨트롤러가 소유한다. 다른 탭으로 이동해도 세션과 수집이 이어진다.
// - 목표 거리 도달은 좌표를 받는 사건에서만 판정한다(타이머 없음). 도달하면 세션을 한 번만 'goal'로 종료한다.
// - TIME 모드는 위치 수집을 시작하지 않는다.
// - GPS가 끊겨도(신호 끊김·권한 회수·위치 서비스 꺼짐) 모드를 바꾸거나 일시정지하지 않는다. 끊긴 구간을 gpsGaps에 남기고,
//   거리는 유효 좌표로만 늘어나며 복구되면 새 구간으로 이어간다.
// - 웹 앱의 한계: 화면이 꺼지거나 앱이 백그라운드에 있는 동안의 위치 수집은 보장되지 않는다. 시간은 시계로 계속 흐르고
//   거리는 받은 좌표로만 늘어난다. 화면이 다시 보이면 위치 구독을 새로 연결한다.

// 화면이 다른 탭에 있어도 GPS 끊김을 확인하는 주기(ms)
export const HEARTBEAT_MS = 5000

export interface RunLiveData {
  readonly gps: GpsRunState
  // 화면 갱신용 현재 시각(epoch ms). 시계(1초 틱)가 tick으로 갱신한다.
  readonly now: number
}

// 위치 권한 상태. unknown: 알 수 없음(Permissions API 미지원 등)
export type GpsPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface RunLiveDeps {
  readonly store?: StoreApi<RunStoreState>
  // 위치 권한 상태를 읽는다. 상태가 바뀌면 onChange를 부른다. 기본은 navigator.permissions.
  readonly queryPermission?: (onChange: (state: GpsPermission) => void) => Promise<GpsPermission>
  readonly now?: () => number
  readonly createSource?: (handlers: GpsSourceHandlers) => GpsSource
  readonly createId?: () => string
  // 화면이 다시 보일 때 호출되는 콜백을 등록한다. 해제 함수를 돌려준다. 기본은 document의 visibilitychange.
  readonly listenVisible?: (callback: () => void) => () => void
  // 끊김 확인 타이머. 기본은 setInterval(진행 중에만 켠다). false면 쓰지 않는다(테스트는 heartbeat를 직접 부른다).
  readonly autoHeartbeat?: boolean
}

export interface PrepareOptions {
  // 위치를 쓸 수 없어(권한 거부·비보안·미지원) 시작할 수 없을 때 호출한다.
  readonly onUnavailable: (reason: GpsErrorReason) => void
}

function defaultListenVisible(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  const handler = () => {
    if (document.visibilityState === 'visible') callback()
  }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}

async function defaultQueryPermission(onChange: (state: GpsPermission) => void): Promise<GpsPermission> {
  try {
    if (typeof navigator === 'undefined' || navigator.permissions === undefined) return 'unknown'
    const status = await navigator.permissions.query({ name: 'geolocation' })
    status.onchange = () => onChange(status.state as GpsPermission)
    return status.state as GpsPermission
  } catch {
    return 'unknown'
  }
}

export function createRunLive(deps: RunLiveDeps = {}) {
  const runs = deps.store ?? runStore
  const clock = deps.now ?? Date.now
  const createSource = deps.createSource ?? ((handlers) => createGeolocationSource(handlers))
  const createId = deps.createId ?? createSessionId
  const listenVisible = deps.listenVisible ?? defaultListenVisible
  const autoHeartbeat = deps.autoHeartbeat ?? true
  const queryPermission = deps.queryPermission ?? defaultQueryPermission

  const live = createStore<RunLiveData>()(() => ({ gps: createGpsRunState(), now: clock() }))
  let source: GpsSource | null = null
  let onUnavailable: ((reason: GpsErrorReason) => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let unlistenVisible: (() => void) | null = null
  // 시작 준비(카운트다운) 한 번을 가리키는 번호. 늦게 도착한 권한 응답이 다음 준비·시작에 영향을 주지 않게 한다.
  let prepareId = 0
  let permission: GpsPermission = 'unknown'
  // 이번 준비·세션에서 위치(좌표) 신호를 한 번이라도 받았다 = 권한이 허용됐다.
  let gotSignal = false

  // 위치를 쓸 수 없어 시작하지 못한다고 알린다(세션 시작 전에만).
  function failPrepare(reason: GpsErrorReason): void {
    const notify = onUnavailable
    if (notify === null) return
    prepareId += 1
    stopSource()
    live.setState({ gps: createGpsRunState() })
    notify(reason)
  }

  function stopSource(): void {
    const current = source
    source = null
    onUnavailable = null
    current?.stop()
  }

  function startSource(): void {
    source = createSource({ onFix: handleFix, onError: handleError })
    source.start()
  }

  // 러닝 경과 시간(ms, 일시정지 제외)
  function elapsedAt(at: number): number {
    const active = runs.getState().activeSession
    return active === null ? 0 : getRunElapsedMs(active.session, Math.max(at, active.session.startedAt))
  }

  // 진행 중인 GPS 러닝에서 신호가 끊겼는지 보고 끊김 구간을 연다. 닫는 일(복구)은 좌표를 받을 때 한다.
  function syncGaps(now: number): void {
    const active = runs.getState().activeSession
    if (active === null || active.mode !== 'gps' || active.session.status !== 'running') return
    const { tracker } = live.getState().gps
    const status = getGpsStatus(tracker, now)
    // 처음 좌표를 기다리는 동안(status null, 거리 없음)은 끊긴 것이 아니다. 거리를 쌓은 뒤의 검색 중은 끊김이다.
    const lost = status === 'lost' || status === 'unavailable' || (status === null && active.distanceSamples.length > 0)
    if (!lost) return
    const last = active.gpsGaps[active.gpsGaps.length - 1]
    if (last !== undefined && last.recoveredAtMs === null) return
    const lostAt = status === 'lost' && tracker.anchor !== null ? tracker.anchor.at : now
    runs.getState().openGpsGap(elapsedAt(lostAt))
  }

  function handleFix(fix: RawFix): void {
    gotSignal = true
    permission = 'granted'
    const active = runs.getState().activeSession
    const session = active !== null && active.session.status === 'running' ? active.session : null
    if (active === null || session === null || active.mode !== 'gps') {
      // 시작 전(카운트다운)·일시정지 중: 좌표 검증 상태만 갱신하고 거리에는 반영하지 않는다.
      // (재개 후 첫 좌표는 metrics가 새 구간으로 시작한다.)
      live.setState(({ gps }) => ({ gps: { ...gps, tracker: processFix(gps.tracker, fix).state } }))
      return
    }
    // 이 좌표를 받기 전에 이미 끊겨 있었는지 먼저 본다(타이머가 늦거나 멈춰 있던 동안의 끊김도 남긴다).
    syncGaps(fix.receivedAt)
    const fed = feedGpsFix(live.getState().gps, fix, session)
    live.setState({ gps: fed.state })
    if (!fed.result.accepted) return
    // 유효 좌표를 받았으면 열려 있던 끊김 구간을 복구 시각으로 닫는다.
    runs.getState().closeGpsGap(elapsedAt(fed.result.fix.at))
    const metrics = getGpsRunMetrics(fed.state, session, fed.result.fix.at)
    const distanceM = metrics.distanceM ?? 0
    runs.getState().recordDistanceSample(metrics.elapsedMs, distanceM)
    if (isGoalReached('gps', active.goal, distanceM)) {
      // 목표 도달: 한 번만 종료한다(종료 후에는 status가 running이 아니므로 다시 오지 않는다).
      stopRunInternal(fed.result.fix.at, 'goal')
    }
  }

  function handleError(reason: GpsErrorReason): void {
    live.setState(({ gps }) => ({ gps: { ...gps, tracker: applyGpsError(gps.tracker, reason) } }))
    const active = runs.getState().activeSession
    const unavailable = reason === 'permission-denied' || reason === 'insecure-context' || reason === 'unsupported'
    // 세션 시작 전(카운트다운) 위치를 쓸 수 없으면 시작하지 않고 알린다.
    if (unavailable && active === null && onUnavailable !== null) {
      failPrepare(reason)
      return
    }
    // 시작한 뒤의 권한 거부(달리는 도중 회수 포함)는 세션·모드를 바꾸지 않고 끊김 구간으로만 남긴다(기존 계약).
    syncGaps(clock())
  }

  function heartbeat(): void {
    syncGaps(clock())
  }

  function startMonitoring(): void {
    if (autoHeartbeat && heartbeatTimer === null) {
      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
      ;(heartbeatTimer as { unref?: () => void }).unref?.()
    }
    if (unlistenVisible === null) unlistenVisible = listenVisible(handleVisible)
  }

  function stopMonitoring(): void {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    unlistenVisible?.()
    unlistenVisible = null
  }

  // 화면이 다시 보이면: 시각을 갱신하고, 진행 중인 GPS 러닝은 위치 구독을 새로 연결한다(백그라운드에서 끊겼을 수 있다).
  function handleVisible(): void {
    const now = clock()
    live.setState({ now })
    const active = runs.getState().activeSession
    if (active !== null && active.mode === 'gps' && active.session.status === 'running') {
      stopSource()
      startSource()
    }
    heartbeat()
  }

  function stopRunInternal(now: number, reason: RunEndReason): void {
    runs.getState().stopRun(now, reason)
    stopSource()
    stopMonitoring()
  }

  return {
    live,
    // GPS 모드 시작 전 준비(카운트다운 동안): 위치 수집을 시작해 권한을 요청한다. TIME 모드에서는 호출하지 않는다.
    prepare(options: PrepareOptions): void {
      stopSource()
      prepareId += 1
      const id = prepareId
      permission = 'unknown'
      gotSignal = false
      live.setState({ gps: createGpsRunState(), now: clock() })
      onUnavailable = options.onUnavailable
      startSource()
      // 권한 상태를 확인한다. 응답이 오기 전에 다음 준비가 시작됐거나 취소됐으면 무시한다.
      const apply = (state: GpsPermission) => {
        if (id !== prepareId) return
        if (permission !== 'granted') permission = state
        if (state === 'denied' && !gotSignal) failPrepare('permission-denied')
      }
      void queryPermission(apply).then(apply)
    },
    // 시작해도 되는가: 권한 응답을 기다리는 중(prompt)이면 'waiting'. 카운트다운은 이 동안 끝나도 시작하지 않고 기다린다.
    // 권한을 확인할 수 없는 환경(unknown)이나 이미 허용된 경우는 'ready'(첫 위치를 얻는 데 걸리는 시간은 기다리지 않는다).
    gpsStartState(): 'ready' | 'waiting' {
      return permission === 'prompt' && !gotSignal ? 'waiting' : 'ready'
    },
    // 카운트다운을 취소한다(세션은 시작하지 않았다).
    cancelPrepare(): void {
      prepareId += 1
      stopSource()
      live.setState({ gps: createGpsRunState(), now: clock() })
    },
    // 세션을 시작한다. GPS는 prepare에서 시작한 수집을 이어 쓰고, TIME은 위치 수집이 없다.
    begin(mode: RunMode): void {
      const now = clock()
      // 시작한 뒤에는 준비 단계의 늦은 권한 응답이 영향을 주지 못하게 한다.
      prepareId += 1
      onUnavailable = null
      runs.getState().startRun(mode, now, createId)
      live.setState({ now })
      if (mode === 'time') stopSource()
      else if (source === null || !source.isRunning) {
        // 준비 없이 시작한 경우의 안전장치: 수집을 지금 시작한다.
        onUnavailable = null
        startSource()
      }
      startMonitoring()
    },
    pause(): void {
      const now = clock()
      runs.getState().pauseRun(now)
      live.setState({ now })
      stopMonitoring()
    },
    // 같은 세션을 이어간다. 일시정지 중 위치 구독이 멈춰 있으면 이때 다시 시작해 위치를 재확인한다.
    resume(): void {
      const now = clock()
      const active = runs.getState().activeSession
      runs.getState().resumeRun(now)
      live.setState({ now })
      if (active !== null && active.mode === 'gps' && (source === null || !source.isRunning)) {
        onUnavailable = null
        startSource()
      }
      startMonitoring()
      syncGaps(now)
    },
    stop(reason: RunEndReason = 'user'): void {
      const now = clock()
      stopRunInternal(now, reason)
      live.setState({ now })
    },
    heartbeat,
    tick(): void {
      const now = clock()
      live.setState({ now })
      syncGaps(now)
    },
  }
}

export const runLive = createRunLive()

export function useRunLive<T>(selector: (state: RunLiveData) => T): T {
  return useStore(runLive.live, selector)
}

// 화면에 보일 지표(저장하지 않는 파생값).
export function selectLiveMetrics(
  active: RunStoreState['activeSession'],
  gps: GpsRunState,
  now: number,
): RunLiveMetrics | null {
  if (active === null) return null
  const at = active.session.status === 'finished' && active.session.endedAt !== null ? active.session.endedAt : now
  return active.mode === 'gps' ? getGpsRunMetrics(gps, active.session, at) : getTimeRunMetrics(active.session, at)
}
