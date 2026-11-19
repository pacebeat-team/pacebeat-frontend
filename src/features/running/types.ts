// 일반 러닝(RUN) 도메인 타입.
// - 기초 측정(features/measurement)과 별개의 기능이다. 기초 측정의 Store·저장 키·완료 로직을 쓰지 않는다.
// - 시각은 epoch ms, 시간 길이는 ms 또는 초(필드 이름에 단위를 적는다). 값을 구할 수 없으면 0이 아니라 null이다.

// gps: 위치로 거리·페이스를 기록한다. time: GPS 없이 경과 시간만 기록한다(거리·페이스는 기록하지 않는다).
export type RunMode = 'gps' | 'time'

export type GoalDistanceKm = 1 | 3 | 5

// 목표. TIME 모드는 목표가 없으므로 두 값 모두 null이다.
export interface RunGoal {
  readonly targetDistanceKm: GoalDistanceKm | null
  // 목표 완주 시간(초, 정수). 0보다 크다.
  readonly targetDurationSec: number | null
}

// 결과 종류: goal(목표 거리 도달) / partial(목표 전에 종료) / time(TIME 모드)
export type RunCompletion = 'goal' | 'partial' | 'time'

// 1km 단위 구간 기록. 마지막 잔여 구간은 distanceM이 1000 미만이다.
export interface RunSplit {
  // 1부터 시작하는 구간 번호
  readonly index: number
  readonly distanceM: number
  readonly durationMs: number
  // 구간 페이스(sec/km, 정수). 구할 수 없으면 null
  readonly paceSecPerKm: number | null
}

// GPS 신호가 끊겼던 구간. 러닝 경과 시간(ms, 일시정지 제외) 기준이다. 아직 복구되지 않았으면 recoveredAtMs는 null이다.
export interface GpsGap {
  readonly lostAtMs: number
  readonly recoveredAtMs: number | null
}

export type ReflectionDifficulty = 'easy' | 'moderate' | 'hard'
export type ReflectionReason = 'breath' | 'legs' | 'boredom' | 'time'

export interface RunReflection {
  // 체감 난이도. 고르지 않았으면 null
  readonly difficulty: ReflectionDifficulty | null
  // 힘들었던 이유(선택). 중복 없이 저장한다.
  readonly reasons: readonly ReflectionReason[]
  // 메모(선택). 최대 REFLECTION_MEMO_MAX자
  readonly memo: string
}

export interface RunResult {
  // 일시정지를 뺀 러닝 시간(ms)
  readonly elapsedMs: number
  // TIME 모드는 null (0이나 추정값을 넣지 않는다)
  readonly distanceM: number | null
  readonly avgPaceSecPerKm: number | null
  readonly splits: readonly RunSplit[]
  readonly completion: RunCompletion
  readonly gpsGaps: readonly GpsGap[]
}

export interface RunRecord {
  // 결과를 확정할 때 한 번 만들고 바꾸지 않는다. 같은 recordId로 다시 저장하면 덮어쓴다.
  readonly recordId: string
  readonly sessionId: string
  readonly mode: RunMode
  readonly startedAt: number
  readonly endedAt: number
  readonly goal: RunGoal
  // 음악을 고르지 않았으면 null
  readonly musicTrackId: string | null
  readonly result: RunResult
  readonly reflection: RunReflection | null
  // 센서 리포트. 이번 범위에서는 항상 null이다(추정값을 만들지 않는다).
  readonly sensorReport: null
}

// 거리 샘플: 러닝 경과 시간(ms, 일시정지 제외)과 그 시점의 누적 거리(m). 구간(split) 계산에 쓴다.
export interface DistanceSample {
  readonly elapsedMs: number
  readonly distanceM: number
}
