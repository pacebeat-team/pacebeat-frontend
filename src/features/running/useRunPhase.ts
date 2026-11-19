import { isArrivalPending, resolveGuardPhase } from './runFlow.ts'
import type { RunSessionPhase } from './runFlow.ts'
import { useRunResultStore } from './runResultStore.ts'
import { useRunStore } from './runStore.ts'

// 화면 규칙(접근 가드·복귀 바)이 쓰는 세션 phase.
// 기록 저장을 마친 세션은 아직 저장소에 남아 있어도(정리는 결과 흐름을 벗어난 뒤) 끝난 것으로 본다.
// 그래서 저장 직후의 이동이 결과 화면으로 되돌려지지 않고, 정리 이펙트의 실행 순서에도 기대지 않는다.
export function useRunPhase(): RunSessionPhase {
  const status = useRunStore((state) => state.activeSession?.session.status ?? null)
  const saved = useRunResultStore((state) => state.saved)
  return resolveGuardPhase(status, saved)
}

// 기록 저장을 마친 세션인가(결과 흐름을 벗어나면 정리된다).
export function useRunSaved(): boolean {
  return useRunResultStore((state) => state.saved)
}

// 목표 거리 도달로 자동 종료된 세션인가(도착 화면을 거쳐야 한다).
export function useArrivalPending(): boolean {
  return useRunStore((state) => isArrivalPending(state.activeSession?.session ?? null))
}
