import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type {
  GpsGapPayload,
  MetricStatusType,
  RunCompletionType,
  RunCreateRequest,
  RunDetailResponse,
  RunModeType,
  RunReflectionPayload,
  RunSplitPayload,
  RunSummaryItemResponse,
} from '../../lib/api/types.ts'
import type { RunRecord, RunReflection } from '../running/types.ts'
import { finiteOrNull, fromIso, toIso } from './time.ts'

// 로컬 RunRecord ↔ 서버 Run 변환(순수 함수). 화면·저장소와 연결하지 않았다.
//
// ID 관계(백엔드 코드로 확인): 서버 run_id(run_sessions.id)는 서버가 만들고, (user_id, client_session_id)가 멱등 키다(upsert).
// 우리는 로컬 sessionId를 client_session_id로 보낸다(호출하는 쪽이 명시해서 넘기며 여기서는 고르지 않는다). 최초 저장 뒤 started_at·mode·completion·목표·음악은 재전송해도 갱신되지 않는다(회고·결과 필드만 갱신). 서버 응답도 로컬 recordId로 바꾸지 않는다.
//
// 보내지 않는 값: 케이던스·걸음 수·목표 페이스 유지율·pace/cadence 상태(로컬에 없거나 판정 기준 미확정), posture_report(SDK 계약 미확정).
// TIME 모드: 거리·페이스는 null 그대로 보내고(0 금지), 구간은 보내지 않는다.

export function toReflectionPayload(reflection: RunReflection): RunReflectionPayload {
  return { difficulty: reflection.difficulty, reasons: [...reflection.reasons], memo: reflection.memo }
}

export function fromReflectionPayload(payload: RunReflectionPayload | null): RunReflection | null {
  if (payload === null) return null
  return { difficulty: payload.difficulty ?? null, reasons: [...(payload.reasons ?? [])], memo: payload.memo ?? '' }
}

// 시각을 해석할 수 없으면 null(저장 요청을 만들지 않는다).
export function toRunCreateRequest(record: RunRecord, clientSessionId: string): RunCreateRequest | null {
  const startedAt = toIso(record.startedAt)
  const endedAt = toIso(record.endedAt)
  if (startedAt === null || endedAt === null || clientSessionId === '') return null
  const isTime = record.mode === 'time'
  const splits: RunSplitPayload[] = isTime
    ? []
    : record.result.splits.map((s) => ({ index: s.index, distance_m: s.distanceM, duration_ms: s.durationMs, pace_sec_per_km: s.paceSecPerKm }))
  const gpsGaps: GpsGapPayload[] = record.result.gpsGaps.map((g) => ({ lost_at_ms: g.lostAtMs, recovered_at_ms: g.recoveredAtMs }))
  return {
    client_session_id: clientSessionId,
    mode: record.mode,
    completion: record.result.completion,
    started_at: startedAt,
    ended_at: endedAt,
    elapsed_ms: record.result.elapsedMs,
    target_distance_km: record.goal.targetDistanceKm,
    target_duration_sec: record.goal.targetDurationSec,
    distance_m: isTime ? null : record.result.distanceM,
    avg_pace_sec_per_km: isTime ? null : record.result.avgPaceSecPerKm,
    music_track_id: record.musicTrackId,
    splits,
    gps_gaps: gpsGaps,
    reflection: record.reflection === null ? null : toReflectionPayload(record.reflection),
  }
}

// 서버(OpenAPI 1.0.0의 RunCreateRequest 제약)가 거절할 요청인지 보내기 전에 확인한다. 값을 고치거나 버리지 않고 어긋난 필드 이름만 돌려준다.
// 예: 0ms 러닝(elapsed_ms > 0), 거리·시간이 0인 구간(distance_m > 0, duration_ms > 0), 100자를 넘는 메모.
// 어긋난 기록은 서버에 보내지 않고(어차피 422), 로컬 기록은 그대로 둔다. 제약은 저장해 둔 openapi 스냅샷과 계약 테스트로 대조한다.
// 서버 제약을 어겨 보내지 않은 기록을 대기열에 표시하는 코드(서버가 준 error_code가 아니다).
export const LOCAL_INVALID_CODE = 'LOCAL_INVALID_RUN_REQUEST'
const MODES: readonly string[] = ['gps', 'time']
const COMPLETIONS: readonly string[] = ['goal', 'partial', 'time']
const DIFFICULTIES: readonly string[] = ['easy', 'moderate', 'hard']
const REASONS: readonly string[] = ['breath', 'legs', 'boredom', 'time']
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown): v is number => num(v) && Number.isInteger(v)
const isDateTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

