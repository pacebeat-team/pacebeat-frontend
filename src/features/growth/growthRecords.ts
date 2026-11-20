import { isRunRecord, RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'

// 성장 화면이 저장된 러닝 기록을 읽는 방법 (순수 함수 + 얇은 저장소 읽기).
// 성장 화면은 기록을 읽기만 한다. 저장된 값을 고치거나 다시 쓰지 않으므로 손상된 원본도 그대로 남는다.
//
// 결과
//   - ok: 읽을 수 있는 기록과, 형식이 맞지 않아 건너뛴 항목 수(skipped)
//   - 저장소를 쓸 수 없거나 저장 데이터 전체를 읽을 수 없으면 오류
//   - 저장된 항목이 있는데 읽을 수 있는 기록이 하나도 없으면 "기록 없음"이 아니라 오류
//   - 일부만 손상되었으면 읽을 수 있는 기록은 보여 주고 skipped로 알린다

export type GrowthRecordsResult =
  | { readonly ok: true; readonly records: RunRecord[]; readonly skipped: number }
  | { readonly ok: false; readonly reason: 'unavailable' | 'unreadable' }

const STORAGE_VERSION = 1

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 저장된 문자열(null이면 저장된 것이 없음)을 해석한다.
export function parseGrowthRecords(raw: string | null): GrowthRecordsResult {
  if (raw === null) return { ok: true, records: [], skipped: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!isObject(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.data)) {
    return { ok: false, reason: 'unreadable' }
  }
  const records = parsed.data.filter(isRunRecord)
  const skipped = parsed.data.length - records.length
  if (records.length === 0 && skipped > 0) return { ok: false, reason: 'unreadable' }
  return { ok: true, records, skipped }
}

export interface GrowthRecordsStorage {
  getItem(key: string): string | null
}

export function readGrowthRecords(storage: GrowthRecordsStorage | null): GrowthRecordsResult {
  if (storage === null) return { ok: false, reason: 'unavailable' }
  try {
    return parseGrowthRecords(storage.getItem(RUN_STORAGE_KEYS.records))
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export function readGrowthRecordsFromBrowser(): GrowthRecordsResult {
  try {
    return readGrowthRecords(globalThis.localStorage ?? null)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
