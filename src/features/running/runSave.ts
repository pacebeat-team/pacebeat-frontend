import { buildRunRecord, deriveRecordId } from './record.ts'
import { canSaveRun } from './policy.ts'
import { isFinishedSnapshot, summarizeRun } from './runResult.ts'
import { RunStorageError } from './runStorage.ts'
import type { RunSessionSnapshot, RunStorage } from './runStorage.ts'
import type { RunReflection, RunRecord } from './types.ts'

// 결과를 기록으로 저장한다(순수에 가깝게: 저장소만 건드린다).
// - recordId는 세션 id에서 정해져 항상 같다. 같은 recordId로 다시 저장하면 덮어쓴다(재시도해도 중복 없음).
// - 60초 최소 기준은 저장하는 이 시점에 다시 검사한다.
// - 저장 성공 여부만 돌려준다. 진행 중 세션 정리·화면 이동은 호출하는 쪽이 성공을 확인한 뒤에 한다.

export type SaveFailure = 'not-finished' | 'too-short' | 'unavailable' | 'write-failed'

export type SaveResult = { readonly ok: true; readonly record: RunRecord } | { readonly ok: false; readonly code: SaveFailure }

// 아무것도 입력하지 않은 회고는 기록에 남기지 않는다(null).
export function normalizeReflection(reflection: RunReflection): RunReflection | null {
  const empty = reflection.difficulty === null && reflection.reasons.length === 0 && reflection.memo === ''
  return empty ? null : reflection
}

export function saveRunResult(snapshot: RunSessionSnapshot | null, reflection: RunReflection, storage: RunStorage): SaveResult {
  if (!isFinishedSnapshot(snapshot)) return { ok: false, code: 'not-finished' }
  const summary = summarizeRun(snapshot)
  if (summary === null) return { ok: false, code: 'not-finished' }
  if (!canSaveRun(summary.elapsedMs)) return { ok: false, code: 'too-short' }
  const record: RunRecord = {
    ...buildRunRecord({
      recordId: deriveRecordId(snapshot.session.id),
      session: snapshot.session,
      mode: snapshot.mode,
      goal: snapshot.goal,
      musicTrackId: snapshot.musicTrackId,
      distanceM: summary.distanceM,
      avgPaceSecPerKm: summary.avgPaceSecPerKm,
      distanceSamples: snapshot.distanceSamples,
      gpsGaps: snapshot.gpsGaps,
      goalReached: summary.completion === 'goal',
    }),
    reflection: normalizeReflection(reflection),
  }
  try {
    storage.saveRecord(record)
  } catch (error) {
    if (error instanceof RunStorageError) {
      return { ok: false, code: error.code }
    }
    return { ok: false, code: 'write-failed' }
  }
  return { ok: true, record }
}