export function findRunRequestViolations(r: RunCreateRequest): string[] {
  const bad: string[] = []
  const check = (ok: boolean, field: string) => void (ok || bad.push(field))
  const id = r.client_session_id
  check(typeof id === 'string' && id.length >= 1 && id.length <= 128, 'client_session_id')
  check(MODES.includes(r.mode), 'mode')
  check(COMPLETIONS.includes(r.completion), 'completion')
  check(isDateTime(r.started_at), 'started_at')
  check(isDateTime(r.ended_at), 'ended_at')
  check(int(r.elapsed_ms) && r.elapsed_ms > 0, 'elapsed_ms')
  check(r.target_distance_km == null || (num(r.target_distance_km) && r.target_distance_km > 0), 'target_distance_km')
  check(r.target_duration_sec == null || (int(r.target_duration_sec) && r.target_duration_sec > 0), 'target_duration_sec')
  check(r.distance_m == null || (num(r.distance_m) && r.distance_m >= 0), 'distance_m')
  check(r.avg_pace_sec_per_km == null || (int(r.avg_pace_sec_per_km) && r.avg_pace_sec_per_km > 0), 'avg_pace_sec_per_km')
  ;(r.splits ?? []).forEach((s, i) => {
    check(int(s.index) && s.index >= 1, `splits[${i}].index`)
    check(num(s.distance_m) && s.distance_m > 0, `splits[${i}].distance_m`)
    check(int(s.duration_ms) && s.duration_ms > 0, `splits[${i}].duration_ms`)
    check(s.pace_sec_per_km == null || (int(s.pace_sec_per_km) && s.pace_sec_per_km > 0), `splits[${i}].pace_sec_per_km`)
  })
  ;(r.gps_gaps ?? []).forEach((g, i) => {
    check(int(g.lost_at_ms) && g.lost_at_ms >= 0, `gps_gaps[${i}].lost_at_ms`)
    check(g.recovered_at_ms == null || (int(g.recovered_at_ms) && g.recovered_at_ms >= 0), `gps_gaps[${i}].recovered_at_ms`)
  })
  const f = r.reflection
  if (f != null) {
    check(f.difficulty == null || DIFFICULTIES.includes(f.difficulty), 'reflection.difficulty')
    check((f.reasons ?? []).every((x) => REASONS.includes(x)), 'reflection.reasons')
    check(f.memo == null || (typeof f.memo === 'string' && f.memo.length <= 100), 'reflection.memo')
  }
  return bad
}

// 서버 기록의 화면용 모델. 시각은 epoch ms, 값이 없으면 null이다. 로컬 recordId와 연결하지 않았다.
export interface RemoteRunSummary {
  readonly runId: string
  readonly clientSessionId: string
  readonly mode: RunModeType
  readonly completion: RunCompletionType
  readonly startedAt: number | null
  readonly endedAt: number | null
  readonly elapsedMs: number
  readonly distanceM: number | null
  readonly avgPaceSecPerKm: number | null
  readonly paceStatus: MetricStatusType
  readonly hasPostureReport: boolean
}

export interface RemoteRunDetail extends RemoteRunSummary {
  readonly targetDistanceKm: number | null
  readonly targetDurationSec: number | null
  readonly targetPaceSecPerKm: number | null
  readonly cadenceSpm: number | null
  readonly cadenceStatus: MetricStatusType
  readonly stepCount: number | null
  readonly targetPaceKeepRatioPct: number | null
  readonly musicTrackId: string | null
  readonly splits: readonly { readonly index: number; readonly distanceM: number; readonly durationMs: number; readonly paceSecPerKm: number | null }[]
  readonly gpsGaps: readonly { readonly lostAtMs: number; readonly recoveredAtMs: number | null }[]
  readonly reflection: RunReflection | null
}

