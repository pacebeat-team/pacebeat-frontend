import type { GoalDistanceKm } from './types.ts'

// 목표 로직 (순수 함수): 시간 선택 범위·단위, 목표 페이스, 추천 목표.
// - 기준 페이스를 어디서 읽을지는 이 파일이 모른다. 값(sec/km)을 인자로 받고, 없으면 null이다.
//   (기초 측정 결과를 일반 RUN이 읽는 연동은 후속 작업이다.)

export const GOAL_DISTANCES: readonly GoalDistanceKm[] = [1, 3, 5]

// 목표 페이스 허용 범위(sec/km): 4:00 ~ 10:00
export const MIN_TARGET_PACE_SEC = 240
export const MAX_TARGET_PACE_SEC = 600

// 기준 페이스가 없을 때 쓰는 기본 페이스(sec/km): 7:30
export const DEFAULT_TARGET_PACE_SEC = 450

// 시간 선택 단위(초): 1km는 30초, 3km·5km는 1분
// - 단위는 시간 선택 목록·스테퍼(+/-)·추천 반올림에 적용한다. 목표 시간 값 자체는 범위 안의 정수 초이면 유효하다.
//   (기준이 없을 때의 기본값 3km 22:30처럼 단위에 맞지 않는 값도 쓴다.)
export function getDurationStepSec(distanceKm: GoalDistanceKm): number {
  return distanceKm === 1 ? 30 : 60
}

export function isGoalDistance(value: unknown): value is GoalDistanceKm {
  return value === 1 || value === 3 || value === 5
}

// 선택 가능한 목표 시간(초)의 최소·최대. 목표 페이스가 4:00~10:00/km가 되는 범위를 단위에 맞춘다.
export function getDurationRangeSec(distanceKm: GoalDistanceKm): { min: number; max: number } {
  const step = getDurationStepSec(distanceKm)
  return {
    min: Math.ceil((distanceKm * MIN_TARGET_PACE_SEC) / step) * step,
    max: Math.floor((distanceKm * MAX_TARGET_PACE_SEC) / step) * step,
  }
}

// 범위 안의 모든 선택지(오름차순)
export function getDurationOptionsSec(distanceKm: GoalDistanceKm): number[] {
  const { min, max } = getDurationRangeSec(distanceKm)
  const step = getDurationStepSec(distanceKm)
  const options: number[] = []
  for (let sec = min; sec <= max; sec += step) options.push(sec)
  return options
}

// 임의의 초 값을 가장 가까운 선택 단위로 맞추고 범위 안으로 제한한다. 올바르지 않은 값은 기본 목표 시간이 된다.
export function snapDurationSec(distanceKm: GoalDistanceKm, sec: number): number {
  const { min, max } = getDurationRangeSec(distanceKm)
  if (!Number.isFinite(sec)) return getDefaultDurationSec(distanceKm)
  const step = getDurationStepSec(distanceKm)
  const snapped = Math.round(sec / step) * step
  return Math.min(max, Math.max(min, snapped))
}

// 기준 페이스가 없을 때의 기본 목표 시간(단위에 맞추지 않은 정확한 값): 1km 7:30, 3km 22:30, 5km 37:30
export function getDefaultDurationSec(distanceKm: GoalDistanceKm): number {
  return distanceKm * DEFAULT_TARGET_PACE_SEC
}

// 범위 안의 정수 초인가. (단위 배수일 필요는 없다.)
export function isValidDurationSec(distanceKm: GoalDistanceKm, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false
  const { min, max } = getDurationRangeSec(distanceKm)
  return value >= min && value <= max
}

// 범위 안의 정수 초로 제한한다. 올바르지 않은 값은 기본 목표 시간이 된다. (단위에는 맞추지 않는다.)
export function clampDurationSec(distanceKm: GoalDistanceKm, sec: number): number {
  if (!Number.isFinite(sec)) return getDefaultDurationSec(distanceKm)
  const { min, max } = getDurationRangeSec(distanceKm)
  return Math.min(max, Math.max(min, Math.round(sec)))
}

// 스테퍼(+/-): 현재 값에서 방향으로 가장 가까운 단위 값으로 한 칸 이동한다(범위 안으로 제한).
// 단위에 맞지 않는 값(예: 22:30)에서도 다음 단위 값(23:00 / 22:00)으로 간다.
export function stepDurationSec(distanceKm: GoalDistanceKm, current: number, direction: 1 | -1): number {
  const step = getDurationStepSec(distanceKm)
  const { min, max } = getDurationRangeSec(distanceKm)
  const value = clampDurationSec(distanceKm, current)
  const next = direction === 1 ? (Math.floor(value / step) + 1) * step : (Math.ceil(value / step) - 1) * step
  return Math.min(max, Math.max(min, next))
}

// 목표 페이스(sec/km, 정수) = 목표 시간 ÷ 거리
export function getTargetPaceSecPerKm(distanceKm: GoalDistanceKm, durationSec: number): number {
  return Math.round(durationSec / distanceKm)
}

// 거리 프리셋을 바꿀 때 목표 페이스를 유지하도록 시간을 다시 계산한다(정수 초, 범위 안으로 제한).
export function rescaleDurationSec(
  fromDistanceKm: GoalDistanceKm,
  fromDurationSec: number,
  toDistanceKm: GoalDistanceKm,
): number {
  return clampDurationSec(toDistanceKm, (fromDurationSec / fromDistanceKm) * toDistanceKm)
}

export interface GoalRecommendation {
  readonly durationSec: number
  readonly paceSecPerKm: number
}

// 추천 목표: 추천 시간 = 기준 페이스 × 거리를 선택 단위로 반올림한다.
// 기준 페이스가 없거나(null) 올바르지 않으면 추천하지 않는다(null).
export function recommendGoal(
  baselinePaceSecPerKm: number | null,
  distanceKm: GoalDistanceKm,
): GoalRecommendation | null {
  if (baselinePaceSecPerKm === null || !Number.isFinite(baselinePaceSecPerKm) || baselinePaceSecPerKm <= 0) {
    return null
  }
  const durationSec = snapDurationSec(distanceKm, baselinePaceSecPerKm * distanceKm)
  return { durationSec, paceSecPerKm: getTargetPaceSecPerKm(distanceKm, durationSec) }
}

// 목표 페이스를 기준 페이스와 비교한다. 기준이 없으면 null이다.
// faster: 기준보다 빠름(secPerKm = 초/km 차이, 반올림), same: 같음, slower: 느림
export type BaselineComparison =
  | { readonly kind: 'faster'; readonly secPerKm: number }
  | { readonly kind: 'same' }
  | { readonly kind: 'slower' }

export function compareToBaseline(
  baselinePaceSecPerKm: number | null,
  targetPaceSecPerKm: number,
): BaselineComparison | null {
  if (baselinePaceSecPerKm === null || !Number.isFinite(baselinePaceSecPerKm) || baselinePaceSecPerKm <= 0) {
    return null
  }
  if (!Number.isFinite(targetPaceSecPerKm)) return null
  const diff = Math.round(baselinePaceSecPerKm - targetPaceSecPerKm)
  if (diff > 0) return { kind: 'faster', secPerKm: diff }
  return diff === 0 ? { kind: 'same' } : { kind: 'slower' }
}
