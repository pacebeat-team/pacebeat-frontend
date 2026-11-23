import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createApiClient } from '../../lib/api/client.ts'
import { createApi } from '../../lib/api/endpoints.ts'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { FullGuidancePayload, GuidanceSettingsPayload, RunCreateRequest, UserProfileResponse } from '../../lib/api/types.ts'
import { check, spec, wire } from '../../testing/contractSchema.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'
import { MUSIC_TRACKS } from '../running/music.ts'
import type { RunRecord } from '../running/types.ts'
import { mergeServerGuidance, SERVER_GUIDANCE_DEFAULTS, toFullGuidancePayload } from './guidanceMapper.ts'
import { compareMusicPresets, parseMusicPresets } from './musicMapper.ts'
import { planImport } from './recordImport.ts'
import { parseRunList, toRunCreateRequest } from './runMapper.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// 백엔드 답변을 기다리는 동안 진행한 프론트엔드 준비 작업의 계약 테스트.
// 가짜 API·저장소만 쓴다. 실제 서버(운영 포함)에는 요청하지 않으며, 아래 "서버 동작 시뮬레이션"은 백엔드 코드를 읽은 결과이지 실서버 검증이 아니다.

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------
// 백엔드 update_my_guidance 시뮬레이션: 요청 본문 전체를 4개 컬럼에 쓴다. GuidanceSettingsPayload의 생략된 필드는 스키마 기본값이다(exclude_unset 없음).
function serverReplaceGuidance(body: GuidanceSettingsPayload): FullGuidancePayload {
  return { ...SERVER_GUIDANCE_DEFAULTS, ...(body as Partial<FullGuidancePayload>) }
}

const SERVER_NOW: FullGuidancePayload = { voice_guidance_enabled: true, vibration_guidance_enabled: false, guidance_frequency_km: 2.5, vibration_intensity: 'high' }

