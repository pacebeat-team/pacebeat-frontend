// 백엔드 OpenAPI(/openapi.json, version 1.0.0)에서 옮긴 요청·응답 타입. 문서에 없는 필드는 넣지 않는다.
// 값이 선택(`?`)인 것은 요청에서 생략 가능한 필드이고, 응답의 null은 "값 없음"이다(0으로 채우지 않는다).
// 백엔드 스키마가 바뀌면 이 파일을 다시 맞춘다(자동 생성 도구는 아직 쓰지 않는다).

export interface BaselineResponse {
  readonly user_id: string
  readonly skipped: boolean
  readonly quality_status: MetricStatusType
  readonly baseline_pace_sec_per_km: number | null
  readonly cadence_spm: number | null
  readonly stride_length_cm: number | null
  readonly valid_duration_ms: number | null
  readonly distance_m: number | null
  readonly measured_at: string | null
}

export interface BaselineUpsertRequest {
  readonly skipped?: boolean
  readonly quality_status?: MetricStatusType
  readonly baseline_pace_sec_per_km?: number | null
  readonly cadence_spm?: number | null
  readonly stride_length_cm?: number | null
  readonly valid_duration_ms?: number | null
  readonly distance_m?: number | null
  readonly measured_at?: string | null
}

export type CalibrationStatusType = 'not_started' | 'in_progress' | 'completed' | 'failed'

export interface ConsentPayload {
  readonly age_over_14: boolean
  readonly terms_of_service: boolean
  readonly privacy_policy: boolean
  readonly location_terms: boolean
  readonly marketing?: boolean
  readonly policy_version?: string | null
  readonly consented_at?: string | null
}

export type GenderType = 'female' | 'male'

export interface GpsGapPayload {
  readonly lost_at_ms: number
  readonly recovered_at_ms?: number | null
}

export type GrowthPeriodType = 'weekly' | 'monthly'

export interface GuidanceSettingsPayload {
  readonly voice_guidance_enabled?: boolean
  readonly vibration_guidance_enabled?: boolean
  readonly guidance_frequency_km?: number
  readonly vibration_intensity?: string
}

// PATCH /users/me/guidance로 보내는 전체 payload. 서버가 4개 필드를 모두 교체하므로 부분 전송을 타입으로 막는다.
export interface FullGuidancePayload {
  readonly voice_guidance_enabled: boolean
  readonly vibration_guidance_enabled: boolean
  readonly guidance_frequency_km: number
  readonly vibration_intensity: 'low' | 'medium' | 'high'
}

export interface HomeSummaryResponse {
  readonly weekly_activity: WeeklyActivitySummary
  readonly last_run: LastRunBrief | null
  readonly recommended_goal: RecommendedGoalView
  readonly should_prompt_baseline: boolean
  readonly baseline_status: MetricStatusType
}

export interface InsoleDeviceResponse {
  readonly id: string
  readonly side: InsoleSideType
  readonly device_identifier: string
  readonly is_connected: boolean
  readonly battery_pct: number | null
  readonly firmware_version: string | null
  readonly calibration_status: CalibrationStatusType
  readonly signal_quality: SignalQualityType
  readonly last_seen_at: string | null
}

export interface InsolePairSummaryResponse {
  readonly left: InsoleDeviceResponse | null
  readonly right: InsoleDeviceResponse | null
  readonly connection_mode: string
}

export interface InsoleRegisterRequest {
  readonly side: InsoleSideType
  readonly device_identifier: string
  readonly firmware_version?: string | null
}

export type InsoleSideType = 'left' | 'right'

export interface InsoleStatusUpdateRequest {
  readonly is_connected?: boolean | null
  readonly battery_pct?: number | null
  readonly firmware_version?: string | null
  readonly calibration_status?: CalibrationStatusType | null
  readonly signal_quality?: SignalQualityType | null
}

export interface LastRunBrief {
  readonly run_id: string
  readonly started_at: string
  readonly completion: RunCompletionType
  readonly distance_m: number | null
  readonly elapsed_ms: number
  readonly avg_pace_sec_per_km: number | null
}

export type MetricStatusType = 'valid' | 'insufficient_data' | 'no_data' | 'gps_poor' | 'single_foot' | 'sensor_disconnected'

export interface MusicPresetResponse {
  readonly id: string
  readonly title: string
  readonly subtitle?: string | null
  readonly bpm: number
  readonly recommendedPaceSecPerKm?: number | null
}

export interface PostureGrowthResponse {
  readonly period: GrowthPeriodType
  readonly overall_status: MetricStatusType
  readonly buckets: readonly PosturePeriodBucket[]
}

export interface PosturePeriodBucket {
  readonly period_start: string
  readonly period_end: string
  readonly valid_session_count: number
  readonly single_foot_session_count: number
  readonly status: MetricStatusType
  readonly avg_ground_contact_left_ms: number | null
  readonly avg_ground_contact_right_ms: number | null
  readonly avg_left_load_ratio_pct: number | null
  readonly avg_right_load_ratio_pct: number | null
  readonly dominant_feedback: readonly string[]
}

export interface PostureReportPayload {
  readonly posture_status: MetricStatusType
  readonly left_connected: boolean
  readonly right_connected: boolean
  readonly ground_contact_time_left_ms?: number | null
  readonly ground_contact_time_right_ms?: number | null
  readonly left_load_ratio_pct?: number | null
  readonly right_load_ratio_pct?: number | null
  readonly left_pressure_distribution?: PressureDistributionPayload | null
  readonly right_pressure_distribution?: PressureDistributionPayload | null
  readonly left_landing_pattern?: string | null
  readonly right_landing_pattern?: string | null
  readonly feedback_items?: readonly string[]
}

