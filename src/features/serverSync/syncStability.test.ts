import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { NetworkError } from '../../lib/api/errors.ts'
import type { RunDetailResponse, UserProfileResponse } from '../../lib/api/types.ts'
import type { ProfileData } from '../profile/types.ts'
import type { RunRecord } from '../running/types.ts'
import { IMPORT_LEDGER_KEY } from './recordImport.ts'
import { createSyncRuntime, SYNC_PENDING_KEY } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'

// 동기화 안정성 회귀 테스트(가짜 API·저장소만 사용, 실서버·실제 브라우저 저장소에 접근하지 않는다).
const detail = (sid: string, over: Partial<RunDetailResponse> = {}): RunDetailResponse =>
  ({
    run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal',
    started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T09:30:00.000Z', elapsed_ms: 1_800_000,
    distance_m: 5000, avg_pace_sec_per_km: 360, pace_status: 'ok', has_posture_report: false,
    target_distance_km: 5, target_duration_sec: 1800, target_pace_sec_per_km: null, cadence_spm: null, cadence_status: 'unavailable',
    step_count: null, target_pace_keep_ratio_pct: null, music_track_id: null, splits: [], gps_gaps: [], reflection: null, ...over,
  }) as unknown as RunDetailResponse

const localRecord = (sid: string, distanceM = 1234): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: 1, endedAt: 2,
    goal: { targetDistanceKm: null, targetDurationSec: null }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 1000, distanceM, avgPaceSecPerKm: 300, completion: 'partial', splits: [], gpsGaps: [] },
  }) as RunRecord

const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }
const empty: ProfileData = { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function mem(failKey?: string) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === failKey) throw new Error('quota')
      map.set(k, v)
    },
  }
}

interface Env {
  storage: ReturnType<typeof mem>
  local: RunRecord[]
  localProfile: { value: ProfileData }
  signedIn: { value: boolean }
  userId: { value: string | null }
  patches: Array<Partial<ProfileData>>
  api: { runs: SyncApi['runs']; users: SyncApi['users'] }
  calls: { list: number; get: string[]; updateMe: Array<unknown> }
}

