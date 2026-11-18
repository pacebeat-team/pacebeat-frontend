import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { clampDurationSec, rescaleDurationSec } from './goal.ts'
import { NO_GOAL } from './record.ts'
import { isRunActive, pauseRun, resumeRun, startRun, stopRun } from './runSession.ts'
import type { RunEndReason } from './runSession.ts'
import { appendDistanceSample } from './splits.ts'
import { createRunStorage } from './runStorage.ts'
import type { RecentGoal, RunDraft, RunSessionSnapshot, RunStorage } from './runStorage.ts'
import type { DistanceSample, GoalDistanceKm, RunMode } from './types.ts'

// 일반 RUN 전용 Store.
// - 기초 측정 Store(measurementStore)·온보딩 Store와 독립이다. 서로 읽거나 쓰지 않는다.
// - 목표 draft·최근 목표·선택 음악, 활성 세션 상태를 가진다. 파생값(경과 시간, 페이스 등)은 저장하지 않는다.
// - 저장은 전용 키(pacebeat:run:*:v1)에만 한다. 저장이 실패해도 메모리 상태는 유지한다(예외를 던지지 않는다).
//   저장 실패를 알아야 하는 기록 저장(records)은 Store가 아니라 RunStorage.saveRecord를 직접 쓴다.
// - 저장된 세션은 생성할 때 읽어 넣지 않는다.

const MAX_RECENT_GOALS = 2

// 진행 중 세션을 저장소에 쓰는 정책.
// - 상태 전환(시작·일시정지·재개·종료·끊김 구간·복원)은 바로 쓴다. 잃으면 안 되는 경계이다.
// - 거리 샘플·마지막 확인 시각만 바뀌는 잦은 갱신(GPS fix마다)은 SESSION_SAVE_MIN_MS 안에서는 모았다가 한 번에 쓴다.
//   모아 둔 변경은 타이머 또는 flushSession()(화면이 숨겨질 때·pagehide)으로 반드시 쓴다.
export const SESSION_SAVE_MIN_MS = 2000
// 거리 샘플이 이만큼을 넘으면 앞쪽 기록을 성기게 한다(처음·마지막 샘플은 유지). 1초 간격으로 약 1시간 분량.
export const MAX_DISTANCE_SAMPLES = 3600

// 앞쪽 샘플을 성기게 한다: 홀수 번째를 버리되, 처음·마지막 샘플과 1km 경계를 감싸는 두 샘플은 반드시 남긴다.
// 구간별 기록은 1km 경계를 샘플 사이 보간으로 구하므로, 경계 양옆 샘플이 남아 있으면 여러 번 성기게 해도(몇 시간 러닝)
// 구간 시간이 전체 샘플로 구한 값과 같다. 누적 거리·평균 페이스는 샘플이 아니라 실시간 지표와 마지막 샘플로 정해진다.
function thinSamples(samples: readonly DistanceSample[]): DistanceSample[] {
  const last = samples.length - 1
  const keep = new Set<number>([0, last])
  let nextBoundaryM = 1000
  for (let i = 0; i <= last; i += 1) {
    while (samples[i].distanceM >= nextBoundaryM) {
      keep.add(i)
      if (i > 0) keep.add(i - 1)
      nextBoundaryM += 1000
    }
  }
  return samples.filter((_, index) => index % 2 === 0 || keep.has(index))
}

export interface RunStoreData {
  readonly draft: RunDraft
  readonly activeSession: RunSessionSnapshot | null
  // 진행 중 세션을 저장소에 쓰지 못했다(용량 초과·저장 차단). 이 동안 새로고침하면 러닝이 복원되지 않을 수 있다.
  readonly persistError: boolean
}