describe('Guidance: 서버가 4개 필드를 전부 교체하므로 항상 전체 payload를 보낸다', () => {
  test('(근거) 음성 안내만 보내면 서버의 나머지 3개 설정이 기본값으로 초기화된다 — 그래서 부분 전송을 쓰지 않는다', () => {
    assert.deepEqual(serverReplaceGuidance({ voice_guidance_enabled: false }), { voice_guidance_enabled: false, vibration_guidance_enabled: true, guidance_frequency_km: 1, vibration_intensity: 'medium' })
  })
  test('음성 안내를 바꿔도 서버의 진동·빈도·강도는 그대로 유지된다', () => {
    for (const voice of [true, false]) {
      const body = toFullGuidancePayload({ voiceGuide: voice }, SERVER_NOW) as FullGuidancePayload
      assert.deepEqual(check('GuidanceSettingsPayload', wire(body)), [])
      assert.deepEqual(serverReplaceGuidance(wire(body)), { ...SERVER_NOW, voice_guidance_enabled: voice })
    }
  })
  test('서버의 각 필드 값(진동 켬/끔, 빈도 경계값, 강도 3종)이 변경 없이 보존된다', () => {
    for (const vib of [true, false]) assert.equal(toFullGuidancePayload({ voiceGuide: true }, { ...SERVER_NOW, vibration_guidance_enabled: vib })?.vibration_guidance_enabled, vib)
    for (const km of [0.5, 1, 2.5, 10]) assert.equal(toFullGuidancePayload({ voiceGuide: true }, { ...SERVER_NOW, guidance_frequency_km: km })?.guidance_frequency_km, km)
    for (const level of ['low', 'medium', 'high'] as const) assert.equal(toFullGuidancePayload({ voiceGuide: true }, { ...SERVER_NOW, vibration_intensity: level })?.vibration_intensity, level)
  })
  test('서버 값 4개 중 하나라도 누락·null·잘못된 타입·계약 밖이면 기본값으로 채우지 않고 null(전송 보류)이다', () => {
    const bad: unknown[] = [null, undefined, {}, [], 'x', 1,
      { ...SERVER_NOW, voice_guidance_enabled: undefined }, { ...SERVER_NOW, voice_guidance_enabled: null }, { ...SERVER_NOW, voice_guidance_enabled: 'true' },
      { ...SERVER_NOW, vibration_guidance_enabled: undefined }, { ...SERVER_NOW, vibration_guidance_enabled: 'yes' }, { ...SERVER_NOW, vibration_guidance_enabled: 0 },
      { ...SERVER_NOW, guidance_frequency_km: undefined }, { ...SERVER_NOW, guidance_frequency_km: null }, { ...SERVER_NOW, guidance_frequency_km: 0.1 },
      { ...SERVER_NOW, guidance_frequency_km: 11 }, { ...SERVER_NOW, guidance_frequency_km: Number.NaN }, { ...SERVER_NOW, guidance_frequency_km: Infinity }, { ...SERVER_NOW, guidance_frequency_km: '2' },
      { ...SERVER_NOW, vibration_intensity: undefined }, { ...SERVER_NOW, vibration_intensity: null }, { ...SERVER_NOW, vibration_intensity: 'max' }, { ...SERVER_NOW, vibration_intensity: 'HIGH' }, { ...SERVER_NOW, vibration_intensity: 3 }]
    for (const server of bad) assert.equal(toFullGuidancePayload({ voiceGuide: false }, server), null, JSON.stringify(server))
    // 서버 기본값은 시뮬레이션용이며 보정에는 쓰이지 않는다
    assert.equal(toFullGuidancePayload({ voiceGuide: false }, {}), null)
  })
  test('경계값(0.5·10 km, 3종 강도)은 유효하고 OpenAPI를 만족한다', () => {
    for (const km of [0.5, 10]) for (const level of ['low', 'medium', 'high'] as const) {
      const body = toFullGuidancePayload({ voiceGuide: true }, { ...SERVER_NOW, guidance_frequency_km: km, vibration_intensity: level })
      assert.deepEqual(check('GuidanceSettingsPayload', wire(body)), [])
    }
  })
  test('서버 응답을 로컬에 반영해도 박자 안내·빈도·자동 일시정지 등 로컬 설정은 바뀌지 않는다', () => {
    const local = { beatGuide: false, voiceGuide: true, frequency: 'both' as const, autoPause: false }
    for (const server of [SERVER_NOW, { ...SERVER_NOW, voice_guidance_enabled: false }, {}, null, undefined]) {
      const merged = mergeServerGuidance(local, server)
      assert.equal(merged.beatGuide, false)
      assert.equal(merged.frequency, 'both')
      assert.equal(merged.autoPause, false)
    }
  })
})

