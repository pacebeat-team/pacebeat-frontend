import { MIN_TARGET_PACE_SEC, MAX_TARGET_PACE_SEC } from './goal.ts'
import type { RunRecord } from './types.ts'

// P!PACE 러닝 추천 목표 정책 (순수 함수).
// - 기초 측정 Store·온보딩 Store를 직접 가져오지 않는다(경계 규칙 준수). 필요한 값은 인자로만 받는다.
// - 추천 거리는 3.0km로 고정하고, 목표 시간은 추천 페이스(초/km) × 3으로 계산한다.
// - 내부 계산은 초 단위 원본 값을 유지하고, 화면 표시용 페이스는 5초 단위로 반올림한다.

export const RECOMMENDED_DISTANCE_KM = 3 as const
export const DEFAULT_RECOMMENDED_PACE_SEC = 420 // 7:00/km (아무 정보도 없는 경우 기본값)
export const RECENT_WINDOW_DAYS = 28
export const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 86_400_000
export const MIN_VALID_RECORD_DISTANCE_M = 1000
export const MIN_RECENT_RECORDS_FOR_BLEND = 3

export type OnboardingExperienceInput = 'beginner' | 'occasional' | 'regular'
export type OnboardingWeeklyRunsInput = '1' | '2' | '3+'

export type RecommendationBasis = 'recent_runs' | 'baseline' | 'onboarding' | 'default_starter'

// 2. 온보딩 첫 목표 기준 페이스(sec/km): 경험 × 주간 횟수 9가지 조합
export const ONBOARDING_PACE_TABLE: Readonly<
  Record<OnboardingExperienceInput, Readonly<Record<OnboardingWeeklyRunsInput, number>>>
> = Object.freeze({
  beginner: Object.freeze({
    '1': 480, // 8:00/km → 3km 24:00
    '2': 465, // 7:45/km → 3km 23:15
    '3+': 450, // 7:30/km → 3km 22:30
  }),
  occasional: Object.freeze({
    '1': 435, // 7:15/km → 3km 21:45
    '2': 420, // 7:00/km → 3km 21:00
    '3+': 405, // 6:45/km → 3km 20:15
  }),
  regular: Object.freeze({
    '1': 405, // 6:45/km → 3km 20:15
    '2': 390, // 6:30/km → 3km 19:30
    '3+': 375, // 6:15/km → 3km 18:45
  }),
})

// 러닝 구간 비율 상수
// - 몸풀기(0~15%): 예상 시간 비율 15.75%, 추천 페이스의 105%
// - 리듬 유지(15~85%): 예상 시간 비율 69.25%, 추천 페이스의 (85% - 15.75%) ÷ 70% ≈ 98.92857%
// - 85% 이후 실시간 페이스(85~100%): 예상 시간 비율 14.25%, 최초 95%
export const WARMUP_PACE_RATIO = 1.05
export const RHYTHM_PACE_RATIO = (0.85 - 0.1575) / 0.7
export const REALTIME_INITIAL_PACE_RATIO = 0.95

// 화면 표시용 5초 단위 반올림 (예: 416초 → 415초 = 6:55/km)
export function roundPaceTo5Sec(paceSecPerKm: number): number {
  if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) return DEFAULT_RECOMMENDED_PACE_SEC
  return Math.round(paceSecPerKm / 5) * 5
}

// 허용 범위 4:00/km(240초) ~ 10:00/km(600초) 안으로 제한 (경계값 포함)
export function clampRecommendedPaceSec(paceSecPerKm: number): number {
  if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) return DEFAULT_RECOMMENDED_PACE_SEC
  return Math.min(MAX_TARGET_PACE_SEC, Math.max(MIN_TARGET_PACE_SEC, paceSecPerKm))
}

export interface StagePacePlan {
  // 내부 계산용 원본 초 단위 페이스
  readonly rawWarmupPaceSecPerKm: number
  readonly rawRhythmPaceSecPerKm: number
  readonly rawRealtimeInitialPaceSecPerKm: number
  // 화면 표시용 5초 단위 반올림 페이스
  readonly warmupPaceSecPerKm: number
  readonly rhythmPaceSecPerKm: number
  readonly realtimeInitialPaceSecPerKm: number
}

