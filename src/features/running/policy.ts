import type { GoalDistanceKm, RunGoal, RunMode } from './types.ts'

// 일반 RUN 정책 판정 (순수 함수).

// 최소 저장 시간: 일시정지를 뺀 러닝 시간이 60초 이상이어야 기록을 저장할 수 있다.
// 기초 측정의 기준 페이스 최소 유효 시간(120초)과는 별개이며 서로 참조하지 않는다.
export const MIN_SAVE_MS = 60_000

// 저장 가능 여부. 모드·완주 여부와 무관하게 같은 기준을 쓴다.
export function canSaveRun(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= MIN_SAVE_MS
}

// 목표 거리 도달 판정: 누적 유효 거리가 목표 거리 이상이면 완주다. 타이머로 판정하지 않는다.
// TIME 모드와 목표가 없는 경우는 항상 false다(거리 완주로 계산하지 않는다).
export function isGoalReached(mode: RunMode, goal: RunGoal, distanceM: number | null): boolean {
  if (mode !== 'gps') return false
  if (goal.targetDistanceKm === null || distanceM === null || !Number.isFinite(distanceM)) return false
  return distanceM >= targetDistanceM(goal.targetDistanceKm)
}

export function targetDistanceM(distanceKm: GoalDistanceKm): number {
  return distanceKm * 1000
}
