import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { BaselineUpsertRequest, RunCreateRequest, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import type { ProfileData } from '../profile/types.ts'
import type { RunRecord } from '../running/types.ts'
import { baselineRequestFromMetrics, baselineSkippedRequest } from './baselineMapper.ts'
import { clearedProfileFields, sanitizeProfileRequest, toProfileUpdateRequest } from './profileMapper.ts'
import type { ClearableProfileField, LocalProfileSnapshot } from './profileMapper.ts'
import { findRunRequestViolations, LOCAL_INVALID_CODE, toRunCreateRequest } from './runMapper.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime, SYNC_PENDING_KEY } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// 계약 테스트: 저장해 둔 OpenAPI 스냅샷(src/lib/api/openapi.snapshot.json, 운영 서버 GET /openapi.json을 읽기 전용으로 받은 것)으로
// 프론트가 실제로 만드는 요청 본문을 검사한다. 가짜 API·저장소만 쓰고 실제 서버에는 요청하지 않는다.
// 주의: OpenAPI에는 "필드 생략 = 유지, null = 삭제" 같은 동작이 나오지 않는다. 그 부분은 백엔드 코드를 읽은 결과이며 실서버 검증이 아니다(아래 서버 규칙 시뮬레이션 참고).

import { check, schemaOf, validate, wire } from '../../testing/contractSchema.ts'

// ---------------------------------------------------------------------------
// 백엔드 코드에서 읽은 동작의 시뮬레이션(실서버 검증이 아니다. 백엔드 코드가 바뀌면 이 부분이 틀릴 수 있다)
// ---------------------------------------------------------------------------
// PATCH /users/me: payload.model_dump(exclude_unset=True) → 보낸 필드만 덮어쓴다. null로 보낸 필드는 null이 된다.
function serverPatchProfile(current: object, body: object): Record<string, unknown> {
  return { ...current, ...Object.fromEntries(Object.entries(body)) }
}
// PUT /users/me/baseline: quality_status 기본값 no_data, valid가 아니면 기준 페이스를 null로 강제, 유효 시간 < 120000이면 insufficient_data + null.
function serverBaselineRule(body: BaselineUpsertRequest): { quality: string; pace: number | null } {
  let quality: string = body.quality_status ?? 'no_data'
  let pace = body.baseline_pace_sec_per_km ?? null
  if (body.skipped || quality !== 'valid') pace = null
  if (body.valid_duration_ms != null && body.valid_duration_ms < 120_000) {
    quality = 'insufficient_data'
    pace = null
  }
  return { quality, pace }
}

// ---------------------------------------------------------------------------
describe('검사기 자체와 스냅샷', () => {
  test('스냅샷에 검사 대상 스키마가 있고, 검사기는 서버 제약 위반을 잡는다', () => {
    for (const name of ['UserProfileUpdateRequest', 'BaselineUpsertRequest', 'RunCreateRequest', 'RunSplitPayload', 'RunReflectionPayload']) schemaOf(name)
    assert.deepEqual(validate(0, { type: 'integer', exclusiveMinimum: 0 }), ['$: 0 <= 0 (초과여야 함)'])
    assert.equal(validate(1, { type: 'integer', exclusiveMinimum: 0 }).length, 0)
    assert.ok(check('RunCreateRequest', {}).some((e) => e.includes('client_session_id')))
    assert.ok(check('UserProfileUpdateRequest', { nickname: 'a' }).length > 0) // minLength 2
    assert.ok(check('UserProfileUpdateRequest', { surprise: 1 }).length > 0) // 스키마에 없는 필드
    assert.equal(check('UserProfileUpdateRequest', { nickname: null }).length, 0) // null은 스키마상 허용(의미는 서버 동작)
  })
})

const T0 = Date.UTC(2026, 10, 20, 9, 0, 0)
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: 'v1', consentedAt: T0 }
const emptyProfile: ProfileData = { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }
const fullProfile: ProfileData = { nickname: '달리미', birthYear: 1999, gender: 'female', heightCm: 165, weightKg: 52 }
const snap = (profile: ProfileData, over: Partial<LocalProfileSnapshot> = {}): LocalProfileSnapshot => ({
  profile, consent, completedAt: T0, experienceLevel: null, weeklyRuns: null, ...over,
})
const cl = (...f: ClearableProfileField[]) => new Set<ClearableProfileField>(f)
const nullKeys = (r: object) => Object.entries(r).filter(([, v]) => v === null).map(([k]) => k)

