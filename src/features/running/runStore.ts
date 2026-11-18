import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { clampDurationSec, rescaleDurationSec } from './goal.ts'
import { NO_GOAL } from './record.ts'
import { isRunActive, pauseRun, resumeRun, startRun, stopRun } from './runSession.ts'
import type { RunEndReason } from './runSession.ts'
import { appendDistanceSample } from './splits.ts'
import { createRunStorage } from './runStorage.ts'
import type { RecentGoal, RunDraft, RunSessionSnapshot, RunStorage } from './runStorage.ts'
import type { GoalDistanceKm, RunMode } from './types.ts'

// 일반 RUN 전용 Store.
// - 기초 측정 Store(measurementStore)·온보딩 Store와 독립이다. 서로 읽거나 쓰지 않는다.
// - 목표 draft·최근 목표·선택 음악, 활성 세션 상태를 가진다. 파생값(경과 시간, 페이스 등)은 저장하지 않는다.
// - 저장은 전용 키(pacebeat:run:*:v1)에만 한다. 저장이 실패해도 메모리 상태는 유지한다(예외를 던지지 않는다).
//   저장 실패를 알아야 하는 기록 저장(records)은 Store가 아니라 RunStorage.saveRecord를 직접 쓴다.
// - 이 Issue에서는 저장된 세션을 읽어 상태에 넣지 않는다(복원 동작은 세션 안정화 Issue). 시작할 때는 항상 세션이 없다.

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
  startRun: (mode: RunMode, now: number, createId?: () => string) => void
  pauseRun: (now: number) => void
  resumeRun: (now: number) => void
  stopRun: (now: number, reason?: RunEndReason) => void
  // 누적 거리 샘플을 추가한다(구간 계산용). 거리가 줄었거나 시간이 거꾸로 간 샘플은 버린다.
  recordDistanceSample: (elapsedMs: number, distanceM: number) => void
  // 세션 상태를 지운다(저장을 마쳤거나 폐기할 때).
  clearSession: () => void
}

export type RunStoreState = RunStoreData & RunStoreActions

function pushRecentGoal(recent: readonly RecentGoal[], goal: RecentGoal): RecentGoal[] {
  const others = recent.filter(
    (item) => !(item.distanceKm === goal.distanceKm && item.targetDurationSec === goal.targetDurationSec),
  )
  return [goal, ...others].slice(0, MAX_RECENT_GOALS)
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다.
export function createRunStore(storage: RunStorage = createRunStorage()) {
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
        activeSession === null ? {} : { activeSession: { ...activeSession, session: pauseRun(activeSession.session, now) } },
      ),
    resumeRun: (now) =>
      set(({ activeSession }) =>
        activeSession === null ? {} : { activeSession: { ...activeSession, session: resumeRun(activeSession.session, now) } },
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
                distanceSamples: appendDistanceSample(activeSession.distanceSamples, { elapsedMs, distanceM }),
              },
            },
      ),
    clearSession: () => set({ activeSession: null }),
  }))

  // 상태가 바뀌면 전용 키에 저장한다. 저장 실패는 무시한다(메모리 상태 유지).
  store.subscribe((state, previous) => {
    try {
      if (state.draft !== previous.draft) storage.saveDraft(state.draft)
      if (state.activeSession !== previous.activeSession) {
        if (state.activeSession === null) storage.clearSession()
        else storage.saveSession(state.activeSession)
      }
    } catch {
      // 저장 실패는 무시한다.
    }
  })

  return store
}

export const runStore = createRunStore()

export function useRunStore<T>(selector: (state: RunStoreState) => T): T {
  return useStore(runStore, selector)
}