export function fromRunSummary(r: RunSummaryItemResponse): RemoteRunSummary {
  const isTime = r.mode === 'time'
  return {
    runId: r.run_id,
    clientSessionId: r.client_session_id,
    mode: r.mode,
    completion: r.completion,
    startedAt: fromIso(r.started_at),
    endedAt: fromIso(r.ended_at),
    elapsedMs: r.elapsed_ms,
    distanceM: isTime ? null : finiteOrNull(r.distance_m),
    avgPaceSecPerKm: isTime ? null : finiteOrNull(r.avg_pace_sec_per_km),
    paceStatus: r.pace_status,
    hasPostureReport: r.has_posture_report,
  }
}

export function fromRunDetail(r: RunDetailResponse): RemoteRunDetail {
  return {
    ...fromRunSummary(r),
    targetDistanceKm: finiteOrNull(r.target_distance_km),
    targetDurationSec: finiteOrNull(r.target_duration_sec),
    targetPaceSecPerKm: finiteOrNull(r.target_pace_sec_per_km),
    cadenceSpm: finiteOrNull(r.cadence_spm),
    cadenceStatus: r.cadence_status,
    stepCount: finiteOrNull(r.step_count),
    targetPaceKeepRatioPct: finiteOrNull(r.target_pace_keep_ratio_pct),
    musicTrackId: r.music_track_id,
    splits: r.splits.map((s) => ({ index: s.index, distanceM: s.distance_m, durationMs: s.duration_ms, paceSecPerKm: finiteOrNull(s.pace_sec_per_km) })),
    gpsGaps: r.gps_gaps.map((g) => ({ lostAtMs: g.lost_at_ms, recoveredAtMs: finiteOrNull(g.recovered_at_ms) })),
    reflection: fromReflectionPayload(r.reflection),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// GET /runs의 응답 형식(배열인지, 페이지네이션 래퍼인지)은 문서에 없어 확정되지 않았다. 최상위 배열일 때만 읽고, 그 밖의 모양은 null(미확정)이다.
// 항목은 필수 필드가 맞는 것만 받는다(모양이 어긋난 항목은 건너뛴다).
export function parseRunList(raw: unknown): RemoteRunSummary[] | null {
  if (!Array.isArray(raw)) return null
  const items: RemoteRunSummary[] = []
  for (const item of raw) {
    if (!isObject(item)) continue
    if (typeof item.run_id !== 'string' || typeof item.client_session_id !== 'string' || typeof item.elapsed_ms !== 'number') continue
    if ((item.mode !== 'gps' && item.mode !== 'time') || typeof item.started_at !== 'string' || typeof item.ended_at !== 'string') continue
    items.push(fromRunSummary(item as unknown as RunSummaryItemResponse))
  }
  return items
}

// 저장 실패 분류(제안 정책). 어떤 경우에도 로컬 기록은 지우지 않는다.
// retry: 네트워크·시간 초과·5xx·429(나중에 같은 요청 재시도) / auth: 401(로그인 후 재시도) / rejected: 그 밖의 4xx(자동 재시도 안 함, 사용자·개발자 확인 필요)
// 중복 저장은 client_session_id가 서버에서 멱등 키로 동작한다는 가정이 필요하다. 이 동작은 실제 서버로 확인하지 못했다.
export type RunSaveFailure = 'retry' | 'auth' | 'rejected'

export function classifyRunSaveFailure(error: unknown): RunSaveFailure {
  if (error instanceof NetworkError) return 'retry'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'auth'
    if (error.status >= 500 || error.status === 429 || error.status === 408) return 'retry'
    return 'rejected'
  }
  return 'retry'
}

// 재시도 대기(ms): 2초부터 두 배씩 늘리고 5분에서 멈춘다.
export function runSaveRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1
  return Math.min(2000 * 2 ** (n - 1), 300_000)
}
