import type { GoalDistanceKm, RunGoal, RunMode } from './types.ts'

// 일반 RUN 정책 판정 (순수 함수).

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
