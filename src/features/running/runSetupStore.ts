import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { RunSetupLevel } from './runFlow.ts'
import type { RunMode } from './types.ts'

// 러닝 준비 흐름의 진행 단계와 시작 신호. 메모리에만 두고 저장하지 않는다.
// 목표·음악은 runStore의 draft가 가지고, 이 Store는 "어디까지 왔는지"와 "어떤 모드로 시작하라는 신호인지"만 가진다.
// 카운트다운과 실제 세션 시작(runLive.begin)은 이 신호를 읽어 처리한다.

export interface RunSetupState {
  readonly level: RunSetupLevel
  // 시작 신호의 모드. 시작 신호 전에는 null
  readonly mode: RunMode | null
  // 목표 화면에 들어왔다: 이후 단계를 다시 확정하도록 처음 상태로 되돌린다.
  enterGoal: () => void
  confirmGoal: () => void
  confirmMusic: () => void
  signalStart: (mode: RunMode) => void
  // 카운트다운을 취소하고 준비 화면으로 돌아간다. 시작 신호를 지운다(세션은 시작하지 않았다).
  backToReady: () => void
  // 시작 신호만 지운다(단계는 유지). 카운트다운 화면이 스스로 준비 화면으로 돌아갈 때 쓴다.
  clearStart: () => void
  reset: () => void
}

export function createRunSetupStore() {
  return createStore<RunSetupState>()((set) => ({
    level: 0,
    mode: null,
    enterGoal: () => set({ level: 1, mode: null }),
    confirmGoal: () => set(({ level }) => ({ level: level >= 2 ? level : 2 })),
    confirmMusic: () => set(({ level }) => ({ level: level >= 3 ? level : level >= 2 ? 3 : level })),
    signalStart: (mode) => set(({ level }) => (level >= 3 ? { level: 4, mode } : {})),
    backToReady: () => set(({ level }) => (level >= 4 ? { level: 3, mode: null } : {})),
    clearStart: () => set({ mode: null }),
    reset: () => set({ level: 0, mode: null }),
  }))
}

export const runSetupStore = createRunSetupStore()

export function useRunSetupStore<T>(selector: (state: RunSetupState) => T): T {
  return useStore(runSetupStore, selector)
}
