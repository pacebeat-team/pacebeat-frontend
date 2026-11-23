import type { ProfileData } from '../profile/types.ts'
import { deriveRecordId } from '../running/record.ts'
import { parseRunRecord } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'
import type { RemoteRunDetail, RemoteRunSummary } from './runMapper.ts'

// 서버 기록 → 로컬 가져오기 정책(순수 함수). 목적은 "다른 기기·재설치로 로컬에 없는 기록 복원"이며 로컬 기록은 절대 바꾸지 않는다.
//
// 정책
// 1. 같은 기록 = 서버 client_session_id와 로컬 sessionId가 같은 것(우리가 보낸 값이라 변환 규칙을 새로 만들지 않는다).
// 2. 로컬에 이미 있으면 로컬이 이긴다(거리·구간·회고 모두 덮어쓰지 않는다). 서버 값은 버린다.
// 3. 로컬에 없는 서버 기록만 상세를 받아 가져온다. 로컬 recordId는 기존 규칙(deriveRecordId)을 그대로 쓴다.
// 4. 사용자가 로컬 기록을 지운 뒤 되살아나지 않도록, 한 번 본 서버 기록 id는 장부(ledger)에 남기고 다시 가져오지 않는다.
//    (장부는 "서버 목록에서 본 id" 집합이다. 서버에는 개별 기록 삭제 API가 없다.)
// 5. 서버 상세가 로컬 기록 형식(parseRunRecord)을 만족하지 않으면 건너뛴다(값을 보정·추정하지 않는다). 자세 요약은 서버 상세에 없으므로 null이다.

export const IMPORT_LEDGER_KEY = 'pacebeat:sync:imported-runs:v1'

export function parseLedger(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  try {
    const json: unknown = JSON.parse(raw)
    if (typeof json !== 'object' || json === null || (json as { version?: unknown }).version !== 1) return new Set()
    const ids = (json as { ids?: unknown }).ids
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function serializeLedger(ids: ReadonlySet<string>): string {
  return JSON.stringify({ version: 1, ids: [...ids] })
}

// 가져올 서버 기록(상세를 받을 대상)을 고른다.
export function planImport(server: readonly RemoteRunSummary[], localSessionIds: ReadonlySet<string>, ledger: ReadonlySet<string>): RemoteRunSummary[] {
  const seen = new Set<string>()
  const out: RemoteRunSummary[] = []
  for (const run of server) {
    if (run.clientSessionId === '' || seen.has(run.clientSessionId)) continue
    seen.add(run.clientSessionId)
    if (localSessionIds.has(run.clientSessionId) || ledger.has(run.clientSessionId)) continue
    out.push(run)
  }
  return out
}

export function detailToRunRecord(detail: RemoteRunDetail): RunRecord | null {
  if (detail.startedAt === null || detail.endedAt === null || detail.clientSessionId === '') return null
  const isTime = detail.mode === 'time'
  return parseRunRecord({
    recordId: deriveRecordId(detail.clientSessionId),
    sessionId: detail.clientSessionId,
    mode: detail.mode,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    goal: { targetDistanceKm: detail.targetDistanceKm, targetDurationSec: detail.targetDurationSec },
    musicTrackId: detail.musicTrackId,
    reflection: detail.reflection,
    result: {
      elapsedMs: detail.elapsedMs,
      distanceM: isTime ? null : detail.distanceM,
      avgPaceSecPerKm: isTime ? null : detail.avgPaceSecPerKm,
      completion: detail.completion,
      splits: isTime ? [] : detail.splits.map((s) => ({ index: s.index, distanceM: s.distanceM, durationMs: s.durationMs, paceSecPerKm: s.paceSecPerKm })),
      gpsGaps: detail.gpsGaps.map((g) => ({ lostAtMs: g.lostAtMs, recoveredAtMs: g.recoveredAtMs })),
    },
    sensorReport: null,
  })
}

// 서버 프로필로 로컬 프로필의 "비어 있는" 칸만 채운다. 이미 값이 있으면 로컬이 이긴다(0·빈 문자열로 만들지 않는다).
export type ProfileFields = ProfileData

export function fillEmptyProfile(local: ProfileData, remote: ProfileData): Partial<ProfileData> {
  const patch: { -readonly [K in keyof ProfileData]?: ProfileData[K] } = {}
  if (local.nickname === '' && remote.nickname !== '') patch.nickname = remote.nickname
  if (local.birthYear === null && remote.birthYear !== null) patch.birthYear = remote.birthYear
  if (local.gender === null && remote.gender !== null) patch.gender = remote.gender
  if (local.heightCm === null && remote.heightCm !== null) patch.heightCm = remote.heightCm
  if (local.weightKg === null && remote.weightKg !== null) patch.weightKg = remote.weightKg
  return patch
}
