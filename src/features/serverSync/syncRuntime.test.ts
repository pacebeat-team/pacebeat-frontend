import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { RunCreateRequest, RunDetailResponse, RunReflectionPayload, UserProfileResponse } from '../../lib/api/types.ts'
import type { ProfileData } from '../profile/types.ts'
import type { RunRecord } from '../running/types.ts'
import { IMPORT_LEDGER_KEY } from './recordImport.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime, SYNC_PENDING_KEY } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'
import { SERVER_GUIDANCE_FIXTURE, blankServerProfile } from '../../testing/testServerProfile.ts'

// 가짜 API·저장소만 쓴다. 실제 서버에는 요청하지 않는다.
const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    recordId: 'rec-s1', sessionId: 's1', mode: 'gps',
    startedAt: Date.UTC(2026, 10, 20, 9, 0), endedAt: Date.UTC(2026, 10, 20, 9, 30),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 1_800_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
    ...over,
  }) as RunRecord

const detail = (sid: string, over: Partial<RunDetailResponse> = {}): RunDetailResponse =>
  ({
    run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal',
    started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T09:30:00.000Z', elapsed_ms: 1_800_000,
    distance_m: 5000, avg_pace_sec_per_km: 360, pace_status: 'ok', has_posture_report: false,
    target_distance_km: 5, target_duration_sec: 1800, target_pace_sec_per_km: null, cadence_spm: null, cadence_status: 'unavailable',
    step_count: null, target_pace_keep_ratio_pct: null, music_track_id: null, splits: [], gps_gaps: [], reflection: null, ...over,
  }) as unknown as RunDetailResponse

const emptyProfile: ProfileData = { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }

function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

interface Opts {
  signedIn?: boolean
  apiOn?: boolean
  create?: (b: RunCreateRequest) => Promise<unknown>
  server?: RunDetailResponse[]
  getMe?: () => Promise<UserProfileResponse>
  failWrites?: boolean
}