interface GuidanceWorld {
  rt: ReturnType<typeof createSyncRuntime>
  sent: FullGuidancePayload[]
  state: { server: UserProfileResponse | null; getMeError: boolean; updateError: boolean; signedIn: boolean }
  patches: object[]
  storage: ReturnType<typeof mem>
}
function guidanceWorld(): GuidanceWorld {
  const storage = mem()
  const sent: FullGuidancePayload[] = []
  const patches: object[] = []
  const state = { server: blankServerProfile(SERVER_NOW) as UserProfileResponse | null, getMeError: false, updateError: false, signedIn: true }
  const api: SyncApi = {
    runs: { create: async () => ({}), list: async () => [], get: async () => { throw new ApiError(404, 'NOT_FOUND', 'x') }, updateReflection: async () => undefined },
    users: {
      getMe: async () => { if (state.getMeError) throw new NetworkError('x'); return state.server as UserProfileResponse },
      updateMe: async () => undefined,
      putBaseline: async () => undefined,
      updateGuidance: async (b) => { if (state.updateError) throw new ApiError(503, 'UNAVAILABLE', 'x'); sent.push(wire(b)); state.server = blankServerProfile(b) },
    },
  }
  const rt = createSyncRuntime({
    getApi: () => api,
    isSignedIn: () => state.signedIn,
    getUserId: () => 'user-A',
    queueStorage: storage,
    now: () => 1_000_000,
    getLocalProfile: () => ({ profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }, consent: { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: (p) => void patches.push(p),
    loadLocalRecords: () => [],
    saveLocalRecord: () => undefined,
  })
  return { rt, sent, state, patches, storage }
}

describe('Guidance 전송(런타임)', () => {
  test('서버의 현재 값을 읽어 음성 안내만 바꾼 전체 payload를 보내고, 성공하면 대기가 비워진다', async () => {
    const w = guidanceWorld()
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.deepEqual(w.sent, [{ ...SERVER_NOW, voice_guidance_enabled: false }])
    assert.equal(w.rt.pendingSummary().voiceGuide, false)
    assert.deepEqual(check('GuidanceSettingsPayload', w.sent[0]), [])
  })
  test('서버의 현재 값을 읽지 못하면 보내지 않고 대기를 유지한다(나머지 설정 초기화 방지). 복구되면 보낸다', async () => {
    const w = guidanceWorld()
    w.state.getMeError = true
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary().voiceGuide, true)
    w.state.getMeError = false
    await w.rt.resume()
    assert.deepEqual(w.sent, [{ ...SERVER_NOW, voice_guidance_enabled: false }])
    assert.equal(w.rt.pendingSummary().voiceGuide, false)
  })
  test('비정상 응답(빈 본문=null, 안내 설정이 없는 객체)이면 예외 없이 보내지 않고 대기를 유지한다', async () => {
    const empty = guidanceWorld()
    empty.state.server = null // 빈 응답 본문(204 또는 JSON 아님)은 클라이언트가 null로 읽는다
    await empty.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(empty.sent.length, 0)
    assert.equal(empty.rt.pendingSummary().voiceGuide, true)
    const noGuidance = guidanceWorld()
    noGuidance.state.server = { ...blankServerProfile(), guidance: undefined } as unknown as UserProfileResponse
    await noGuidance.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(noGuidance.sent.length, 0) // 기본값으로 채워 보내지 않는다(다른 설정을 덮지 않기 위해)
    assert.equal(noGuidance.rt.pendingSummary().voiceGuide, true)
  })
  test('전송이 5xx로 실패하면 대기가 남고, 다시 시도할 때 그 사이 서버에서 바뀐 값까지 새로 읽어 보존한다', async () => {
    const w = guidanceWorld()
    w.state.updateError = true
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary().voiceGuide, true)
    w.state.updateError = false
    w.state.server = blankServerProfile({ ...SERVER_NOW, vibration_intensity: 'low', guidance_frequency_km: 5 }) // 다른 기기에서 바뀐 값
    await w.rt.resume()
    assert.deepEqual(w.sent, [{ voice_guidance_enabled: false, vibration_guidance_enabled: false, guidance_frequency_km: 5, vibration_intensity: 'low' }])
  })
  test('전송 중에 설정을 다시 바꾸면 첫 응답이 대기를 지우지 않고 마지막 값이 다시 전송된다', async () => {
    const w = guidanceWorld()
    const gate = deferred()
    const original = w.state.server
    // 첫 getMe를 붙잡아 둔 채 두 번째 변경을 넣는다
    const api2: SyncApi = {
      runs: { create: async () => ({}), list: async () => [], get: async () => { throw new ApiError(404, 'NOT_FOUND', 'x') }, updateReflection: async () => undefined },
      users: {
        getMe: async () => { await gate.promise; return original as UserProfileResponse },
        updateMe: async () => undefined,
        putBaseline: async () => undefined,
        updateGuidance: async (b) => { w.sent.push(wire(b)) },
      },
    }
    const rt = createSyncRuntime({
      getApi: () => api2, isSignedIn: () => true, getUserId: () => 'user-A', queueStorage: mem(), now: () => 1,
      getLocalProfile: () => ({ profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }, consent: { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
      applyProfilePatch: () => undefined, loadLocalRecords: () => [], saveLocalRecord: () => undefined,
    })
    const first = rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    const second = rt.syncVoiceGuidance({ voiceGuide: true })
    gate.resolve()
    await Promise.all([first, second])
    await tick()
    assert.equal(w.sent.at(-1)?.voice_guidance_enabled, true) // 마지막 선택이 서버의 최종 값
    assert.equal(rt.pendingSummary().voiceGuide, false)
  })
  test('서버 안내 설정을 가져와도 로컬 설정에는 적용하지 않는다(프로필 채우기는 안내 설정을 건드리지 않는다)', async () => {
    const w = guidanceWorld()
    w.state.server = blankServerProfile({ ...SERVER_NOW, voice_guidance_enabled: false })
    await w.rt.pullProfile()
    assert.equal(w.patches.length, 0)
  })
  test('게스트(로그인 안 함)에서는 서버 요청이 나가지 않고 대기만 남는다', async () => {
    const w = guidanceWorld()
    w.state.signedIn = false
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(w.sent.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Music presets
// ---------------------------------------------------------------------------
// 백엔드 sql/001_init_schema_and_rls.sql의 music_presets 시드(저장소 읽기 결과). 서버 응답 직렬화는 id/title/subtitle/bpm/recommendedPaceSecPerKm(camelCase).
const BACKEND_SEED = [
  { id: 'morning-stride', title: 'Morning Stride', subtitle: '상쾌한 아침 러닝을 여는 경쾌한 리듬', bpm: 158, recommendedPaceSecPerKm: 420 },
  { id: 'city-loop', title: 'City Loop', subtitle: '도심 페이스를 일정하게 유지해 주는 비트', bpm: 156, recommendedPaceSecPerKm: 435 },
  { id: 'easy-tempo', title: 'Easy Tempo', subtitle: '호흡과 발걸음을 안정시키는 템포', bpm: 160, recommendedPaceSecPerKm: 400 },
  { id: 'night-pace', title: 'Night Pace', subtitle: '저녁 러닝에 어울리는 편안한 그루브', bpm: 150, recommendedPaceSecPerKm: 450 },
]

describe('Music presets', () => {
  test('백엔드 시드의 id·제목·BPM이 프론트엔드 MUSIC_TRACKS와 일치한다', () => {
    const cmp = compareMusicPresets(parseMusicPresets(BACKEND_SEED))
    assert.deepEqual(cmp.matched, MUSIC_TRACKS.map((t) => t.id))
    assert.deepEqual([cmp.serverOnly, cmp.localOnly, cmp.differing], [[], [], []])
  })
  test('시드 응답은 OpenAPI MusicPresetResponse를 만족하고 파서가 값을 바꾸지 않는다', () => {
    for (const item of BACKEND_SEED) assert.deepEqual(check('MusicPresetResponse', item), [])
    assert.deepEqual(parseMusicPresets(BACKEND_SEED), BACKEND_SEED)
  })
  test('빈 응답·배열이 아닌 응답·일부 항목 누락은 안전하게 처리한다(예외 없음, 확인되지 않은 값을 만들지 않는다)', () => {
    assert.deepEqual(parseMusicPresets([]), [])
    for (const raw of [null, undefined, {}, 'x', 1, '[]']) assert.deepEqual(parseMusicPresets(raw), [])
    const parsed = parseMusicPresets([
      { id: 'a', title: 'A', bpm: 150 }, // subtitle·권장 페이스 생략 → null
      { id: '', title: 'x', bpm: 1 }, { id: 'b', title: '', bpm: 1 }, { id: 'c', title: 'C' }, { id: 'd', title: 'D', bpm: 0 },
      { id: 'e', title: 'E', bpm: 150.5 }, { id: 5, title: 'F', bpm: 150 }, null, 'x', [],
      { id: 'a', title: 'dup', bpm: 100 }, // 같은 id는 처음 것만
      { id: 'g', title: 'G', bpm: 140, subtitle: 3, recommendedPaceSecPerKm: -1, extra: 'ignored' },
    ])
    assert.deepEqual(parsed, [
      { id: 'a', title: 'A', bpm: 150, subtitle: null, recommendedPaceSecPerKm: null },
      { id: 'g', title: 'G', bpm: 140, subtitle: null, recommendedPaceSecPerKm: null },
    ])
  })
  test('서버 목록이 일부 누락·추가되어도 로컬 음악 선택지는 변하지 않는다', () => {
    const before = JSON.stringify(MUSIC_TRACKS)
    const partial = parseMusicPresets(BACKEND_SEED.slice(0, 2).concat([{ id: 'new-track', title: 'N', subtitle: '', bpm: 170, recommendedPaceSecPerKm: 400 }]))
    const cmp = compareMusicPresets(partial)
    assert.deepEqual(cmp.localOnly, ['easy-tempo', 'night-pace'])
    assert.deepEqual(cmp.serverOnly, ['new-track'])
    assert.equal(JSON.stringify(MUSIC_TRACKS), before)
    assert.equal(Object.isFrozen(MUSIC_TRACKS), true)
  })
  test('id는 같지만 제목·BPM이 다르면 differing으로 드러난다', () => {
    const cmp = compareMusicPresets(parseMusicPresets([{ ...BACKEND_SEED[0], bpm: 170 }, { ...BACKEND_SEED[1], title: 'Other' }]))
    assert.deepEqual(cmp.differing, ['morning-stride', 'city-loop'])
  })
})

// ---------------------------------------------------------------------------
// Run 저장 계약: upsert 시 갱신되는 필드와 불변 필드
// ---------------------------------------------------------------------------
// 백엔드 run_service.upsert_run_session의 ON CONFLICT (user_id, client_session_id) DO UPDATE SET 목록(저장소 읽기 결과).
const SERVER_UPDATES_ON_RESEND = ['ended_at', 'elapsed_ms', 'distance_m', 'avg_pace_sec_per_km', 'cadence_spm', 'step_count', 'target_pace_keep_ratio_pct', 'pace_status', 'cadence_status', 'gps_gaps', 'reflection_difficulty', 'reflection_reasons', 'reflection_memo'] as const

const rec = (sid: string, over: Partial<RunRecord> = {}): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: 'city-loop', reflection: null, sensorReport: null,
    result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
    ...over,
  }) as RunRecord

describe('Run 저장 계약(upsert)', () => {
  test('client_session_id는 로컬 sessionId이고, recordId와 서버 run_id는 요청 본문에 들어가지 않는다', () => {
    const body = toRunCreateRequest(rec('s-1'), 's-1') as unknown as Record<string, unknown>
    assert.equal(body.client_session_id, 's-1')
    assert.equal('run_id' in body, false)
    assert.equal('recordId' in body, false)
    assert.deepEqual(check('RunCreateRequest', wire(body)), [])
  })
  test('같은 기록을 회고만 바꿔 다시 만들면 본문 차이는 서버가 갱신하는 필드로만 한정된다(불변 필드는 같다)', () => {
    const first = wire(toRunCreateRequest(rec('s-1'), 's-1') as RunCreateRequest) as unknown as Record<string, unknown>
    const again = wire(toRunCreateRequest(rec('s-1', { reflection: { difficulty: 'hard', reasons: [], memo: '수정' } as never }), 's-1') as RunCreateRequest) as unknown as Record<string, unknown>
    const keys = new Set([...Object.keys(first), ...Object.keys(again)])
    const changed = [...keys].filter((k) => JSON.stringify(first[k]) !== JSON.stringify(again[k]))
    assert.ok(changed.length > 0)
    const immutable = changed.filter((k) => !(SERVER_UPDATES_ON_RESEND as readonly string[]).includes(k) && k !== 'reflection')
    assert.deepEqual(immutable, []) // started_at·mode·completion·목표·음악·구간은 바뀌지 않는다
  })
  test('(서버 규칙) started_at·mode·completion·목표·음악은 재전송해도 서버에서 갱신되지 않는다 — 프론트는 최초 전송 후 이 값을 바꾸지 않는다', () => {
    const body = wire(toRunCreateRequest(rec('s-1'), 's-1') as RunCreateRequest) as unknown as Record<string, unknown>
    const immutableKeys = Object.keys(body).filter((k) => !(SERVER_UPDATES_ON_RESEND as readonly string[]).includes(k))
    for (const must of ['started_at', 'mode', 'completion', 'client_session_id']) assert.ok(immutableKeys.includes(must), must)
  })
})

// ---------------------------------------------------------------------------
// GET /runs 계약(날짜 필터·정렬·페이지네이션 없음)
// ---------------------------------------------------------------------------
describe('GET /runs 계약', () => {
  const calls: string[] = []
  const api = createApi(createApiClient({ baseUrl: 'https://x.test', fetch: (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch }))
  test('쿼리는 from·to(ISO date-time)만 보내고 페이지네이션 파라미터를 만들지 않는다', async () => {
    calls.length = 0
    await api.runs.list()
    await api.runs.list({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T23:59:59.999Z' })
    assert.equal(new URL(calls[0]).search, '')
    const q = new URL(calls[1]).searchParams
    assert.deepEqual([...q.keys()].sort(), ['from', 'to'])
    for (const banned of ['limit', 'offset', 'page', 'cursor', 'page_size', 'sort']) assert.equal(q.has(banned), false)
  })
  test('OpenAPI의 /runs GET 파라미터는 from·to뿐이다(스냅샷)', () => {
    const paths = (spec as unknown as { paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }> }).paths
    assert.deepEqual((paths['/api/v1/runs'].get?.parameters ?? []).map((p) => p.name), ['from', 'to'])
  })
  test('서버 정렬(started_at 내림차순)에 의존하지 않고 비정상 목록에도 안전하다', () => {
    const item = (sid: string, started: string) => ({ run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal', started_at: started, ended_at: started, elapsed_ms: 1000, distance_m: 1000, avg_pace_sec_per_km: 300, pace_status: 'valid', has_posture_report: false })
    const asc = parseRunList([item('a', '2026-11-01T00:00:00Z'), item('b', '2026-11-02T00:00:00Z')])
    const desc = parseRunList([item('b', '2026-11-02T00:00:00Z'), item('a', '2026-11-01T00:00:00Z')])
    assert.deepEqual(new Set(planImport(asc ?? [], new Set(), new Set()).map((r) => r.clientSessionId)), new Set(planImport(desc ?? [], new Set(), new Set()).map((r) => r.clientSessionId)))
    assert.equal(parseRunList(null), null)
    assert.equal(parseRunList('x'), null)
    assert.deepEqual(parseRunList([]), [])
    assert.deepEqual(parseRunList([null, 1, {}]), [])
  })
  test('로컬에 있는 기록·장부(삭제한 기록)에 있는 기록은 가져올 대상에서 빠진다', () => {
    const item = (sid: string) => ({ run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal', started_at: '2026-11-01T00:00:00Z', ended_at: '2026-11-01T00:30:00Z', elapsed_ms: 1000, distance_m: 1000, avg_pace_sec_per_km: 300, pace_status: 'valid', has_posture_report: false })
    const list = parseRunList(['local', 'deleted', 'new', 'new'].map(item)) ?? []
    assert.deepEqual(planImport(list, new Set(['local']), new Set(['deleted'])).map((r) => r.clientSessionId), ['new'])
  })
})
