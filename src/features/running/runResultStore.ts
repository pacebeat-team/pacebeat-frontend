import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { REFLECTION_MEMO_MAX } from './reflection.ts'
import { saveRunResult } from './runSave.ts'
import type { SaveFailure } from './runSave.ts'
import { runStore } from './runStore.ts'
import type { RunStoreState } from './runStore.ts'
import { createRunStorage } from './runStorage.ts'
import { runSetupStore } from './runSetupStore.ts'
import type { RunStorage } from './runStorage.ts'
import type { ReflectionDifficulty, ReflectionReason, RunReflection } from './types.ts'
import type { StoreApi } from 'zustand/vanilla'

// 결과 화면의 입력 상태(회고)와 저장 진행 상태. 저장하지 않고 메모리에만 둔다(새로고침하면 회고 입력은 사라지고
// 종료된 세션 자체는 저장 키에 남는다).
// - 회고는 세션(=recordId)에 묶인다. 다른 세션 결과가 나오면 처음 상태로 돌아간다.
// - 시트는 편집본(draft)을 따로 가진다: "저장"으로만 결과에 반영하고, 닫기·바깥 탭은 반영하지 않는다.

export const EMPTY_REFLECTION: RunReflection = Object.freeze({ difficulty: null, reasons: [], memo: '' })

export interface RunResultData {
  readonly sessionId: string | null
  // 결과에 반영된 회고
  readonly applied: RunReflection
  readonly sheetOpen: boolean
  readonly draft: RunReflection
  readonly saving: boolean
  // 기록 저장에 성공했고 화면을 떠나면 세션을 정리해야 하는 상태
  readonly saved: boolean
  readonly saveError: SaveFailure | null
}

interface RunResultActions {
  // 결과 화면에 들어올 때 세션에 맞춘다. 세션이 바뀌었으면 회고·오류를 초기화한다.
  sync: (sessionId: string | null) => void
  setDifficulty: (difficulty: ReflectionDifficulty) => void
  openSheet: () => void
  closeSheet: () => void
  setDraftDifficulty: (difficulty: ReflectionDifficulty) => void
  toggleDraftReason: (reason: ReflectionReason) => void
  setDraftMemo: (memo: string) => void
  applySheet: () => void
  // 기록을 저장한다. 성공하면 true. 실패하면 결과·회고를 그대로 두고 false.
  // 진행 중 세션은 이 시점에 지우지 않는다: 결과 흐름 밖으로 이동한 뒤 finalize로 지운다(AppLayout이 호출).
  // saved인 동안 접근 규칙은 세션을 끝난 것으로 보므로(useRunPhase) 이동이 결과 화면으로 되돌려지지 않는다.
  // 그 사이 앱이 닫혀도 같은 recordId로 다시 저장하면 덮어쓰므로 중복되지 않는다.
  save: () => boolean
  // 저장을 마친 세션을 정리한다(진행 중 세션 키 삭제, 결과 입력 초기화).
  finalize: () => void
}

export type RunResultState = RunResultData & RunResultActions

const INITIAL: RunResultData = {
  sessionId: null,
  applied: EMPTY_REFLECTION,
  sheetOpen: false,
  draft: EMPTY_REFLECTION,
  saving: false,
  saved: false,
  saveError: null,
}

export function createRunResultStore(
  runs: StoreApi<RunStoreState> = runStore,
  storage: RunStorage = createRunStorage(),
  setup: { getState: () => { reset: () => void } } = runSetupStore,
) {
  return createStore<RunResultState>()((set, get) => ({
    ...INITIAL,
    sync: (sessionId) => {
      if (get().sessionId === sessionId) return
      set({ ...INITIAL, sessionId })
    },
    setDifficulty: (difficulty) => set(({ applied }) => ({ applied: { ...applied, difficulty } })),
    openSheet: () => set(({ applied }) => ({ sheetOpen: true, draft: applied })),
    closeSheet: () => set({ sheetOpen: false }),
    setDraftDifficulty: (difficulty) => set(({ draft }) => ({ draft: { ...draft, difficulty } })),
    toggleDraftReason: (reason) =>
      set(({ draft }) => ({
        draft: {
          ...draft,
          reasons: draft.reasons.includes(reason) ? draft.reasons.filter((item) => item !== reason) : [...draft.reasons, reason],
        },
      })),
    setDraftMemo: (memo) => set(({ draft }) => ({ draft: { ...draft, memo: memo.slice(0, REFLECTION_MEMO_MAX) } })),
    applySheet: () => set(({ draft }) => ({ applied: draft, sheetOpen: false })),
    save: () => {
      if (get().saved) return true // 이미 저장했다(중복 탭): 같은 기록을 다시 만들지 않는다.
      if (get().saving) return false
      set({ saving: true, saveError: null })
      const result = saveRunResult(runs.getState().activeSession, get().applied, storage)
      if (!result.ok) {
        set({ saving: false, saveError: result.code })
        return false
      }
      set({ saving: false, saved: true })
      return true
    },
    finalize: () => {
      runs.getState().clearSession()
      // 준비 흐름(목표 확정·시작 신호)도 처음으로 돌린다: 저장 직후 /running/countdown 등을 직접 열어도 이전 설정으로 새 러닝이 시작되지 않는다.
      setup.getState().reset()
      set({ ...INITIAL })
    },
  }))
}

export const runResultStore = createRunResultStore()

export function useRunResultStore<T>(selector: (state: RunResultState) => T): T {
  return useStore(runResultStore, selector)
}