export function buildStagePacePlan(recommendedPaceSecPerKm: number): StagePacePlan {
  const base = clampRecommendedPaceSec(recommendedPaceSecPerKm)
  const rawWarmup = base * WARMUP_PACE_RATIO
  const rawRhythm = base * RHYTHM_PACE_RATIO
  const rawRealtime = base * REALTIME_INITIAL_PACE_RATIO
  return {
    rawWarmupPaceSecPerKm: rawWarmup,
    rawRhythmPaceSecPerKm: rawRhythm,
    rawRealtimeInitialPaceSecPerKm: rawRealtime,
    warmupPaceSecPerKm: roundPaceTo5Sec(rawWarmup),
    rhythmPaceSecPerKm: roundPaceTo5Sec(rawRhythm),
    realtimeInitialPaceSecPerKm: roundPaceTo5Sec(rawRealtime),
  }
}

// 온보딩 응답으로 첫 목표 기준 페이스(sec/km)를 구한다. 경험 수준이 없으면 null.
// 주간 횟수가 선택되지 않았을 때는 중간값('2')을 쓴다.
export function getOnboardingInitialPaceSec(
  experienceLevel: OnboardingExperienceInput | null | undefined,
  weeklyRuns: OnboardingWeeklyRunsInput | null | undefined,
): number | null {
  if (!experienceLevel || !(experienceLevel in ONBOARDING_PACE_TABLE)) return null
  const row = ONBOARDING_PACE_TABLE[experienceLevel]
  const runsKey: OnboardingWeeklyRunsInput =
    weeklyRuns && weeklyRuns in row ? weeklyRuns : '2'
  return row[runsKey]
}

// 5. 최근 28일 최신성 가중치: 0~7일 1.0, 8~14일 0.8, 15~21일 0.6, 22~28일 0.4, 그 외 0(제외)
export function getRecencyWeight(startedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0
  const ageMs = nowMs - startedAtMs
  if (ageMs < 0 || ageMs > RECENT_WINDOW_MS) return 0
  const dayMs = 86_400_000
  if (ageMs <= 7 * dayMs) return 1.0
  if (ageMs <= 14 * dayMs) return 0.8
  if (ageMs <= 21 * dayMs) return 0.6
  return 0.4
}

// 완주 가중치: 거리 완주(goal) 1.0, 일부 러닝(partial) 0.5, TIME 기록 0(제외)
export function getCompletionWeight(completion: RunRecord['result']['completion']): number {
  if (completion === 'goal') return 1.0
  if (completion === 'partial') return 0.5
  return 0
}

export interface RecentRecordsPaceResult {
  readonly weightedPaceSecPerKm: number | null
  readonly validRecordCount: number
}

// 최근 28일의 유효한 GPS 러닝 기록(1km 이상, 4:00~10:00/km 경계 포함)만 가중 평균한다.
export function computeRecentRecordsPace(
  records: readonly RunRecord[],
  nowMs: number,
): RecentRecordsPaceResult {
  let weightedSum = 0
  let weightTotal = 0
  let validCount = 0

  for (const record of records) {
    if (record.mode !== 'gps') continue
    const { distanceM, avgPaceSecPerKm, completion } = record.result
    if (distanceM === null || !Number.isFinite(distanceM) || distanceM < MIN_VALID_RECORD_DISTANCE_M) continue
    if (
      avgPaceSecPerKm === null ||
      !Number.isFinite(avgPaceSecPerKm) ||
      avgPaceSecPerKm < MIN_TARGET_PACE_SEC ||
      avgPaceSecPerKm > MAX_TARGET_PACE_SEC
    ) {
      continue
    }
    const recencyW = getRecencyWeight(record.startedAt, nowMs)
    const completionW = getCompletionWeight(completion)
    const weight = recencyW * completionW
    if (weight <= 0) continue

    weightedSum += avgPaceSecPerKm * weight
    weightTotal += weight
    validCount += 1
  }

  if (validCount === 0 || weightTotal <= 0) {
    return { weightedPaceSecPerKm: null, validRecordCount: 0 }
  }
  return {
    weightedPaceSecPerKm: weightedSum / weightTotal,
    validRecordCount: validCount,
  }
}

