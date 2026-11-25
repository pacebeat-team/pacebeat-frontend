import { MIN_TARGET_PACE_SEC } from './goal.ts'
import { targetDistanceM } from './policy.ts'
import {
  buildStagePacePlan,
  roundPaceTo5Sec,
} from './recommendationPolicy.ts'
import type { RunGoal } from './types.ts'

// 진행 화면용 파생값(순수 함수). 저장하지 않는다.

export const WARMUP_END_RATIO = 0.15
export const REALTIME_START_RATIO = 0.85
export const REALTIME_FREEZE_RATIO = 0.95
export const REALTIME_RECALC_STEP_M = 100
export const EARLY_ARRIVAL_RATIO = 0.05
export const MAX_EARLY_ARRIVAL_SEC = 60
export const COMPLETION_FIRST_MAX_SPEEDUP_RATIO = 0.9 // 추천 페이스보다 10% 이상 빠른 기준

export type RunPhaseSection = 'warmup' | 'rhythm' | 'realtime'
export type PaceGuidanceMode = 'warmup' | 'rhythm' | 'realtime_pace' | 'completion_first'

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

export interface RealtimePaceGuidance {
  readonly section: RunPhaseSection
  readonly mode: PaceGuidanceMode
  // 85% 지점부터 100m 단위로 증가하는 재계산 구간 인덱스(85% 전에는 null, 95% 이후에는 마지막 구간 고정)
  readonly stepBucketIndex: number | null
  // 조기 도착 단축 시간(초, 최대 60초). 85% 전에는 0
  readonly earlyArrivalSec: number
  // 내부 계산용 원본 안내 페이스(초/km). 완주 우선(completion_first)이더라도 참고 계산값을 담거나 시간이 지났으면 null
  readonly rawRequiredPaceSecPerKm: number | null
  // 화면 표시용 안내 페이스(초/km, 5초 단위 반올림). 완주 우선 전환 시에는 null
  readonly displayPaceSecPerKm: number | null
  readonly isCompletionFirst: boolean
  readonly isFrozenAfter95Pct: boolean
}

export interface RealtimeGuidanceInput {
  readonly goal: RunGoal
  readonly distanceM: number | null
  readonly elapsedMs: number
  // 95% 이후 고정할 직전 계산 페이스(없으면 95% 시점 계산값 사용)
  readonly lastCalculatedRawPaceSecPerKm?: number | null
}

// P!PACE 3구간(몸풀기 15% · 리듬 유지 70% · 85% 이후 실시간 필요 페이스 15%) 안내 계산.
// - 0~15%: 몸풀기 (추천 페이스의 105%)
// - 15~85%: 리듬 유지 (추천 페이스의 98.93%)
// - 85~95%: 남은 시간의 5%(최대 60초)를 단축하는 실시간 필요 페이스 (85% 최초 및 이후 100m마다 갱신)
// - 95~100%: 안내값을 더 변경하지 않고 마지막 계산값(lastCalculatedRawPaceSecPerKm)을 유지
// - 필요 페이스가 추천 페이스보다 10% 이상 빠르거나(<= 목표 × 0.9) 4:00/km(240초)보다 빠르면 완주 우선 안내(completion_first)로 전환
export function computeStagePaceGuidance(input: RealtimeGuidanceInput): RealtimePaceGuidance | null {
  const { goal, distanceM, elapsedMs, lastCalculatedRawPaceSecPerKm } = input
  if (goal.targetDistanceKm === null || goal.targetDurationSec === null || goal.targetDurationSec <= 0) {
    return null
  }
  const targetM = targetDistanceM(goal.targetDistanceKm)
  const targetPaceSecPerKm = goal.targetDurationSec / goal.targetDistanceKm
  const stages = buildStagePacePlan(targetPaceSecPerKm)
  const doneM = distanceM !== null && Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0
  const ratio = doneM / targetM

  if (ratio < WARMUP_END_RATIO) {
    return {
      section: 'warmup',
      mode: 'warmup',
      stepBucketIndex: null,
      earlyArrivalSec: 0,
      rawRequiredPaceSecPerKm: stages.rawWarmupPaceSecPerKm,
      displayPaceSecPerKm: stages.warmupPaceSecPerKm,
      isCompletionFirst: false,
      isFrozenAfter95Pct: false,
    }
  }

  if (ratio < REALTIME_START_RATIO) {
    return {
      section: 'rhythm',
      mode: 'rhythm',
      stepBucketIndex: null,
      earlyArrivalSec: 0,
      rawRequiredPaceSecPerKm: stages.rawRhythmPaceSecPerKm,
      displayPaceSecPerKm: stages.rhythmPaceSecPerKm,
      isCompletionFirst: false,
      isFrozenAfter95Pct: false,
    }
  }

  const trigger85M = targetM * REALTIME_START_RATIO
  const freeze95M = targetM * REALTIME_FREEZE_RATIO
  const isFrozen = ratio >= REALTIME_FREEZE_RATIO
  const effectiveDoneM = isFrozen ? Math.min(doneM, freeze95M) : doneM
  const stepBucketIndex = Math.max(0, Math.floor((effectiveDoneM - trigger85M + 1e-9) / REALTIME_RECALC_STEP_M))

  const remainingM = Math.max(0, targetM - doneM)
  const remainingSec = goal.targetDurationSec - Math.max(0, elapsedMs) / 1000
  const earlyArrivalSec = remainingSec > 0 ? Math.min(MAX_EARLY_ARRIVAL_SEC, remainingSec * EARLY_ARRIVAL_RATIO) : 0

  let rawRequired: number | null = null
  if (isFrozen && typeof lastCalculatedRawPaceSecPerKm === 'number' && Number.isFinite(lastCalculatedRawPaceSecPerKm) && lastCalculatedRawPaceSecPerKm > 0) {
    rawRequired = lastCalculatedRawPaceSecPerKm
  } else if (remainingM > 0 && remainingSec > 0) {
    rawRequired = (remainingSec - earlyArrivalSec) / (remainingM / 1000)
  }

  const tooFastThreshold = targetPaceSecPerKm * COMPLETION_FIRST_MAX_SPEEDUP_RATIO
  const isCompletionFirst =
    rawRequired === null ||
    rawRequired <= tooFastThreshold + 1e-9 ||
    rawRequired < MIN_TARGET_PACE_SEC

  return {
    section: 'realtime',
    mode: isCompletionFirst ? 'completion_first' : 'realtime_pace',
    stepBucketIndex,
    earlyArrivalSec,
    rawRequiredPaceSecPerKm: rawRequired,
    displayPaceSecPerKm: isCompletionFirst || rawRequired === null ? null : roundPaceTo5Sec(rawRequired),
    isCompletionFirst,
    isFrozenAfter95Pct: isFrozen,
  }
}

// 카운트다운: 시작부터 경과한 시간(ms)으로 보여 줄 숫자를 정한다. 3 → 2 → 1(각 1초) → 0(시작).
export const COUNTDOWN_SECONDS = 3

export function getCountdownValue(elapsedMs: number): number {
  const passed = Math.floor(Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000)
  return Math.max(0, COUNTDOWN_SECONDS - passed)
}