export interface PressureDistributionPayload {
  readonly forefoot_pct: number
  readonly midfoot_pct: number
  readonly heel_pct: number
}

export interface RecommendedGoalView {
  readonly distance_km: number
  readonly target_duration_sec: number
  readonly target_pace_sec_per_km: number
  readonly basis_type: string
  readonly basis_description: string
}

export type ReflectionDifficultyType = 'easy' | 'moderate' | 'hard'

export type ReflectionReasonType = 'breath' | 'legs' | 'boredom' | 'time'

export type RunCompletionType = 'goal' | 'partial' | 'time'

export interface RunCreateRequest {
  readonly client_session_id: string
  readonly mode: RunModeType
  readonly completion: RunCompletionType
  readonly started_at: string
  readonly ended_at: string
  readonly elapsed_ms: number
  readonly target_distance_km?: number | null
  readonly target_duration_sec?: number | null
  readonly distance_m?: number | null
  readonly avg_pace_sec_per_km?: number | null
  readonly cadence_spm?: number | null
  readonly step_count?: number | null
  readonly target_pace_keep_ratio_pct?: number | null
  readonly pace_status?: MetricStatusType
  readonly cadence_status?: MetricStatusType
  readonly music_track_id?: string | null
  readonly splits?: readonly RunSplitPayload[]
  readonly gps_gaps?: readonly GpsGapPayload[]
  readonly reflection?: RunReflectionPayload | null
  readonly posture_report?: PostureReportPayload | null
}

export interface RunDetailResponse {
  readonly run_id: string
  readonly client_session_id: string
  readonly mode: RunModeType
  readonly completion: RunCompletionType
  readonly started_at: string
  readonly ended_at: string
  readonly elapsed_ms: number
  readonly distance_m: number | null
  readonly avg_pace_sec_per_km: number | null
  readonly pace_status: MetricStatusType
  readonly has_posture_report: boolean
  readonly target_distance_km: number | null
  readonly target_duration_sec: number | null
  readonly target_pace_sec_per_km: number | null
  readonly cadence_spm: number | null
  readonly cadence_status: MetricStatusType
  readonly step_count: number | null
  readonly target_pace_keep_ratio_pct: number | null
  readonly music_track_id: string | null
  readonly splits: readonly RunSplitPayload[]
  readonly gps_gaps: readonly GpsGapPayload[]
  readonly reflection: RunReflectionPayload | null
  readonly posture_report: PostureReportPayload | null
}

export type RunModeType = 'gps' | 'time'

export interface RunReflectionPayload {
  readonly difficulty?: ReflectionDifficultyType | null
  readonly reasons?: readonly ReflectionReasonType[]
  readonly memo?: string
}

export interface RunSplitPayload {
  readonly index: number
  readonly distance_m: number
  readonly duration_ms: number
  readonly pace_sec_per_km?: number | null
}

export interface RunSummaryItemResponse {
  readonly run_id: string
  readonly client_session_id: string
  readonly mode: RunModeType
  readonly completion: RunCompletionType
  readonly started_at: string
  readonly ended_at: string
  readonly elapsed_ms: number
  readonly distance_m: number | null
  readonly avg_pace_sec_per_km: number | null
  readonly pace_status: MetricStatusType
  readonly has_posture_report: boolean
}

export type RunningExperienceType = 'beginner' | 'occasional' | 'regular'

export interface RunningGrowthResponse {
  readonly period: GrowthPeriodType
  readonly status: MetricStatusType
  readonly buckets: readonly RunningPeriodBucket[]
}

export interface RunningPeriodBucket {
  readonly period_start: string
  readonly period_end: string
  readonly run_count: number
  readonly goal_completed_count: number
  readonly total_distance_m: number | null
  readonly total_elapsed_ms: number | null
  readonly avg_pace_sec_per_km: number | null
  readonly pace_status: MetricStatusType
  readonly difficulty_counts: Record<string, number>
}

export type SignalQualityType = 'good' | 'fair' | 'poor' | 'unavailable'

export interface TargetValidateRequest {
  readonly target_distance_km: number
  readonly target_duration_sec: number
}

export interface TargetValidateResponse {
  readonly target_distance_km: number
  readonly target_duration_sec: number
  readonly target_pace_sec_per_km: number
  readonly is_realistic: boolean
  readonly warning_code: string | null
  readonly warning_message: string | null
}

export interface UserProfileResponse {
  readonly user_id: string
  readonly nickname: string | null
  readonly birth_year: number | null
  readonly gender: GenderType | null
  readonly height_cm: number | null
  readonly weight_kg: number | null
  readonly running_experience: RunningExperienceType | null
  readonly weekly_runs?: WeeklyRunsType | null
  readonly consent: ConsentPayload
  readonly guidance: GuidanceSettingsPayload
  readonly onboarding_completed_at: string | null
  readonly profile_completed_at: string | null
}

export interface UserProfileUpdateRequest {
  readonly nickname?: string | null
  readonly birth_year?: number | null
  readonly gender?: GenderType | null
  readonly height_cm?: number | null
  readonly weight_kg?: number | null
  readonly running_experience?: RunningExperienceType | null
  readonly weekly_runs?: WeeklyRunsType | null
  readonly consent?: ConsentPayload | null
  readonly onboarding_completed_at?: string | null
  readonly profile_completed_at?: string | null
}

export interface WeeklyActivitySummary {
  readonly run_days: readonly boolean[]
  readonly run_count: number
  readonly total_gps_distance_m: number | null
  readonly total_elapsed_ms: number
}

export type WeeklyRunsType = '1' | '2' | '3+'