interface RunStoreActions {
  // 거리 프리셋을 바꾼다. 목표 페이스를 유지하도록 목표 시간을 다시 계산한다.
  setDistance: (distanceKm: GoalDistanceKm) => void
  // 목표 시간(초)을 바꾼다. 범위 안의 정수 초로 제한한다(+/- 단위 이동은 stepDurationSec).
  setTargetDuration: (durationSec: number) => void
  // 음악을 고른다. 고르지 않으면 null
  setMusicTrack: (musicTrackId: string | null) => void
  // 활성 세션(진행 중·일시정지)이 있으면 아무것도 하지 않는다. TIME 모드는 목표가 없고, GPS 모드는 draft의 목표를 쓴다.
  startRun: (mode: RunMode, now: number, createId?: () => string) => void
  pauseRun: (now: number) => void
  resumeRun: (now: number) => void
  stopRun: (now: number, reason?: RunEndReason) => void
  // 누적 거리 샘플을 추가한다(구간 계산용). 거리가 줄었거나 시간이 거꾸로 간 샘플은 버린다.
  recordDistanceSample: (elapsedMs: number, distanceM: number) => void
  // 세션 상태를 지운다(저장을 마쳤거나 폐기할 때).
  clearSession: () => void
  // 마지막으로 확인한 시각을 기록한다(진행 중 세션만). 복원 때 일시정지 시각의 기준이 된다.
  touchSession: (now: number) => void
  // GPS 신호가 끊긴 구간을 연다(러닝 경과 시간 ms). 이미 열린 구간이 있으면 아무것도 하지 않는다.
  openGpsGap: (lostAtMs: number) => void
  // 열린 끊김 구간을 복구 시각으로 닫는다.
  closeGpsGap: (recoveredAtMs: number) => void
}

export type RunStoreState = RunStoreData & RunStoreActions

export interface RunStoreOptions {
  readonly now?: () => number
  // 지연 쓰기 예약. 기본은 setTimeout
  readonly schedule?: (callback: () => void, delayMs: number) => unknown
  readonly cancel?: (handle: unknown) => void
}

export type RunStoreApi = StoreApi<RunStoreState> & {
  // 모아 둔 세션 변경을 지금 저장소에 쓴다.
  flushSession: () => void
}

function capSamples(samples: DistanceSample[]): DistanceSample[] {
  return samples.length > MAX_DISTANCE_SAMPLES ? thinSamples(samples) : samples
}

