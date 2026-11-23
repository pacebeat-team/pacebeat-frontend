import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { clampDurationSec, rescaleDurationSec } from './goal.ts'
import { NO_GOAL } from './record.ts'
import { normalizeRunGuidance } from './runGuidance.ts'
import type { RunGuidance } from './runGuidance.ts'
import { isRunActive, pauseRun, resumeRun, startRun, stopRun } from './runSession.ts'
import type { RunEndReason } from './runSession.ts'
import { appendDistanceSample } from './splits.ts'
import { createRunStorage } from './runStorage.ts'
import type { RecentGoal, RunDraft, RunSessionSnapshot, RunStorage } from './runStorage.ts'
import type { GoalDistanceKm, RunMode } from './types.ts'

// 일반 RUN 전용 Store.
// - 기초 측정 Store(measurementStore)·온보딩 Store와 독립이다. 서로 읽거나 쓰지 않는다.
// - 목표 draft·최근 목표·선택 음악, 활성 세션 상태를 가진다. 파생값(경과 시간, 페이스 등)은 저장하지 않는다.
// - 저장하는 것은 목표 draft뿐이다(전용 키 pacebeat:run:draft:v1, 실패해도 메모리 상태는 유지한다).
//   진행 중 세션은 메모리에만 있고 저장하지 않는다. 완료한 러닝의 기록(records)은 RunStorage.saveRecord를 직접 쓴다.

const MAX_RECENT_GOALS = 2

export interface RunStoreData {
  readonly draft: RunDraft
  readonly activeSession: RunSessionSnapshot | null
}

interface RunStoreActions {
  // 거리 프리셋을 바꾼다. 목표 페이스를 유지하도록 목표 시간을 다시 계산한다.
  setDistance: (distanceKm: GoalDistanceKm) => void
  // 목표 시간(초)을 바꾼다. 범위 안의 정수 초로 제한한다(+/- 단위 이동은 stepDurationSec).
  setTargetDuration: (durationSec: number) => void
  // 음악을 고른다. 고르지 않으면 null
  setMusicTrack: (musicTrackId: string | null) => void
  // 활성 세션(진행 중·일시정지)이 있으면 아무것도 하지 않는다. TIME 모드는 목표가 없고, GPS 모드는 draft의 목표를 쓴다.
  // guidance: 시작 시점의 안내 설정. 세션에 고정되며 이후 설정이 바뀌어도 이 세션은 바뀌지 않는다. 없으면 스냅샷 없이 시작한다(기본값으로 읽힌다).
  startRun: (mode: RunMode, now: number, createId?: () => string, guidance?: RunGuidance) => void
  pauseRun: (now: number) => void
  // 자동 일시정지: 진행 중일 때만 멈추고 autoPaused 표시를 남긴다. 재개는 resumeRun(사용자 버튼)뿐이다.
  autoPauseRun: (now: number) => void
  resumeRun: (now: number) => void
  stopRun: (now: number, reason?: RunEndReason) => void
  // 누적 거리 샘플을 추가한다(구간 계산용). 거리가 줄었거나 시간이 거꾸로 간 샘플은 버린다.
  recordDistanceSample: (elapsedMs: number, distanceM: number) => void
  // 세션 상태를 지운다(저장을 마쳤거나 폐기할 때).
  clearSession: () => void
  // GPS 신호가 끊긴 구간을 연다(러닝 경과 시간 ms). 이미 열린 구간이 있으면 아무것도 하지 않는다.
  openGpsGap: (lostAtMs: number) => void
  // 열린 끊김 구간을 복구 시각으로 닫는다.
  closeGpsGap: (recoveredAtMs: number) => void
}

export type RunStoreState = RunStoreData & RunStoreActions

export type RunStoreApi = StoreApi<RunStoreState>

// 자동 일시정지 표시를 지운다(재개·종료 때).
function withoutAutoPaused(snapshot: RunSessionSnapshot): RunSessionSnapshot {
  const copy: { -readonly [K in keyof RunSessionSnapshot]: RunSessionSnapshot[K] } = { ...snapshot }
  delete copy.autoPaused
  return copy
}

function pushRecentGoal(recent: readonly RecentGoal[], goal: RecentGoal): RecentGoal[] {
  const others = recent.filter(
    (item) => !(item.distanceKm === goal.distanceKm && item.targetDurationSec === goal.targetDurationSec),
  )
  return [goal, ...others].slice(0, MAX_RECENT_GOALS)
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다.
export function createRunStore(storage: RunStorage = createRunStorage()): RunStoreApi {
  const store = createStore<RunStoreState>()((set, get) => ({
    draft: storage.loadDraft(),
    activeSession: null,

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

    startRun: (mode, now, createId, guidance) => {
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
          ...(guidance === undefined ? {} : { guidance: normalizeRunGuidance(guidance) }),
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
      set(({ activeSession }) => {
        if (activeSession === null) return {}
        // 수동 일시정지. 이미 자동으로 멈춰 있으면 session은 그대로이고(중복 구간 없음) 자동 표시만 남는다.
        return { activeSession: { ...activeSession, session: pauseRun(activeSession.session, now) } }
      }),
    autoPauseRun: (now) =>
      set(({ activeSession }) =>
        activeSession === null || activeSession.mode !== 'gps' || activeSession.session.status !== 'running'
          ? {}
          : { activeSession: { ...activeSession, session: pauseRun(activeSession.session, now), autoPaused: true } },
      ),
    resumeRun: (now) =>
      set(({ activeSession }) => {
        if (activeSession === null) return {}
        return { activeSession: withoutAutoPaused({ ...activeSession, session: resumeRun(activeSession.session, now) }) }
      }),
    stopRun: (now, reason = 'user') =>
      set(({ activeSession }) => {
        if (activeSession === null) return {}
        return { activeSession: withoutAutoPaused({ ...activeSession, session: stopRun(activeSession.session, now, reason) }) }
      }),
    recordDistanceSample: (elapsedMs, distanceM) =>
      set(({ activeSession }) =>
        activeSession === null || activeSession.mode === 'time'
          ? {}
          : {
              activeSession: {
                ...activeSession,
                distanceSamples: appendDistanceSample(activeSession.distanceSamples, { elapsedMs, distanceM }),
              },
            },
      ),
    clearSession: () => set({ activeSession: null }),
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

  store.subscribe((state, previous) => {
    try {
      if (state.draft !== previous.draft) storage.saveDraft(state.draft)
    } catch {
      // draft 저장 실패는 무시한다(메모리 상태 유지).
    }
  })

  return store
}

export const runStore = createRunStore()

export function useRunStore<T>(selector: (state: RunStoreState) => T): T {
  return useStore(runStore, selector)
}