describe('Profile PATCH 계약', () => {
  test('값이 있는 프로필과 비어 있는 프로필 모두 스키마에 맞는다', () => {
    assert.deepEqual(check('UserProfileUpdateRequest', wire(toProfileUpdateRequest(snap(fullProfile, { experienceLevel: 'beginner', weeklyRuns: '3+' })))), [])
    assert.deepEqual(check('UserProfileUpdateRequest', wire(toProfileUpdateRequest(snap(emptyProfile)))), [])
  })
  test('미입력(null·빈 닉네임)은 null이 아니라 필드 생략이다 — 서버 값을 지우지 않는다', () => {
    const req = toProfileUpdateRequest(snap(emptyProfile))
    for (const key of ['nickname', 'birth_year', 'gender', 'height_cm', 'weight_kg', 'running_experience', 'weekly_runs']) assert.equal(key in req, false, `${key}는 생략되어야 한다`)
    assert.deepEqual(nullKeys(req), [])
    // 서버 동작 시뮬레이션: 기존 서버 값이 그대로 남는다
    const server = { nickname: '서버닉', birth_year: 1990, gender: 'male', height_cm: 180, weight_kg: 70, running_experience: 'regular' }
    assert.deepEqual({ ...serverPatchProfile(server, wire(req)) }, { ...server, consent: req.consent, profile_completed_at: req.profile_completed_at })
  })
  test('일부만 입력하면 입력한 값만 바뀌고 나머지 서버 값은 유지된다', () => {
    const req = toProfileUpdateRequest(snap({ ...emptyProfile, nickname: '새닉', heightCm: 170 }))
    const merged = serverPatchProfile({ nickname: '서버닉', birth_year: 1990, height_cm: 180, weight_kg: 70 }, wire(req))
    assert.equal(merged.nickname, '새닉')
    assert.equal(merged.height_cm, 170)
    assert.equal(merged.birth_year, 1990)
    assert.equal(merged.weight_kg, 70)
  })
  test('명시적 삭제(clear)만 null로 보낸다. 값이 다시 생기면 값을 보낸다', () => {
    const cleared = toProfileUpdateRequest(snap({ ...fullProfile, birthYear: null, weightKg: null }), cl('birth_year', 'weight_kg'))
    assert.deepEqual(nullKeys(cleared).sort(), ['birth_year', 'weight_kg'])
    assert.deepEqual(check('UserProfileUpdateRequest', wire(cleared)), []) // null은 스키마상 유효
    assert.equal(serverPatchProfile({ birth_year: 1990, weight_kg: 70 }, wire(cleared)).birth_year, null)
    const refilled = toProfileUpdateRequest(snap(fullProfile), cl('birth_year'))
    assert.equal(refilled.birth_year, 1999) // 값이 있으면 clear 표시와 무관하게 값
    // clear에 없는 비어 있는 필드는 여전히 생략
    assert.equal('gender' in toProfileUpdateRequest(snap({ ...fullProfile, gender: null }), cl('birth_year')), false)
  })
  test('undefined는 JSON에서 사라지고(생략), null과 구분된다', () => {
    const body = { nickname: undefined, height_cm: null } as unknown as UserProfileUpdateRequest
    assert.deepEqual(Object.keys(wire(body)), ['height_cm'])
    assert.deepEqual(Object.keys(sanitizeProfileRequest(body, cl())), []) // clear 표시 없는 null은 제거
    assert.deepEqual(Object.keys(sanitizeProfileRequest(body, cl('height_cm'))), ['height_cm'])
  })
  test('지울 수 없는 필드(닉네임·경험·주간 횟수)는 clear에 있어도 null로 보내지 않는다', () => {
    const legacy = { nickname: null, running_experience: null, weekly_runs: null, birth_year: null, height_cm: 170 } as unknown as UserProfileUpdateRequest
    assert.deepEqual(sanitizeProfileRequest(legacy, cl('birth_year')), { birth_year: null, height_cm: 170 })
  })
  test('지운 필드 판별: 있던 값이 비면 clear, 값→값·null→null은 아니다', () => {
    assert.deepEqual(clearedProfileFields(fullProfile, { ...fullProfile, birthYear: null, gender: null, heightCm: null, weightKg: null }), ['birth_year', 'gender', 'height_cm', 'weight_kg'])
    assert.deepEqual(clearedProfileFields(fullProfile, { ...fullProfile, heightCm: 170 }), [])
    assert.deepEqual(clearedProfileFields(emptyProfile, emptyProfile), [])
    assert.deepEqual(clearedProfileFields({ ...fullProfile, nickname: 'ab' }, { ...fullProfile, nickname: '' }), []) // 닉네임은 지우기 대상이 아니다
  })
})