function pushRecentGoal(recent: readonly RecentGoal[], goal: RecentGoal): RecentGoal[] {
  const others = recent.filter(
    (item) => !(item.distanceKm === goal.distanceKm && item.targetDurationSec === goal.targetDurationSec),
  )
  return [goal, ...others].slice(0, MAX_RECENT_GOALS)
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다.
export function createRunStore(storage: RunStorage = createRunStorage(), options: RunStoreOptions = {}): RunStoreApi {
  const clock = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  })
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const store = createStore<RunStoreState>()((set, get) => ({
    draft: storage.loadDraft(),
    activeSession: null,
    persistError: false,

    setDistance: (distanceKm) =>
      set(({ draft }) => ({
        draft: {
          ...draft,
          distanceKm,
          targetDurationSec: rescaleDurationSec(draft.distanceKm, draft.targetDurationSec, distanceKm),
        },
      })),
    setTargetDuration: (durationSec) =>
      set(({ draft }) => ({ draft: { ...draft, targetDurationSec: clampDurationSec(draft.distanceKm, durationSec) } })),
    setMusicTrack: (musicTrackId) => set(({ draft }) => ({ draft: { ...draft, musicTrackId } })),

    startRun: (mode, now, createId) => {
      const current = get().activeSession
      if (current !== null && isRunActive(current.session)) return
      if (!Number.isFinite(now)) return
      const { draft } = get()
      const session = startRun(null, now, createId)
      const isGps = mode === 'gps'
      set({
        activeSession: {
          mode,
          goal: isGps ? { targetDistanceKm: draft.distanceKm, targetDurationSec: draft.targetDurationSec } : NO_GOAL,
          musicTrackId: draft.musicTrackId,
          session,
          distanceSamples: [],
          gpsGaps: [],
          lastSeenAt: null,
        },
        draft: isGps
          ? {
              ...draft,
              recentGoals: pushRecentGoal(draft.recentGoals, {
                distanceKm: draft.distanceKm,
                targetDurationSec: draft.targetDurationSec,
              }),
            }
          : draft,
      })
    },
    pauseRun: (now) =>
      set(({ activeSession }) =>
        activeSession === null
          ? {}
          : { activeSession: { ...activeSession, session: pauseRun(activeSession.session, now), lastSeenAt: Number.isFinite(now) ? now : activeSession.lastSeenAt } },
      ),
    resumeRun: (now) =>
      set(({ activeSession }) =>
        activeSession === null
          ? {}
          : { activeSession: { ...activeSession, session: resumeRun(activeSession.session, now), lastSeenAt: Number.isFinite(now) ? now : activeSession.lastSeenAt } },
      ),
    stopRun: (now, reason = 'user') =>
      set(({ activeSession }) =>
        activeSession === null
          ? {}
          : { activeSession: { ...activeSession, session: stopRun(activeSession.session, now, reason) } },
      ),
    recordDistanceSample: (elapsedMs, distanceM) =>
      set(({ activeSession }) =>
        activeSession === null || activeSession.mode === 'time'
          ? {}
          : {
              activeSession: {
                ...activeSession,
                distanceSamples: capSamples(appendDistanceSample(activeSession.distanceSamples, { elapsedMs, distanceM })),
              },
            },
      ),
    clearSession: () => set({ activeSession: null }),
    touchSession: (now) =>
      set(({ activeSession }) =>
        activeSession === null || activeSession.session.status !== 'running' || !Number.isFinite(now)
          ? {}
          : { activeSession: { ...activeSession, lastSeenAt: now } },
      ),
    openGpsGap: (lostAtMs) =>
      set(({ activeSession }) => {
        if (activeSession === null || activeSession.mode !== 'gps' || !Number.isFinite(lostAtMs)) return {}
        const last = activeSession.gpsGaps[activeSession.gpsGaps.length - 1]
        if (last !== undefined && last.recoveredAtMs === null) return {}
        return { activeSession: { ...activeSession, gpsGaps: [...activeSession.gpsGaps, { lostAtMs, recoveredAtMs: null }] } }
      }),
    closeGpsGap: (recoveredAtMs) =>
      set(({ activeSession }) => {
        if (activeSession === null || !Number.isFinite(recoveredAtMs)) return {}
        const last = activeSession.gpsGaps[activeSession.gpsGaps.length - 1]
        if (last === undefined || last.recoveredAtMs !== null) return {}
        const closed = { ...last, recoveredAtMs: Math.max(recoveredAtMs, last.lostAtMs) }
        return { activeSession: { ...activeSession, gpsGaps: [...activeSession.gpsGaps.slice(0, -1), closed] } }
      }),
  }))

  // 세션 저장: 전환은 바로, 잦은 갱신은 모아서 쓴다(위 정책). 쓰기에 실패하면 persistError로 알린다(메모리 상태는 유지).
  let dirty = false
  let lastWriteAt = Number.NEGATIVE_INFINITY
  let timer: unknown = null

  function writeSession(): void {
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
    dirty = false
    const { activeSession } = store.getState()
    try {
      if (activeSession === null) storage.clearSession()
      else storage.saveSession(activeSession)
      lastWriteAt = clock()
      if (store.getState().persistError) store.setState({ persistError: false })
    } catch {
      lastWriteAt = clock()
      if (!store.getState().persistError) store.setState({ persistError: true })
    }
  }

  function flushSession(): void {
    if (dirty) writeSession()
  }

  store.subscribe((state, previous) => {
    try {
      if (state.draft !== previous.draft) storage.saveDraft(state.draft)
    } catch {
      // draft 저장 실패는 무시한다(메모리 상태 유지).
    }
    if (state.activeSession === previous.activeSession) return
    const now = state.activeSession
    const before = previous.activeSession
    const frequentOnly =
      now !== null &&
      before !== null &&
      now.session === before.session &&
      now.gpsGaps === before.gpsGaps &&
      now.goal === before.goal &&
      now.mode === before.mode
    if (!frequentOnly) {
      writeSession()
      return
    }
    dirty = true
    const wait = SESSION_SAVE_MIN_MS - (clock() - lastWriteAt)
    if (wait <= 0) writeSession()
    else if (timer === null) timer = schedule(() => {
      timer = null
      flushSession()
    }, wait)
  })

  return Object.assign(store, { flushSession })
}

export const runStore = createRunStore()

export function useRunStore<T>(selector: (state: RunStoreState) => T): T {
  return useStore(runStore, selector)
}
