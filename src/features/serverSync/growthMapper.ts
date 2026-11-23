import type { GrowthPeriodType, MetricStatusType, PostureGrowthResponse, RunningGrowthResponse } from '../../lib/api/types.ts'
import { finiteOrNull } from './time.ts'

// 서버 Growth 응답 → 화면용 모델(순수 함수). 값이 없으면 null을 유지한다(0으로 채우지 않는다).
// 구간 시작·끝(period_start/period_end)은 날짜 형식과 시간대·주 시작 요일이 확정되지 않아 문자열 그대로 둔다(해석하지 않는다).
// 기존 로컬 집계(growthView)는 바꾸지 않았고, 서버 통계를 화면 기준으로 쓸지는 서버 집계 기준 확인 후 정한다.

export interface RunningBucketView {
  readonly periodStart: string
  readonly periodEnd: string
  readonly runCount: number
  readonly goalCompletedCount: number
  readonly totalDistanceM: number | null
  readonly totalElapsedMs: number | null
  readonly avgPaceSecPerKm: number | null
  readonly paceStatus: MetricStatusType
  readonly difficultyCounts: Readonly<Record<string, number>>
}

export interface RunningGrowthView {
  readonly period: GrowthPeriodType
  readonly status: MetricStatusType
  // 데이터가 하나도 없는가(기록 0건 구간만 있거나 구간이 없음). 화면의 "데이터 없음" 판단에 쓴다.
  readonly isEmpty: boolean
  readonly buckets: readonly RunningBucketView[]
}

export function fromRunningGrowth(response: RunningGrowthResponse): RunningGrowthView {
  const buckets = response.buckets.map<RunningBucketView>((b) => ({
    periodStart: b.period_start,
    periodEnd: b.period_end,
    runCount: b.run_count,
    goalCompletedCount: b.goal_completed_count,
    totalDistanceM: finiteOrNull(b.total_distance_m),
    totalElapsedMs: finiteOrNull(b.total_elapsed_ms),
    avgPaceSecPerKm: finiteOrNull(b.avg_pace_sec_per_km),
    paceStatus: b.pace_status,
    difficultyCounts: { ...b.difficulty_counts },
  }))
  return { period: response.period, status: response.status, isEmpty: buckets.every((b) => b.runCount === 0), buckets }
}

// 자세 통계. 기존 PostureSummary(앱 정규화 모델)로는 바꾸지 않는다: SDK 계약·좌우 판정 기준이 확정되지 않았다.
// 서버가 준 값을 이름만 바꿔 그대로 보여 주는 중간 모델이며, 아직 어떤 화면에도 연결하지 않았다.
export interface PostureBucketView {
  readonly periodStart: string
  readonly periodEnd: string
  readonly validSessionCount: number
  readonly singleFootSessionCount: number
  readonly status: MetricStatusType
  readonly avgGroundContactLeftMs: number | null
  readonly avgGroundContactRightMs: number | null
  readonly avgLeftLoadRatioPct: number | null
  readonly avgRightLoadRatioPct: number | null
  readonly dominantFeedback: readonly string[]
}

export interface PostureGrowthView {
  readonly period: GrowthPeriodType
  readonly overallStatus: MetricStatusType
  readonly buckets: readonly PostureBucketView[]
}

export function fromPostureGrowth(response: PostureGrowthResponse): PostureGrowthView {
  return {
    period: response.period,
    overallStatus: response.overall_status,
    buckets: response.buckets.map((b) => ({
      periodStart: b.period_start,
      periodEnd: b.period_end,
      validSessionCount: b.valid_session_count,
      singleFootSessionCount: b.single_foot_session_count,
      status: b.status,
      avgGroundContactLeftMs: finiteOrNull(b.avg_ground_contact_left_ms),
      avgGroundContactRightMs: finiteOrNull(b.avg_ground_contact_right_ms),
      avgLeftLoadRatioPct: finiteOrNull(b.avg_left_load_ratio_pct),
      avgRightLoadRatioPct: finiteOrNull(b.avg_right_load_ratio_pct),
      dominantFeedback: [...b.dominant_feedback],
    })),
  }
}