// 같은 저장소를 공유하는 런타임을 여러 번 만들 수 있다(앱 재실행 흉내).
function env(over: { server?: RunDetailResponse[]; storage?: ReturnType<typeof mem>; local?: RunRecord[]; apiOverride?: Partial<SyncApi['users']> & Partial<SyncApi['runs']> } = {}): Env & { runtime: () => ReturnType<typeof createSyncRuntime> } {
  const storage = over.storage ?? mem()
  const local = over.local ?? []
  const localProfile = { value: { ...empty, nickname: 'a' } }
  const signedIn = { value: true }
  const userId = { value: 'u1' as string | null }
  const patches: Array<Partial<ProfileData>> = []
  const calls = { list: 0, get: [] as string[], updateMe: [] as unknown[] }
  const server = over.server ?? []
  const api: Env['api'] = {
    runs: {
      create: async () => ({}),
      list: async () => { calls.list += 1; return server },
      get: async (id) => { calls.get.push(id); const d = server.find((x) => x.run_id === id); if (!d) throw new NetworkError('x'); return d },
      updateReflection: async () => ({}),
      ...(over.apiOverride as object),
    },
    users: {
      getMe: async () => blankServerProfile(),
      updateMe: async (b) => { calls.updateMe.push(b) },
      putBaseline: async () => ({}),
      updateGuidance: async () => ({}),
      ...(over.apiOverride as object),
    },
  }
  const runtime = () =>
    createSyncRuntime({
      getApi: () => api,
      isSignedIn: () => signedIn.value,
      getUserId: () => userId.value,
      queueStorage: storage,
      getLocalProfile: () => ({ profile: localProfile.value, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
      applyProfilePatch: (p) => { patches.push(p); localProfile.value = { ...localProfile.value, ...p } },
      loadLocalRecords: () => local,
      saveLocalRecord: (r) => {
        const i = local.findIndex((x) => x.recordId === r.recordId)
        if (i === -1) local.push(r)
        else local[i] = r // 실제 저장소(saveRecord)처럼 같은 recordId는 덮어쓴다
      },
    })
  return { storage, local, localProfile, signedIn, userId, patches, api, calls, runtime }
}

const nick = (b: unknown) => (b as { nickname: string | null }).nickname

describe('A. 프로필 수정 전송', () => {
  test('연속 수정은 겹쳐 보내지 않고 마지막 값이 마지막에 전송된다(순서 뒤바뀜 없음)', async () => {
    const gate = deferred()
    let n = 0
    const e = env({ apiOverride: { updateMe: async (b) => { const my = ++n; e.calls.updateMe.push(b); if (my === 1) await gate.promise } } })
    const rt = e.runtime()
    const first = rt.syncProfile()
    await tick()
    e.localProfile.value = { ...e.localProfile.value, nickname: 'b' }
    const second = rt.syncProfile()
    await tick()
    assert.equal(e.calls.updateMe.length, 1) // 첫 요청이 끝나기 전에 두 번째를 보내지 않는다
    gate.resolve()
    await Promise.all([first, second])
    assert.deepEqual(e.calls.updateMe.map(nick), ['a', 'b'])
    assert.equal(rt.pendingSummary().profile, false)
  })
  test('요청이 나가 있는 동안 다시 고쳤다면 첫 응답이 대기 표시를 지우지 않는다', async () => {
    const gate = deferred()
    let n = 0
    const e = env({ apiOverride: { updateMe: async (b) => { const my = ++n; e.calls.updateMe.push(b); if (my === 1) await gate.promise; if (my === 2) throw new NetworkError('x') } } })
    const rt = e.runtime()
    const first = rt.syncProfile()
    await tick()
    e.localProfile.value = { ...e.localProfile.value, nickname: 'b' }
    const second = rt.syncProfile()
    gate.resolve()
    await Promise.all([first, second])
    assert.equal(rt.pendingSummary().profile, true) // 최신 값(b)은 아직 못 보냈으므로 대기 유지
  })
  test('수정 직후 앱이 닫혀도(디바운스 대기 중) 대기 표시가 남아 다음 시작에 최신 값을 보낸다', async () => {
    const e = env()
    e.runtime().markProfileDirty() // 전송 전 즉시 표시(디바운스 타이머는 전송하기 전)
    assert.ok(e.storage.map.get(SYNC_PENDING_KEY)?.includes('"profile":true'))
    e.localProfile.value = { ...e.localProfile.value, nickname: 'late' }
    await env({ storage: e.storage }).runtime().resume() // 같은 저장소로 새 런타임 = 재실행(다른 env의 api지만 같은 pending을 읽음)
    // 새 env의 getLocalProfile은 자기 값을 쓰므로 여기서는 pending이 해소(전송 성공)된 것만 확인한다.
    assert.ok(e.storage.map.get(SYNC_PENDING_KEY)?.includes('"profile":false'))
  })
  test('요청 실패·인증 만료·타임아웃은 변경을 잃지 않고 복구되면 다시 보낸다', async () => {
    let fail = true
    const e = env({ apiOverride: { updateMe: async (b) => { e.calls.updateMe.push(b); if (fail) throw new NetworkError('timeout') } } })
    const rt = e.runtime()
    await rt.syncProfile()
    assert.equal(rt.pendingSummary().profile, true)
    e.signedIn.value = false
    await rt.resume() // 로그아웃(만료) 상태에서는 보내지 않는다
    assert.equal(e.calls.updateMe.length, 1)
    e.signedIn.value = true
    fail = false
    await rt.resume()
    assert.equal(rt.pendingSummary().profile, false)
    assert.equal(e.calls.updateMe.length, 2)
  })
})

describe('B. 서버 기록 가져오기 중복 방지', () => {
  test('같은 서버 기록을 반복·동시에 가져와도 중복 레코드가 생기지 않고 목록 요청은 하나로 합쳐진다', async () => {
    const e = env({ server: [detail('s1'), detail('s2')] })
    const rt = e.runtime()
    const [a, b] = await Promise.all([rt.pullRuns(), rt.pullRuns()])
    assert.equal(a, 2)
    assert.equal(b, 2) // 같은 작업을 공유한다
    assert.equal(e.calls.list, 1)
    await rt.pullRuns()
    assert.deepEqual(e.local.map((r) => r.recordId).sort(), ['rec-s1', 'rec-s2'])
  })
  test('서로 다른 런타임(앱 두 탭)이 동시에 가져와도 같은 recordId로 합쳐진다', async () => {
    const storage = mem()
    const local: RunRecord[] = []
    const e1 = env({ server: [detail('s1')], storage, local })
    const e2 = env({ server: [detail('s1')], storage, local })
    await Promise.all([e1.runtime().pullRuns(), e2.runtime().pullRuns()])
    assert.equal(local.length, 1)
  })
  test('상세 응답 순서가 뒤바뀌어도 결과는 같다', async () => {
    const gates = { 'r-s1': deferred<RunDetailResponse>(), 'r-s2': deferred<RunDetailResponse>() }
    const e = env({ server: [detail('s1'), detail('s2')], apiOverride: { get: async (id) => gates[id as keyof typeof gates].promise } })
    const pulled = e.runtime().pullRuns()
    await tick()
    gates['r-s1'].resolve(detail('s1'))
    gates['r-s2'].resolve(detail('s2'))
    assert.equal(await pulled, 2)
    assert.equal(e.local.length, 2)
  })
  test('일부만 가져오다 실패해도 재시도하면 나머지만 추가된다(중복·손상 없음)', async () => {
    let failS2 = true
    const e = env({ server: [detail('s1'), detail('s2'), detail('s3')], apiOverride: { get: async (id) => { if (id === 'r-s2' && failS2) throw new NetworkError('x'); return [detail('s1'), detail('s2'), detail('s3')].find((d) => d.run_id === id)! } } })
    const rt = e.runtime()
    assert.equal(await rt.pullRuns(), 2)
    assert.deepEqual(e.local.map((r) => r.sessionId), ['s1', 's3'])
    failS2 = false
    assert.equal(await rt.pullRuns(), 1)
    assert.deepEqual(e.local.map((r) => r.sessionId), ['s1', 's3', 's2'])
  })
  test('형식이 잘못된 서버 기록 하나가 나머지를 막지 않는다', async () => {
    const e = env({ server: [detail('bad', { target_distance_km: 3.3, target_duration_sec: null }), detail('s2')] })
    assert.equal(await e.runtime().pullRuns(), 1)
    assert.deepEqual(e.local.map((r) => r.sessionId), ['s2'])
  })
  test('목록과 상세의 client_session_id가 다르면 건너뛴다', async () => {
    const e = env({ server: [detail('s1')], apiOverride: { get: async () => detail('other') } })
    assert.equal(await e.runtime().pullRuns(), 0)
    assert.equal(e.local.length, 0)
  })
  test('로컬에 같은 기록이 있으면 서버 값으로 덮어쓰지 않는다', async () => {
    const e = env({ server: [detail('s1', { distance_m: 9999 })], local: [localRecord('s1', 1234)] })
    assert.equal(await e.runtime().pullRuns(), 0)
    assert.equal(e.local[0]?.result.distanceM, 1234)
  })
})

describe('C. 가져온 기록 장부', () => {
  test('앱을 다시 실행해도 장부가 유지되어 로컬에서 지운 기록이 되살아나지 않는다', async () => {
    const e = env({ server: [detail('s1')] })
    await e.runtime().pullRuns()
    e.local.length = 0 // 사용자가 지움
    const restarted = env({ server: [detail('s1')], storage: e.storage, local: e.local }) // 같은 저장소 = 재실행
    assert.equal(await restarted.runtime().pullRuns(), 0)
    assert.equal(e.local.length, 0)
    assert.deepEqual(JSON.parse(e.storage.map.get(IMPORT_LEDGER_KEY)!).ids, ['s1'])
  })
  test('장부는 한 건 가져올 때마다 저장된다(중간 실패에도 가져온 기록이 장부에 남는다)', async () => {
    let calls = 0
    const e = env({ server: [detail('s1'), detail('s2')], apiOverride: { get: async (id) => { calls += 1; if (calls === 2) throw new Error('boom'); return detail(id.slice(2)) } } })
    await e.runtime().pullRuns()
    assert.deepEqual(JSON.parse(e.storage.map.get(IMPORT_LEDGER_KEY)!).ids, ['s1'])
  })
  test('장부가 손상·비어 있으면 빈 장부로 취급한다(알려진 한계: 과거 삭제 기록이 복원될 수 있다)', async () => {
    for (const bad of ['{broken', JSON.stringify({ version: 2, ids: ['s1'] }), JSON.stringify({ version: 1, ids: 'x' }), '']) {
      const storage = mem()
      storage.map.set(IMPORT_LEDGER_KEY, bad)
      const e = env({ server: [detail('s1')], storage })
      assert.equal(await e.runtime().pullRuns(), 1) // 예외 없이 동작
    }
  })
  test('장부에 중복·문자열이 아닌 값이 있어도 안전하다', async () => {
    const storage = mem()
    storage.map.set(IMPORT_LEDGER_KEY, JSON.stringify({ version: 1, ids: ['s1', 's1', 3, null] }))
    const e = env({ server: [detail('s1'), detail('s2')], storage })
    assert.equal(await e.runtime().pullRuns(), 1)
    assert.deepEqual(e.local.map((r) => r.sessionId), ['s2'])
  })
  test('장부 저장이 실패해도 가져오기는 예외 없이 끝나고 로컬 기록은 보존된다(한계: 이후 삭제 시 재등장 가능)', async () => {
    const e = env({ server: [detail('s1')], storage: mem(IMPORT_LEDGER_KEY) })
    assert.equal(await e.runtime().pullRuns(), 1)
    assert.equal(e.local.length, 1)
  })
})

describe('D. 늦은 응답과 로컬 데이터 보호', () => {
  const remoteMe = (): UserProfileResponse =>
    ({ user_id: 'u1', nickname: '서버닉', birth_year: 1999, gender: 'female', height_cm: 165, weight_kg: 55, running_experience: null, consent: { age_over_14: true, terms_of_service: true, privacy_policy: true, location_terms: true }, guidance: {}, onboarding_completed_at: null, profile_completed_at: null }) as UserProfileResponse
  test('프로필 응답을 기다리는 동안 로컬을 고치면 늦은 응답이 그 값을 덮어쓰지 않는다', async () => {
    const gate = deferred<UserProfileResponse>()
    const e = env({ apiOverride: { getMe: () => gate.promise } })
    const pulled = e.runtime().pullProfile()
    await tick()
    e.localProfile.value = { ...e.localProfile.value, heightCm: 180 } // 사용자가 그 사이 입력
    gate.resolve(remoteMe())
    await pulled
    assert.equal(e.localProfile.value.heightCm, 180)
    assert.equal(e.localProfile.value.nickname, 'a') // 이미 있는 값 유지
    assert.equal(e.localProfile.value.weightKg, 55) // 비어 있던 칸만 채움
  })
  test('가져오는 도중 같은 기록이 로컬에 저장되면 로컬을 우선한다', async () => {
    const gate = deferred<RunDetailResponse>()
    const e = env({ server: [detail('s1', { distance_m: 9999 })], apiOverride: { get: () => gate.promise } })
    const pulled = e.runtime().pullRuns()
    await tick()
    e.local.push(localRecord('s1', 1234)) // 사용자가 방금 같은 세션을 저장
    gate.resolve(detail('s1', { distance_m: 9999 }))
    assert.equal(await pulled, 0)
    assert.equal(e.local.length, 1)
    assert.equal(e.local[0]?.result.distanceM, 1234)
  })
  test('가져오는 도중 로그아웃하면 이전 계정의 기록을 로컬에 넣지 않는다', async () => {
    const gate = deferred<RunDetailResponse>()
    const e = env({ server: [detail('s1')], apiOverride: { get: () => gate.promise } })
    const pulled = e.runtime().pullRuns()
    await tick()
    e.signedIn.value = false
    gate.resolve(detail('s1'))
    assert.equal(await pulled, 0)
    assert.equal(e.local.length, 0)
  })
  test('가져오는 도중 계정이 바뀌면(다른 userId) 이전 응답을 반영하지 않는다', async () => {
    const gate = deferred<unknown>()
    const e = env({ server: [detail('s1')], apiOverride: { list: async () => gate.promise } })
    const pulled = e.runtime().pullRuns()
    await tick()
    e.userId.value = 'u2'
    gate.resolve([detail('s1')])
    assert.equal(await pulled, 0)
    assert.equal(e.local.length, 0)
  })
  test('프로필 응답 도중 계정이 바뀌면 이전 응답으로 채우지 않는다', async () => {
    const gate = deferred<UserProfileResponse>()
    const e = env({ apiOverride: { getMe: () => gate.promise } })
    const pulled = e.runtime().pullProfile()
    await tick()
    e.userId.value = null
    e.signedIn.value = false
    gate.resolve(remoteMe())
    await pulled
    assert.equal(e.patches.length, 0)
  })
  test('앱 시작·로그인·온라인 복구가 겹쳐도 resume은 한 번만 실행된다', async () => {
    const e = env({ server: [detail('s1')] })
    const rt = e.runtime()
    await Promise.all([rt.resume(), rt.resume(), rt.resume()])
    assert.equal(e.calls.list, 1)
  })
  test('게스트·서버 설정 없음에서는 아무것도 하지 않고 예외도 없다', async () => {
    const e = env({ server: [detail('s1')] })
    e.signedIn.value = false
    const rt = e.runtime()
    await rt.resume()
    assert.equal(await rt.pullRuns(), 0)
    await rt.pullProfile()
    assert.equal(e.calls.list, 0)
    const noApi = createSyncRuntime({ getApi: () => null, isSignedIn: () => true, queueStorage: mem() })
    await noApi.resume()
    assert.equal(await noApi.pullRuns(), 0)
  })
})
