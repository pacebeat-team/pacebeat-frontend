import { createSessionId } from '../measurement/session.ts'
import type { CryptoLike } from '../measurement/session.ts'
import { getRunElapsedMs } from './runSession.ts'
import type { RunSessionData } from './runSession.ts'
import { computeSplits } from './splits.ts'
import type { DistanceSample, GpsGap, RunCompletion, RunGoal, RunMode, RunRecord } from './types.ts'

// RunRecord 생성 (순수 함수).
// - recordId는 결과를 확정할 때 한 번 만들어 계속 쓴다. 같은 recordId로 다시 저장하면 덮어쓴다(중복 생성 없음).
// - TIME 모드는 distanceM·avgPaceSecPerKm을 null로 두고 구간도 만들지 않는다(0이나 추정값 금지).

export function createRecordId(cryptoLike?: CryptoLike): string {
  return createSessionId(cryptoLike)
}

// recordId를 세션 id에서 정한다. 같은 세션은 언제 어디서 저장해도 같은 recordId이므로
// 저장 재시도·새로고침 뒤 다시 저장해도 기록이 중복되지 않고 덮어쓴다.
export function deriveRecordId(sessionId: string): string {
  return `rec-${sessionId}`
}

export const NO_GOAL: RunGoal = Object.freeze({ targetDistanceKm: null, targetDurationSec: null })

export interface BuildRunRecordInput {
  readonly recordId: string
  // 종료된 세션이어야 한다.
  readonly session: RunSessionData
  readonly mode: RunMode
  readonly goal: RunGoal
  readonly musicTrackId: string | null
  // GPS 모드의 누적 거리(m)와 평균 페이스. TIME 모드는 무시한다.
  readonly distanceM: number | null
  readonly avgPaceSecPerKm: number | null
  readonly distanceSamples: readonly DistanceSample[]
  readonly gpsGaps: readonly GpsGap[]
  // 목표 거리에 도달해 종료했는지(GPS 모드만 의미 있음)
  readonly goalReached: boolean
}

export function buildRunRecord(input: BuildRunRecordInput): RunRecord {
  const { session, mode } = input
  if (session.status !== 'finished' || session.endedAt === null) {
    throw new RangeError('종료된 세션만 기록으로 만들 수 있습니다.')
  }

  const elapsedMs = getRunElapsedMs(session, session.endedAt)
  const isTime = mode === 'time'
  const completion: RunCompletion = isTime ? 'time' : input.goalReached ? 'goal' : 'partial'

  return {
    recordId: input.recordId,
    sessionId: session.id,
    mode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    goal: isTime ? NO_GOAL : input.goal,
    musicTrackId: input.musicTrackId,
    result: {
      elapsedMs,
      distanceM: isTime ? null : input.distanceM,
      avgPaceSecPerKm: isTime ? null : input.avgPaceSecPerKm,
      splits: isTime ? [] : computeSplits(input.distanceSamples),
      completion,
      gpsGaps: isTime ? [] : [...input.gpsGaps],
    },
    reflection: null,
    sensorReport: null,
  }
}
