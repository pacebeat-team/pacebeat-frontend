import { deriveRecordId } from '../running/record.ts'
import { createRunSessionStorage } from '../running/runSessionStorage.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import type { RunKeyValueStorage } from '../running/runStorage.ts'

// 내 데이터 삭제: 이 기기에 저장된 러닝 기록만 지운다.
// - 대상: 완료·저장된 러닝 기록(pacebeat:run:records:v1). 읽을 수 없게 손상된 값도 같은 키라 함께 지워진다.
// - 대상이 아닌 것: 진행 중·종료 전 세션(#48 복원), 목표 draft, 프로필, 온보딩, 기초 측정 결과, 안내 설정.
//   (기초 측정 결과를 지우면 진입 규칙이 다시 온보딩으로 보내므로 "러닝 기록 삭제"에 넣지 않는다.)
// - 인솔(센서) 측정 데이터는 저장되지 않으므로 지울 것이 없다.
// - 서버·계정 데이터와는 무관하다(이 기기의 저장소만 다룬다).
// - 예외: 저장 완료 후 정리에 실패해 남은 세션이 방금 지운 기록의 것이면, 다음 시작에 되살아나지 않도록 그 세션 키도 지운다.
// - 삭제 뒤에 저장소를 다시 읽어 실제로 지워졌는지 확인한다. 지워지지 않았으면 실패로 알린다.

export type DeleteFailureReason = 'unavailable' | 'write-failed'

export type DeleteResult =
  // 지울 기록이 없었다(저장소를 바꾸지 않았다)
  | { readonly status: 'nothing' }
  | {
      readonly status: 'deleted'
      // 읽을 수 있던 기록 수(손상되어 읽을 수 없던 항목은 세지 않는다)
      readonly deletedCount: number
      // 되살아날 수 있던 이미 저장된 세션 키 정리 결과(대상이 없으면 true)
      readonly sessionCleaned: boolean
    }
  | { readonly status: 'failed'; readonly reason: DeleteFailureReason }

export function deleteRunRecords(storage: RunKeyValueStorage | null): DeleteResult {
  if (storage === null) return { status: 'failed', reason: 'unavailable' }

  let raw: string | null
  try {
    raw = storage.getItem(RUN_STORAGE_KEYS.records)
  } catch {
    return { status: 'failed', reason: 'unavailable' }
  }
  if (raw === null) return { status: 'nothing' }

  const read = createRunStorage(storage).readRecords()
  const ids = read.ok ? read.records.map((record) => record.recordId) : []

  try {
    storage.removeItem(RUN_STORAGE_KEYS.records)
  } catch {
    return { status: 'failed', reason: 'write-failed' }
  }
  try {
    if (storage.getItem(RUN_STORAGE_KEYS.records) !== null) return { status: 'failed', reason: 'write-failed' }
  } catch {
    return { status: 'failed', reason: 'unavailable' }
  }

  return { status: 'deleted', deletedCount: ids.length, sessionCleaned: cleanStaleSession(storage, new Set(ids)) }
}

function cleanStaleSession(storage: RunKeyValueStorage, deletedIds: ReadonlySet<string>): boolean {
  const sessions = createRunSessionStorage(storage)
  const stored = sessions.loadSession()
  if (stored.status !== 'ok') return true
  if (!deletedIds.has(deriveRecordId(stored.value.snapshot.session.id))) return true
  let cleaned = true
  for (const remove of [sessions.removeSession, sessions.removeReflection, sessions.removeSeen]) {
    try {
      remove()
    } catch {
      cleaned = false
    }
  }
  return cleaned
}