// ---------------------------------------------------------------------------
describe('Baseline 계약', () => {
  test('기준으로 채택된 측정(기준 페이스 있음)은 quality_status=valid를 보내 서버에 기준 페이스가 저장된다', () => {
    const req = baselineRequestFromMetrics({ validMs: 300_000, avgPaceSecPerKm: 400, distanceM: 750 }, T0)
    assert.deepEqual(check('BaselineUpsertRequest', wire(req)), [])
    assert.equal(req.quality_status, 'valid')
    assert.deepEqual(serverBaselineRule(wire(req)), { quality: 'valid', pace: 400 })
    // 수정 전(quality_status 생략)이면 서버 규칙상 기준 페이스가 null이 된다는 것을 시뮬레이션으로 보여 준다
    const { quality_status: _omitted, ...legacy } = req
    void _omitted
    assert.deepEqual(serverBaselineRule(legacy), { quality: 'no_data', pace: null })
  })
  test('기준 페이스가 없으면(채택 못 함) quality_status를 보내지 않는다 — 이유를 추측해 gps_poor 등을 보내지 않는다', () => {
    const short = baselineRequestFromMetrics({ validMs: 60_000, avgPaceSecPerKm: 400, distanceM: 150 }, T0)
    assert.equal('quality_status' in short, false)
    assert.equal(short.baseline_pace_sec_per_km, null)
    assert.deepEqual(check('BaselineUpsertRequest', wire(short)), [])
    const noPace = baselineRequestFromMetrics({ validMs: 300_000, avgPaceSecPerKm: null, distanceM: 10 }, T0)
    assert.equal('quality_status' in noPace, false)
    assert.equal(noPace.baseline_pace_sec_per_km, null) // 0이나 추정값으로 채우지 않는다
  })
  test('호출자가 명시한 상태는 그대로 쓰고, 건너뛰기 요청도 스키마에 맞는다', () => {
    assert.equal(baselineRequestFromMetrics({ validMs: 300_000, avgPaceSecPerKm: 400, distanceM: 750 }, T0, 'gps_poor').quality_status, 'gps_poor')
    assert.deepEqual(check('BaselineUpsertRequest', wire(baselineSkippedRequest())), [])
  })
})

// ---------------------------------------------------------------------------
const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    recordId: 'rec-s1', sessionId: 's1', mode: 'gps', startedAt: T0, endedAt: T0 + 1_800_000,
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: 'track-1', reflection: null, sensorReport: null,
    result: {
      elapsedMs: 1_750_000, distanceM: 5000, avgPaceSecPerKm: 350, completion: 'goal',
      splits: [{ index: 1, distanceM: 1000, durationMs: 350_000, paceSecPerKm: 350 }, { index: 2, distanceM: 1000, durationMs: 350_000, paceSecPerKm: null }],
      gpsGaps: [{ lostAtMs: 5000, recoveredAtMs: null }, { lostAtMs: 9000, recoveredAtMs: 12000 }],
    },
    ...over,
  }) as RunRecord