function setup(opts: Opts = {}) {
  const storage = mem()
  const sent: RunCreateRequest[] = []
  const profile: unknown[] = []
  const baseline: unknown[] = []
  const guidance: unknown[] = []
  const reflections: Array<[string, RunReflectionPayload]> = []
  const local: RunRecord[] = []
  const patches: Array<Partial<ProfileData>> = []
  let changed = 0
  let localProfile = emptyProfile
  const boom = () => Promise.reject(new NetworkError('x'))
  const api: SyncApi = {
    runs: {
      create: async (b) => { sent.push(b); return opts.create ? opts.create(b) : {} },
      list: async () => (opts.server ?? []).map((d) => ({ ...d, splits: undefined })),
      get: async (id) => { const d = (opts.server ?? []).find((x) => x.run_id === id); if (!d) throw new ApiError(404, 'NOT_FOUND', 'x'); return d },
      updateReflection: async (id, body) => { if (opts.failWrites) return boom(); reflections.push([id, body]) },
    },
    users: {
      getMe: opts.getMe ?? (async () => blankServerProfile()),
      updateMe: async (b) => { if (opts.failWrites) return boom(); profile.push(b) },
      putBaseline: async (b) => { if (opts.failWrites) return boom(); baseline.push(b) },
      updateGuidance: async (b) => { if (opts.failWrites) return boom(); guidance.push(b) },
    },
  }
  const state = { signedIn: opts.signedIn ?? true }
  const rt = createSyncRuntime({
    getApi: () => (opts.apiOn === false ? null : api),
    isSignedIn: () => state.signedIn,
    queueStorage: storage,
    getLocalProfile: () => ({ profile: localProfile, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: (p) => { patches.push(p); localProfile = { ...localProfile, ...p } },
    loadLocalRecords: () => local,
    saveLocalRecord: (r) => void local.push(r),
    onRunsChanged: () => void (changed += 1),
  })
  return { rt, storage, sent, profile, baseline, guidance, reflections, local, patches, state, changed: () => changed, setLocalProfile: (p: ProfileData) => void (localProfile = p) }
}

describe('러닝 기록 전송', () => {
  test('로그인한 상태면 sessionId를 client_session_id로 보낸다', async () => {
    const s = setup()
    await s.rt.syncRun(record())
    assert.equal(s.sent[0]?.client_session_id, 's1')
    assert.equal(s.rt.queue.list().length, 0)
  })
  // 정책 변경(계정별 격리): 게스트에서 만든 작업은 로그인 계정으로 자동 이전·전송하지 않고 보존한다.
  test('게스트·서버 꺼짐이면 대기열에만 남고, 로그인해도 게스트 작업은 보내지 않고 보존한다', async () => {
    const s = setup({ signedIn: false })
    await s.rt.syncRun(record())
    await s.rt.syncRun(record())
    assert.equal(s.rt.queue.list().length, 1)
    assert.equal(s.sent.length, 0)
    s.state.signedIn = true
    await s.rt.resume()
    assert.equal(s.sent.length, 0) // 게스트 작업은 로그인 계정으로 귀속되지 않는다
    assert.equal(s.rt.quarantineSummary().guestQueueItems, 1) // 삭제되지 않고 보존된다
    await s.rt.syncRun(record({ sessionId: 's9', recordId: 'rec-s9' })) // 로그인 후 새로 만든 작업은 보낸다
    assert.deepEqual(s.sent.map((r) => r.client_session_id), ['s9'])
    const off = setup({ apiOn: false })
    await off.rt.syncRun(record())
    assert.equal(off.sent.length, 0)
  })
  test('네트워크 실패는 대기열에 남고 401은 인증 대기가 된다', async () => {
    const net = setup({ create: async () => { throw new NetworkError('x') } })
    await net.rt.syncRun(record())
    assert.equal(net.rt.queue.list()[0]?.status, 'pending')
    const auth = setup({ create: async () => { throw new ApiError(401, 'AUTH_INVALID_TOKEN', 'x') } })
    await auth.rt.syncRun(record())
    assert.equal(auth.rt.queue.list()[0]?.status, 'auth-wait')
    assert.ok(auth.storage.map.has(RUN_SYNC_QUEUE_KEY))
  })
  test('시각을 해석할 수 없는 기록은 요청을 만들지 않는다', async () => {
    const s = setup()
    await s.rt.syncRun(record({ startedAt: Number.NaN }))
    assert.equal(s.sent.length, 0)
  })
})

describe('대기 작업(프로필·기초 측정·음성 안내)', () => {
  // 정책 변경(계정별 격리): 게스트 상태에서 쌓인 대기 작업은 로그인해도 보내지 않는다.
  test('로그인했을 때만 보내고, 게스트 작업은 로그인해도 보내지 않으며, 미입력 값은 보내지 않는다(서버 값 유지)', async () => {
    const s = setup({ signedIn: false })
    await s.rt.syncProfile()
    await s.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(s.profile.length + s.guidance.length, 0)
    s.state.signedIn = true
    await s.rt.resume()
    assert.equal(s.profile.length + s.guidance.length, 0) // 게스트 작업 자동 이전 없음
    assert.deepEqual(s.rt.pendingSummary('guest'), { profile: true, baseline: false, voiceGuide: true, reflections: 0 }) // 보존
    await s.rt.syncProfile()
    await s.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(s.profile.length, 1)
    assert.equal('height_cm' in (s.profile[0] as object), false) // 미입력은 null이 아니라 필드 생략(서버 값을 지우지 않는다)
    assert.equal('weight_kg' in (s.profile[0] as object), false)
    assert.deepEqual(s.guidance, [{ ...SERVER_GUIDANCE_FIXTURE, voice_guidance_enabled: false }]) // 서버의 현재 값 위에 음성 안내만 덮은 전체 payload
    assert.deepEqual(s.rt.pendingSummary(), { profile: false, baseline: false, voiceGuide: false, reflections: 0 })
  })
  test('전송이 실패하면 대기 작업으로 남아 다음에 다시 보낸다', async () => {
    const bad = setup({ failWrites: true })
    await bad.rt.syncProfile()
    await bad.rt.syncBaseline({ skipped: false, baseline_pace_sec_per_km: 400, cadence_spm: null, stride_length_cm: null, valid_duration_ms: 1, distance_m: 1, measured_at: null })
    assert.deepEqual(bad.rt.pendingSummary(), { profile: true, baseline: true, voiceGuide: false, reflections: 0 })
    assert.ok(bad.storage.map.has(SYNC_PENDING_KEY))
  })
})

describe('회고 전송', () => {
  const payload: RunReflectionPayload = { difficulty: 'easy', reasons: [], memo: '좋음' } as RunReflectionPayload
  test('아직 서버에 가지 못한 기록이면 대기열 요청에 최신 회고를 싣는다', async () => {
    const s = setup({ signedIn: false })
    await s.rt.syncRun(record())
    await s.rt.syncReflection('s1', payload)
    assert.deepEqual(s.rt.queue.list()[0]?.request.reflection, payload)
    assert.equal(s.rt.pendingSummary().reflections, 0)
  })
  test('서버에 있는 기록이면 run_id를 찾아 PATCH하고, 없으면 대기 유지한다', async () => {
    const s = setup({ server: [detail('s1')] })
    await s.rt.syncReflection('s1', payload)
    assert.deepEqual(s.reflections, [['r-s1', payload]])
    const none = setup({ server: [] })
    await none.rt.syncReflection('zz', payload)
    assert.equal(none.rt.pendingSummary().reflections, 1)
  })
})

describe('서버 → 로컬 가져오기', () => {
  test('로컬에 없는 서버 기록만 가져오고, 있는 기록은 덮어쓰지 않는다', async () => {
    const s = setup({ server: [detail('s1', { distance_m: 9999 }), detail('s2')] })
    s.local.push(record()) // 로컬 s1
    const n = await s.rt.pullRuns()
    assert.equal(n, 1)
    assert.deepEqual(s.local.map((r) => r.sessionId), ['s1', 's2'])
    assert.equal(s.local[0]?.result.distanceM, 5000) // 로컬 s1은 그대로
    assert.equal(s.local[1]?.recordId, 'rec-s2')
    assert.equal(s.changed(), 1)
  })
  test('한 번 본 기록은 로컬에서 지워도 다시 가져오지 않는다', async () => {
    const s = setup({ server: [detail('s2')] })
    await s.rt.pullRuns()
    s.local.length = 0 // 사용자가 로컬 기록을 지움
    assert.equal(await s.rt.pullRuns(), 0)
    assert.equal(s.local.length, 0)
    assert.ok(s.storage.map.has(IMPORT_LEDGER_KEY))
  })
  test('형식이 맞지 않는 서버 기록은 건너뛰고 로컬을 건드리지 않는다', async () => {
    const s = setup({ server: [detail('bad', { target_distance_km: 3.3, target_duration_sec: null })] })
    assert.equal(await s.rt.pullRuns(), 0)
    assert.equal(s.local.length, 0)
  })
  test('게스트·서버 오류면 아무것도 하지 않는다', async () => {
    const g = setup({ signedIn: false, server: [detail('s2')] })
    assert.equal(await g.rt.pullRuns(), 0)
    assert.equal(g.local.length, 0)
  })
})

describe('서버 → 로컬 프로필', () => {
  const remote = (over: object = {}) =>
    ({ user_id: 'u', nickname: '서버닉', birth_year: 1999, gender: 'female', height_cm: 165, weight_kg: 55, running_experience: null, consent: { age_over_14: true, terms_of_service: true, privacy_policy: true, location_terms: true }, guidance: {}, onboarding_completed_at: null, profile_completed_at: null, ...over }) as UserProfileResponse
  test('비어 있는 칸만 채우고 이미 있는 값은 덮어쓰지 않는다', async () => {
    const s = setup({ getMe: async () => remote() })
    s.setLocalProfile({ ...emptyProfile, nickname: '내닉', heightCm: 170 })
    await s.rt.pullProfile()
    assert.deepEqual(s.patches[0], { birthYear: 1999, gender: 'female', weightKg: 55 })
  })
  test('서버 오류면 변경하지 않는다', async () => {
    const s = setup({ getMe: async () => { throw new NetworkError('x') } })
    await s.rt.pullProfile()
    assert.equal(s.patches.length, 0)
  })
})

describe('실서버 연동 확장 (기초 측정 복원·안내 설정 4종·전체 기록 삭제)', () => {
  test('pullBaseline: 서버에 유효한 기준 페이스가 있으면 applyRemoteBaseline으로 전달한다', async () => {
    const received: unknown[] = []
    const api: SyncApi = {
      runs: { create: async () => ({}), list: async () => [], get: async () => detail('s1'), updateReflection: async () => undefined },
      users: {
        getMe: async () => blankServerProfile(),
        updateMe: async () => undefined,
        getBaseline: async () => ({
          user_id: 'u1',
          skipped: false,
          quality_status: 'valid',
          baseline_pace_sec_per_km: 390,
          cadence_spm: 162,
          stride_length_cm: 95,
          valid_duration_ms: 180_000,
          distance_m: 460,
          measured_at: '2026-11-20T09:00:00.000Z',
        }),
        putBaseline: async () => undefined,
        updateGuidance: async () => undefined,
      },
    }
    const rt = createSyncRuntime({
      getApi: () => api,
      isSignedIn: () => true,
      queueStorage: mem(),
      applyRemoteBaseline: (b) => void received.push(b),
    })
    await rt.pullBaseline()
    assert.equal(received.length, 1)
    assert.equal((received[0] as { paceSecPerKm: number }).paceSecPerKm, 390)
  })

  test('syncVoiceGuidance & pullProfile: 안내 설정 4종(voiceGuide·beatGuide·frequency·autoPause) 양방향 동기화', async () => {
    const sentGuidance: unknown[] = []
    const appliedGuidance: unknown[] = []
    const api: SyncApi = {
      runs: { create: async () => ({}), list: async () => [], get: async () => detail('s1'), updateReflection: async () => undefined },
      users: {
        getMe: async () =>
          blankServerProfile({
            ...SERVER_GUIDANCE_FIXTURE,
            beat_guidance_enabled: false,
            guidance_frequency_mode: 'both',
            auto_pause_enabled: false,
          }),
        updateMe: async () => undefined,
        putBaseline: async () => undefined,
        updateGuidance: async (b) => void sentGuidance.push(b),
      },
    }
    const rt = createSyncRuntime({
      getApi: () => api,
      isSignedIn: () => true,
      queueStorage: mem(),
      getLocalProfile: () => ({ profile: emptyProfile, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
      applyProfilePatch: () => undefined,
      applyRemoteGuidance: (g) => void appliedGuidance.push(g),
    })
    await rt.syncVoiceGuidance({ voiceGuide: false, beatGuide: true, frequency: 'offPace', autoPause: true })
    assert.equal(sentGuidance.length, 1)
    assert.deepEqual(sentGuidance[0], {
      ...SERVER_GUIDANCE_FIXTURE,
      voice_guidance_enabled: false,
      beat_guidance_enabled: true,
      guidance_frequency_mode: 'offPace',
      auto_pause_enabled: true,
    })
    await rt.pullProfile()
    assert.equal(appliedGuidance.length, 1)
    assert.equal((appliedGuidance[0] as { guidance_frequency_mode?: string }).guidance_frequency_mode, 'both')
  })

  test('syncDeleteAllRuns: 서버 전체 러닝 기록 삭제 호출 후 가져오기 장부를 초기화한다', async () => {
    const storage = mem()
    storage.setItem(IMPORT_LEDGER_KEY, JSON.stringify({ version: 1, ids: ['s1', 's2'] }))
    let deleteAllCalls = 0
    const api: SyncApi = {
      runs: {
        create: async () => ({}),
        list: async () => [],
        get: async () => detail('s1'),
        updateReflection: async () => undefined,
        deleteAll: async () => {
          deleteAllCalls += 1
          return { deleted_count: 2 }
        },
      },
      users: {
        getMe: async () => blankServerProfile(),
        updateMe: async () => undefined,
        putBaseline: async () => undefined,
        updateGuidance: async () => undefined,
      },
    }
    const rt = createSyncRuntime({
      getApi: () => api,
      isSignedIn: () => true,
      queueStorage: storage,
    })
    await rt.syncDeleteAllRuns()
    assert.equal(deleteAllCalls, 1)
    assert.equal(storage.getItem(IMPORT_LEDGER_KEY), JSON.stringify({ version: 1, ids: [] }))
  })
})