export interface RecommendationInput {
  readonly experienceLevel?: OnboardingExperienceInput | null
  readonly weeklyRuns?: OnboardingWeeklyRunsInput | null
  readonly baselinePaceSecPerKm?: number | null
  readonly records?: readonly RunRecord[]
  readonly nowMs?: number
}

export interface Recommended3KmGoal {
  readonly distanceKm: 3
  readonly basis: RecommendationBasis
  // 내부 계산용 원본 추천 페이스(초/km, 허용 범위 240~600 클램핑)
  readonly rawPaceSecPerKm: number
  // 정수 초 단위 추천 페이스
  readonly targetPaceSecPerKm: number
  // 화면 표시용 5초 단위 반올림 추천 페이스
  readonly displayPaceSecPerKm: number
  // 3km 목표 시간(초) = 추천 페이스 × 3
  readonly targetDurationSec: number
  readonly validRecentRecordCount: number
  readonly stages: StagePacePlan
}

function isValidBaselinePace(pace: number | null | undefined): pace is number {
  return typeof pace === 'number' && Number.isFinite(pace) && pace > 0
}

// 1. 추천 기준 적용 순서에 따라 3.0km 추천 목표와 단계별 페이스를 계산한다.
// - 실제 러닝 3개 이상: 최근 기록 60% + 기준 페이스 40% (기준 페이스가 없으면 최근 기록 100%)
// - 기초 측정 완료 & 실제 기록 3개 미만: 기준 페이스 100% (온보딩 응답 중복 반영 안 함)
// - 기초 측정 전: 온보딩의 러닝 경험과 주간 횟수 사용
// - 아무 정보도 없는 경우: 기본값 7:00/km (420초)
export function calculateRecommended3KmGoal(input: RecommendationInput = {}): Recommended3KmGoal {
  const nowMs = input.nowMs ?? Date.now()
  const records = input.records ?? []
  const recent = computeRecentRecordsPace(records, nowMs)
  const hasBaseline = isValidBaselinePace(input.baselinePaceSecPerKm)
  const clampedBaseline = hasBaseline ? clampRecommendedPaceSec(input.baselinePaceSecPerKm!) : null

  let rawPace: number
  let basis: RecommendationBasis

  if (recent.validRecordCount >= MIN_RECENT_RECORDS_FOR_BLEND && recent.weightedPaceSecPerKm !== null) {
    rawPace =
      clampedBaseline !== null
        ? recent.weightedPaceSecPerKm * 0.6 + clampedBaseline * 0.4
        : recent.weightedPaceSecPerKm
    basis = 'recent_runs'
  } else if (clampedBaseline !== null) {
    rawPace = clampedBaseline
    basis = 'baseline'
  } else {
    const onboardingPace = getOnboardingInitialPaceSec(input.experienceLevel, input.weeklyRuns)
    if (onboardingPace !== null) {
      rawPace = onboardingPace
      basis = 'onboarding'
    } else {
      rawPace = DEFAULT_RECOMMENDED_PACE_SEC
      basis = 'default_starter'
    }
  }

  const clampedRawPace = clampRecommendedPaceSec(rawPace)
  const targetDurationSec = Math.round(clampedRawPace * RECOMMENDED_DISTANCE_KM)
  const targetPaceSecPerKm = Math.round(targetDurationSec / RECOMMENDED_DISTANCE_KM)
  const displayPaceSecPerKm = roundPaceTo5Sec(clampedRawPace)

  return {
    distanceKm: RECOMMENDED_DISTANCE_KM,
    basis,
    rawPaceSecPerKm: clampedRawPace,
    targetPaceSecPerKm,
    displayPaceSecPerKm,
    targetDurationSec,
    validRecentRecordCount: recent.validRecordCount,
    stages: buildStagePacePlan(clampedRawPace),
  }
}