const withResult = (over: Partial<RunRecord['result']>, rec: Partial<RunRecord> = {}): RunRecord => record({ ...rec, result: { ...record().result, ...over } })
const timeRecord = (): RunRecord => record({ mode: 'time', goal: { targetDistanceKm: null, targetDurationSec: null }, result: { elapsedMs: 600_000, distanceM: null, avgPaceSecPerKm: null, splits: [], gpsGaps: [], completion: 'time' } })

const req = (r: RunRecord) => {
  const out = toRunCreateRequest(r, r.sessionId)
  assert.ok(out)
  return out
}

describe('Running 저장 요청 계약', () => {
  test('GPS·TIME 기록의 요청 본문이 스키마에 맞는다', () => {
    assert.deepEqual(check('RunCreateRequest', wire(req(record()))), [])
    assert.deepEqual(check('RunCreateRequest', wire(req(timeRecord()))), [])
    assert.deepEqual(check('RunCreateRequest', wire(req(record({ reflection: { difficulty: 'hard', reasons: ['breath', 'legs'], memo: 'x'.repeat(100) } })))), [])
  })
  // 서버 제약을 어기는 요청: 스키마 검사와 앱의 사전 검사(findRunRequestViolations)가 같은 결론을 내야 한다.
  const invalidCases: Array<[string, RunRecord]> = [
    ['elapsed_ms=0 (0ms 러닝)', withResult({ elapsedMs: 0 })],
    ['elapsed_ms 음수', withResult({ elapsedMs: -5 })],
    ['elapsed_ms 소수', withResult({ elapsedMs: 1000.5 })],
    ['구간 distance_m=0', withResult({ splits: [{ index: 1, distanceM: 0, durationMs: 1000, paceSecPerKm: null }] })],
    ['구간 duration_ms=0', withResult({ splits: [{ index: 1, distanceM: 1000, durationMs: 0, paceSecPerKm: null }] })],
    ['구간 pace=0', withResult({ splits: [{ index: 1, distanceM: 1000, durationMs: 1000, paceSecPerKm: 0 }] })],
    ['구간 index=0', withResult({ splits: [{ index: 0, distanceM: 1000, durationMs: 1000, paceSecPerKm: 300 }] })],
    ['avg_pace=0', withResult({ avgPaceSecPerKm: 0 })],
    ['avg_pace 소수', withResult({ avgPaceSecPerKm: 350.5 })],
    ['distance_m 음수', withResult({ distanceM: -1 })],
    ['목표 거리 0', record({ goal: { targetDistanceKm: 0 as never, targetDurationSec: 1800 } })],
    ['목표 시간 0', record({ goal: { targetDistanceKm: 5, targetDurationSec: 0 as never } })],
    ['GPS 끊김 시각 음수', withResult({ gpsGaps: [{ lostAtMs: -1, recoveredAtMs: null }] })],
    ['메모 101자', record({ reflection: { difficulty: null, reasons: [], memo: 'x'.repeat(101) } })],
    ['client_session_id 129자', record({ sessionId: 's'.repeat(129) })],
  ]
  for (const [name, rec] of invalidCases) {
    test(`서버가 거절할 요청: ${name} — 스키마와 사전 검사가 모두 잡는다`, () => {
      const body = req(rec)
      assert.ok(check('RunCreateRequest', wire(body)).length > 0, '스키마 검사가 위반을 잡아야 한다')
      assert.ok(findRunRequestViolations(body).length > 0, '앱 사전 검사가 위반을 잡아야 한다')
    })
  }
  test('정상 기록은 두 검사 모두 통과한다(값 0이 아닌 정상 경계 포함)', () => {
    for (const rec of [record(), timeRecord(), withResult({ elapsedMs: 1 }), withResult({ distanceM: 0, avgPaceSecPerKm: null, splits: [] })]) {
      const body = req(rec)
      assert.deepEqual(check('RunCreateRequest', wire(body)), [])
      assert.deepEqual(findRunRequestViolations(body), [])
    }
  })
  test('요청 변환은 값을 고치거나 버리지 않는다(어긋난 값도 그대로 나온다 — 거르는 일은 보내기 전 검사의 몫)', () => {
    const body = req(withResult({ elapsedMs: 0 }))
    assert.equal(body.elapsed_ms, 0)
  })
})

