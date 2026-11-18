import { targetDistanceM } from './policy.ts'
import type { RunGoal } from './types.ts'

// 진행 화면용 파생값(순수 함수). 저장하지 않는다.

export interface GoalProgress {
  readonly targetM: number
  // 0~100 정수(내림). 도달 전에는 100이 되지 않는다.
  readonly percent: number
  readonly remainingM: number
}

// GPS 목표 진행률. 목표가 없으면 null.
export function getGoalProgress(goal: RunGoal, distanceM: number | null): GoalProgress | null {
  if (goal.targetDistanceKm === null) return null
  const targetM = targetDistanceM(goal.targetDistanceKm)
  const done = distanceM !== null && Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0
  const remainingM = Math.max(0, targetM - done)
  const percent = Math.min(100, Math.floor((done / targetM) * 100))
  return { targetM, percent, remainingM }
}

// 재개 후 필요 페이스(초/km): 남은 목표 시간 ÷ 남은 거리. 계산할 수 없으면 null
// (목표 시간이 없거나, 이미 지났거나, 남은 거리가 없음)
export function getRequiredPaceSecPerKm(
  goal: RunGoal,
  distanceM: number | null,
  elapsedMs: number,
): number | null {
  const progress = getGoalProgress(goal, distanceM)
  if (progress === null || goal.targetDurationSec === null || progress.remainingM <= 0) return null
  const remainingSec = goal.targetDurationSec - elapsedMs / 1000
  if (!(remainingSec > 0)) return null
  return Math.round(remainingSec / (progress.remainingM / 1000))
}

// 카운트다운: 시작부터 경과한 시간(ms)으로 보여 줄 숫자를 정한다. 3 → 2 → 1(각 1초) → 0(시작).
export const COUNTDOWN_SECONDS = 3

export function getCountdownValue(elapsedMs: number): number {
  const passed = Math.floor(Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000)
  return Math.max(0, COUNTDOWN_SECONDS - passed)
}
