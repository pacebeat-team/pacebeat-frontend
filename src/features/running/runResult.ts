import { computeAvgPaceSecPerKm } from './runPace.ts'
import { isGoalReached } from './policy.ts'
import { getRunElapsedMs } from './runSession.ts'
import type { RunSessionSnapshot } from './runStorage.ts'
import { computeSplits } from './splits.ts'
import { getTargetPaceSecPerKm } from './goal.ts'
import type { GoalDistanceKm, RunCompletion, RunGoal, RunMode, RunSplit } from './types.ts'

// 종료된 세션에서 결과 화면·기록에 쓸 값을 만든다(순수 함수).
// 저장된 세션 스냅샷만 입력으로 쓰므로 새로고침 뒤에도 같은 값이 나온다. 값을 구할 수 없으면 0이 아니라 null이다.

export interface RunSummary {
  readonly mode: RunMode
  readonly completion: RunCompletion
  readonly goal: RunGoal
  readonly elapsedMs: number
  // TIME 모드는 null. GPS 모드는 유효 좌표로 쌓은 거리(m, 쌓인 것이 없으면 0)
  readonly distanceM: number | null
  // 경과 시간 ÷ 거리. TIME 모드이거나 거리가 너무 짧으면 null
  readonly avgPaceSecPerKm: number | null
  readonly splits: readonly RunSplit[]
  // 목표까지 남은 거리(m). 목표가 없거나 완주했으면 null
  readonly remainingM: number | null
}

export function isFinishedSnapshot(snapshot: RunSessionSnapshot | null): snapshot is RunSessionSnapshot {
  return snapshot !== null && snapshot.session.status === 'finished' && snapshot.session.endedAt !== null
}

export function summarizeRun(snapshot: RunSessionSnapshot): RunSummary | null {
  if (!isFinishedSnapshot(snapshot)) return null
  const { session, mode, goal } = snapshot
  const endedAt = session.endedAt as number
  const elapsedMs = getRunElapsedMs(session, endedAt)
  if (mode === 'time') {
    return { mode, completion: 'time', goal, elapsedMs, distanceM: null, avgPaceSecPerKm: null, splits: [], remainingM: null }
  }
  const last = snapshot.distanceSamples[snapshot.distanceSamples.length - 1]
  const distanceM = last === undefined ? 0 : last.distanceM
  // 목표 도달로 자동 종료된 세션(endReason 'auto')은 마지막 샘플이 시간 순서 때문에 버려졌어도 완주로 본다.
  const reached = isGoalReached('gps', goal, distanceM) || session.endReason === 'auto'
  const avgPaceSecPerKm = computeAvgPaceSecPerKm(elapsedMs, distanceM)
  const targetM = goal.targetDistanceKm === null ? null : goal.targetDistanceKm * 1000
  return {
    mode,
    completion: reached ? 'goal' : 'partial',
    goal,
    elapsedMs,
    distanceM,
    avgPaceSecPerKm,
    splits: computeSplits(snapshot.distanceSamples),
    remainingM: reached || targetM === null ? null : Math.max(0, targetM - distanceM),
  }
}

// 완주(목표 거리 도달) 결과인가. 도착 화면·어두운 완주 화면 여부 판단에 쓴다.
export function isGoalCompletion(snapshot: RunSessionSnapshot | null): boolean {
  return isFinishedSnapshot(snapshot) && summarizeRun(snapshot)?.completion === 'goal'
}

// ⚠️ 제안값(기획 확정 필요): 구간 페이스가 목표 페이스의 ±5% 안이면 "목표 페이스를 유지"한 것으로 본다.
export const PACE_KEEP_TOLERANCE = 0.05

// 목표 페이스 유지 비율(0~100 정수): 구간별 기록 중 목표 범위 안에서 달린 시간의 비율.
// 구간 기록(1km 이상 달림)이 없으면 근거가 없으므로 null이다.
export function getPaceKeepPercent(summary: RunSummary): number | null {
  const { goal, splits } = summary
  if (summary.mode !== 'gps' || goal.targetDistanceKm === null || goal.targetDurationSec === null) return null
  const measured = splits.filter((split) => split.paceSecPerKm !== null && split.durationMs > 0)
  if (measured.length === 0) return null
  const target = getTargetPaceSecPerKm(goal.targetDistanceKm as GoalDistanceKm, goal.targetDurationSec)
  const total = measured.reduce((sum, split) => sum + split.durationMs, 0)
  const kept = measured
    .filter((split) => Math.abs((split.paceSecPerKm as number) - target) <= target * PACE_KEEP_TOLERANCE)
    .reduce((sum, split) => sum + split.durationMs, 0)
  return Math.round((kept / total) * 100)
}

// 완주 상세 부제용: 목표 시간과 실제 시간의 차이(초). 양수면 더 오래 걸림, 음수면 빨랐음.
export function getTargetTimeDeltaSec(summary: RunSummary): number | null {
  if (summary.goal.targetDurationSec === null) return null
  return Math.round(summary.elapsedMs / 1000) - summary.goal.targetDurationSec
}

export const COMPLETION_LABELS: Readonly<Record<RunCompletion, string>> = Object.freeze({
  goal: '거리 완주',
  partial: '일부 러닝',
  time: '시간 기록',
})