// ---------------------------------------------------------------------------
// 런타임: 보내지 않는 기록, 재시도, 중복 저장, 전송 중 회고 수정
// ---------------------------------------------------------------------------
function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function env(opts: { create?: (b: RunCreateRequest, n: number) => Promise<unknown>; localProfile?: () => ProfileData; updateMe?: (b: UserProfileUpdateRequest) => Promise<unknown> } = {}) {
  const storage = mem()
  const sent: RunCreateRequest[] = []
  const profile: UserProfileUpdateRequest[] = []
  const local: RunRecord[] = []
  let clock = 1_000_000
  let current = emptyProfile
  const api: SyncApi = {
    runs: {
      create: async (b) => {
        sent.push(JSON.parse(JSON.stringify(b)) as RunCreateRequest) // 전송 시점의 본문을 고정한다
        return opts.create ? opts.create(b, sent.length) : {}
      },
      list: async () => [],
      get: async () => {
        throw new ApiError(404, 'RUN_NOT_FOUND', 'x')
      },
      updateReflection: async () => undefined,
    },
    users: {
      getMe: async () => {
        throw new NetworkError('x')
      },
      updateMe: async (b) => {
        if (opts.updateMe) await opts.updateMe(b)
        profile.push(JSON.parse(JSON.stringify(b)) as UserProfileUpdateRequest) // 성공한 요청만 기록한다
      },
      putBaseline: async () => undefined,
      updateGuidance: async () => undefined,
    },
  }
  const rt = createSyncRuntime({
    getApi: () => api,
    isSignedIn: () => true,
    getUserId: () => 'user-A',
    queueStorage: storage,
    now: () => clock,
    getLocalProfile: () => ({ profile: opts.localProfile ? opts.localProfile() : current, consent, completedAt: T0, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: () => undefined,
    loadLocalRecords: () => local,
    saveLocalRecord: (r) => void local.push(r),
  })
  return { rt, storage, sent, profile, local, advance: (ms: number) => void (clock += ms), setProfile: (p: ProfileData) => void (current = p) }
}
const ownerQueueItems = (storage: ReturnType<typeof mem>) => {
  const j = JSON.parse(storage.map.get(RUN_SYNC_QUEUE_KEY) ?? '{"owners":{}}') as { owners: Record<string, { items: Array<{ status: string; lastErrorCode: string | null; clientSessionId: string }> }> }
  return j.owners['u:user-A']?.items ?? []
}

describe('보내기 전 검사: 서버가 거절할 기록의 처리', () => {
  test('0ms 러닝은 서버에 보내지 않고 rejected로 보관하며, 로컬 기록은 건드리지 않는다', async () => {
    const e = env()
    const rec = withResult({ elapsedMs: 0 })
    const before = JSON.stringify(rec)
    await e.rt.syncRun(rec)
    await e.rt.syncRun(rec) // 반복해도 중복 등록·전송 없음
    assert.equal(e.sent.length, 0)
    const items = ownerQueueItems(e.storage)
    assert.equal(items.length, 1)
    assert.equal(items[0]?.status, 'rejected')
    assert.equal(items[0]?.lastErrorCode, LOCAL_INVALID_CODE)
    assert.equal(JSON.stringify(rec), before) // 기록 값은 변환·삭제되지 않았다
    assert.equal(e.local.length, 0) // 런타임이 로컬 저장소에 쓰지 않았다
  })
  test('거리가 0인 구간이 있어도 보내지 않는다. 이후 정상 기록은 정상 전송된다', async () => {
    const e = env()
    await e.rt.syncRun(withResult({ splits: [{ index: 1, distanceM: 0, durationMs: 1000, paceSecPerKm: null }] }, { sessionId: 'bad', recordId: 'rec-bad' }))
    await e.rt.syncRun(record({ sessionId: 'ok', recordId: 'rec-ok' }))
    assert.deepEqual(e.sent.map((r) => r.client_session_id), ['ok'])
    assert.deepEqual(ownerQueueItems(e.storage).map((i) => [i.clientSessionId, i.status]), [['bad', 'rejected']])
  })
  test('resume이 rejected 항목을 다시 보내지 않는다(자동 재시도 없음)', async () => {
    const e = env()
    await e.rt.syncRun(withResult({ elapsedMs: 0 }))
    await e.rt.resume()
    assert.equal(e.sent.length, 0)
  })
})

describe('재시도·중복 저장', () => {
  test('네트워크 실패 후 재시도는 같은 본문을 보낸다(항목은 하나, 같은 client_session_id)', async () => {
    const e = env({ create: async (_b, n) => { if (n === 1) throw new NetworkError('offline') } })
    await e.rt.syncRun(record())
    assert.equal(e.sent.length, 1)
    assert.equal(ownerQueueItems(e.storage).length, 1)
    e.advance(10_000) // backoff 이후
    await e.rt.resume()
    assert.equal(e.sent.length, 2)
    assert.deepEqual(e.sent[1], e.sent[0])
    assert.equal(ownerQueueItems(e.storage).length, 0)
  })
  test('같은 sessionId를 여러 번 저장해도 대기 중에는 한 번만 등록된다', async () => {
    const gate = deferred()
    const e = env({ create: async (_b, n) => { if (n === 1) await gate.promise } })
    const p1 = e.rt.syncRun(record())
    await tick()
    const p2 = e.rt.syncRun(record()) // 전송 중에 같은 기록이 다시 저장됨
    gate.resolve()
    await Promise.all([p1, p2])
    assert.equal(e.sent.length, 1)
    assert.equal(ownerQueueItems(e.storage).length, 0)
  })
  test('전송에 성공한 뒤 같은 sessionId를 다시 보내도 본문이 같다(서버 upsert와 충돌하는 필드 변경 없음)', async () => {
    const e = env()
    await e.rt.syncRun(record())
    await e.rt.syncRun(record())
    assert.equal(e.sent.length, 2)
    assert.deepEqual(e.sent[1], e.sent[0])
    assert.equal(new Set(e.sent.map((r) => r.client_session_id)).size, 1)
  })
  test('서버가 처음 값을 유지하는 필드(mode·completion·시작 시각·목표·음악)는 대기열 안에서도 바뀌지 않는다', async () => {
    const e = env({ create: async () => { throw new NetworkError('offline') } })
    await e.rt.syncRun(record())
    const before = e.rt.queue.list()[0]?.request as RunCreateRequest
    // 회고만 갱신 가능하다(서버도 재전송 시 회고를 갱신한다)
    assert.equal(e.rt.queue.updateReflection('s1', { difficulty: 'easy', reasons: [], memo: 'm' }), true)
    // 같은 sessionId의 다른 본문(음악·목표 변경 등)은 새 항목으로 들어가지 않고 무시된다
    assert.equal(e.rt.queue.enqueue({ ...before, music_track_id: 'other', target_distance_km: 10, mode: 'time' }), false)
    const after = e.rt.queue.list()[0]?.request as RunCreateRequest
    const { reflection: _a, ...rest } = after
    const { reflection: _b, ...restBefore } = before
    void _a
    void _b
    assert.deepEqual(rest, restBefore)
    assert.equal(after.reflection?.memo, 'm')
  })
  test('전송 중에 회고를 고치면 최신 회고로 한 번 더 보낸다(서버는 재전송 시 회고를 갱신한다) — 새 회고가 사라지지 않는다', async () => {
    const gate = deferred()
    const e = env({ create: async (_b, n) => { if (n === 1) await gate.promise } })
    const sending = e.rt.syncRun(record())
    await tick()
    const editing = e.rt.syncReflection('s1', { difficulty: 'hard', reasons: ['legs'], memo: '늦게 고침' })
    gate.resolve()
    await Promise.all([sending, editing])
    assert.equal(e.sent.length, 2)
    assert.equal(e.sent[0]?.reflection, null) // 첫 전송은 고치기 전 값
    assert.deepEqual(e.sent[1]?.reflection, { difficulty: 'hard', reasons: ['legs'], memo: '늦게 고침' }) // 서버의 마지막 값이 최신 회고
    assert.equal(ownerQueueItems(e.storage).length, 0)
  })
  test('전송 중 회고 수정이 반복돼도 재전송 횟수에 상한이 있다', async () => {
    let n = 0
    const e = env({
      create: async () => {
        n += 1
        await tick() // 실제 전송처럼 한 번 양보한 뒤(동기 재진입이 아니라) 전송 중에 회고가 바뀐다
        void e.rt.syncReflection('s1', { difficulty: null, reasons: [], memo: `m${n}` })
      },
    })
    await e.rt.syncRun(record())
    assert.ok(e.sent.length <= 4) // 최초 1회 + 재전송 최대 3회
    assert.ok(e.sent.length >= 2)
  })
})

describe('Profile 전송 런타임', () => {
  test('비어 있는 프로필로 완료해도 서버 값을 지우는 null이 나가지 않는다', async () => {
    const e = env()
    await e.rt.syncProfile()
    assert.equal(e.profile.length, 1)
    assert.deepEqual(nullKeys(e.profile[0] as object), [])
    assert.equal('height_cm' in (e.profile[0] as object), false)
  })
  test('사용자가 값을 지우면 그 필드만 null로 나가고, 보내지 못한 채 다른 수정이 쌓여도 지우기가 유지된다', async () => {
    const failing = { on: true }
    const e = env({ updateMe: async () => { if (failing.on) throw new NetworkError('offline') } })
    e.setProfile({ ...fullProfile, birthYear: null })
    await e.rt.syncProfile(['birth_year']) // 지움 + 전송 실패 → 대기 작업으로 남는다
    e.setProfile({ ...fullProfile, birthYear: null, heightCm: 171 }) // 다른 필드를 또 고침(지우기는 이번 변경에 없음)
    await e.rt.syncProfile()
    failing.on = false
    await e.rt.resume()
    const last = e.profile[e.profile.length - 1] as unknown as Record<string, unknown>
    assert.equal(last.birth_year, null) // 지우기 유지
    assert.equal(last.height_cm, 171)
    assert.equal('gender' in last, true) // 값이 있는 필드는 값
    assert.deepEqual(check('UserProfileUpdateRequest', last), [])
    assert.equal(e.rt.pendingSummary('u:user-A').profile, false)
    // 다시 값을 입력하면 null이 아니라 값이 나간다
    e.setProfile({ ...fullProfile })
    await e.rt.syncProfile()
    assert.equal((e.profile[e.profile.length - 1] as unknown as Record<string, unknown>).birth_year, 1999)
  })
  test('이전 버전이 저장한 대기 스냅샷의 null(미입력)은 보내기 전에 걸러진다', async () => {
    const e = env()
    // 이전 버전: 비어 있는 값을 전부 null로 담은 스냅샷이 대기 작업에 남아 있다
    e.storage.map.set(SYNC_PENDING_KEY, JSON.stringify({ version: 2, owners: { 'u:user-A': { profile: true, profileRequest: { nickname: '닉', birth_year: null, gender: null, height_cm: null, weight_kg: null }, baseline: null, voiceGuide: null, reflections: {} } } }))
    await e.rt.resume()
    assert.equal(e.profile.length, 1)
    assert.deepEqual(e.profile[0], { nickname: '닉' })
  })
  test('보낼 내용이 하나도 없으면 요청 없이 대기 표시만 푼다', async () => {
    const e = env()
    e.storage.map.set(SYNC_PENDING_KEY, JSON.stringify({ version: 2, owners: { 'u:user-A': { profile: true, profileRequest: { nickname: null, birth_year: null }, baseline: null, voiceGuide: null, reflections: {} } } }))
    await e.rt.resume()
    assert.equal(e.profile.length, 0)
    assert.equal(e.rt.pendingSummary('u:user-A').profile, false)
  })
})
