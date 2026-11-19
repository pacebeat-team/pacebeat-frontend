import { getDurationOptionsSec, getTargetPaceSecPerKm, recommendGoal } from './goal.ts'
import type { GoalDistanceKm } from './types.ts'

// 시간 선택 화면의 목록과 임시 선택 규칙.

export interface TimeRow {
  readonly durationSec: number
  readonly paceSecPerKm: number
  // 기준 페이스가 있을 때만 추천이 생긴다. 지금은 기준 페이스를 연결하지 않아 항상 false이다.
  readonly recommended: boolean
}

export function buildTimeRows(distanceKm: GoalDistanceKm, baselinePaceSecPerKm: number | null = null): TimeRow[] {
  const recommended = recommendGoal(baselinePaceSecPerKm, distanceKm)?.durationSec ?? null
  return getDurationOptionsSec(distanceKm).map((durationSec) => ({
    durationSec,
    paceSecPerKm: getTargetPaceSecPerKm(distanceKm, durationSec),
    recommended: durationSec === recommended,
  }))
}
