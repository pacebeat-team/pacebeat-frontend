import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { BaselineUpsertRequest, RunDetailResponse } from '../../lib/api/types.ts'
import type { ProfileData } from '../profile/types.ts'
import type { RunRecord } from '../running/types.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime, SYNC_PENDING_KEY } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'

// 계정별 격리 테스트: 가짜 API·가짜 저장소만 사용한다(실서버·실제 브라우저 저장소 접근 없음).
// 가짜 API는 호출 시점의 "토큰 주인"(현재 로그인 계정)을 기록해, 어떤 작업이 어느 계정 인증으로 나갔는지 확인한다.
const rec = (sid: string): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
  }) as RunRecord
const detail = (sid: string): RunDetailResponse => ({ run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal', started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T10:00:00.000Z', elapsed_ms: 1, distance_m: 1, avg_pace_sec_per_km: 1, pace_status: 'ok', has_posture_report: false }) as unknown as RunDetailResponse
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }
const base: BaselineUpsertRequest = { skipped: false, baseline_pace_sec_per_km: 400, cadence_spm: null, stride_length_cm: null, valid_duration_ms: 1, distance_m: 1, measured_at: null }

function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

interface Call { kind: string; as: string | null; body: unknown }

function world(storage = mem()) {
  const clock = { t: 1_000_000 }
  const auth = { signedIn: false, userId: null as string | null }
  const calls: Call[] = []
  const behavior = { fail: false, gate: null as Promise<void> | null, failWith: 'network' as 'network' | '401' }
  const profile = { value: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null } as ProfileData }
  const server: RunDetailResponse[] = []
  const guard = async () => {
    if (behavior.gate) await behavior.gate
    if (behavior.fail) throw behavior.failWith === '401' ? new ApiError(401, 'AUTH_INVALID_TOKEN', 'x') : new NetworkError('x')
  }
  const rec_ = (kind: string, body: unknown) => calls.push({ kind, as: auth.userId, body })
  const api: SyncApi = {
    runs: {
      create: async (b) => { rec_('run', b); await guard() ; return {} },
      list: async () => server,
      get: async () => { throw new NetworkError('x') },
      updateReflection: async (id, b) => { rec_('reflection', { id, b }); await guard() },
    },
    users: {
      getMe: async () => blankServerProfile(),
      updateMe: async (b) => { rec_('profile', b); await guard() },
      putBaseline: async (b) => { rec_('baseline', b); await guard() },
      updateGuidance: async (b) => { rec_('voice', b); await guard() },
    },
  }
  const runtime = () =>
    createSyncRuntime({
      getApi: () => api,
      isSignedIn: () => auth.signedIn,
      getUserId: () => auth.userId,
      queueStorage: storage,
      now: () => clock.t,
      getLocalProfile: () => ({ profile: profile.value, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
      applyProfilePatch: () => {},
      loadLocalRecords: () => [],
      saveLocalRecord: () => {},
    })
  const login = (uid: string) => { auth.signedIn = true; auth.userId = uid }
  const logout = () => { auth.signedIn = false; auth.userId = null }
  const sentAs = (kind: string) => calls.filter((c) => c.kind === kind).map((c) => c.as)
  return { clock, auth, calls, behavior, profile, server, storage, runtime, login, logout, sentAs }
}

// A가 모든 유형의 작업을 서버 실패 상태에서 만든다(대기 작업 5종).
async function createAllPendingAs(w: ReturnType<typeof world>, rt: ReturnType<ReturnType<typeof world>['runtime']>, uid: string) {
  w.login(uid)
  w.behavior.fail = true
  w.server.push(detail(`srv-${uid}`)) // 회고 대상 기록(서버에는 이미 있고 대기열에는 없다)
  w.profile.value = { ...w.profile.value, nickname: `nick-${uid}` }
  await rt.syncRun(rec(`run-${uid}`))
  await rt.syncProfile()
  await rt.syncBaseline(base)
  await rt.syncVoiceGuidance({ voiceGuide: false })
  await rt.syncReflection(`srv-${uid}`, { difficulty: 'easy', reasons: [], memo: uid } as never)
  w.behavior.fail = false
  w.clock.t += 1_000_000 // 재시도 대기(backoff)가 지난 상태로 만든다
  w.calls.length = 0
}

describe('계정 간 전송 차단 (5종 유형 전체)', () => {
  test('1. A의 대기 작업 → 로그아웃 → B 로그인: A 작업은 전송되지 않는다(모든 유형)', async () => {
    const w = world()
    const rt = w.runtime()
    await createAllPendingAs(w, rt, 'A')
    w.logout()
    w.login('B')
    await rt.resume()
    assert.equal(w.calls.length, 0) // 어떤 유형도 B의 인증으로 나가지 않았다
    // A의 작업은 삭제되지 않고 남아 있다
    assert.deepEqual(rt.pendingSummary('u:A'), { profile: true, baseline: true, voiceGuide: true, reflections: 1 })
    assert.equal(rt.quarantineSummary().owners.includes('u:A'), true)
  })
  test('2. A 로그아웃 → B 로그인 → A 재로그인: A 작업만 재개되고 A의 인증으로 나간다', async () => {
    const w = world()
    const rt = w.runtime()
    await createAllPendingAs(w, rt, 'A')
    w.logout(); w.login('B'); await rt.resume(); w.logout()
    w.login('A')
    await rt.resume()
    for (const kind of ['run', 'profile', 'baseline', 'voice', 'reflection']) assert.deepEqual(w.sentAs(kind), ['A'], kind)
    assert.deepEqual(rt.pendingSummary('u:A'), { profile: false, baseline: false, voiceGuide: false, reflections: 0 })
    assert.equal(rt.queue.list().length, 0)
  })
  test('3. B의 대기 작업은 B 계정에서 정상 전송되고 A의 작업과 섞이지 않는다', async () => {
    const w = world()
    const rt = w.runtime()
    await createAllPendingAs(w, rt, 'A')
    w.logout()
    await createAllPendingAs(w, rt, 'B')
    await rt.resume() // B 로그인 상태
    for (const kind of ['run', 'profile', 'baseline', 'voice', 'reflection']) assert.deepEqual(w.sentAs(kind), ['B'], kind)
    const run = w.calls.find((c) => c.kind === 'run')?.body as { client_session_id: string }
    assert.equal(run.client_session_id, 'run-B')
    assert.deepEqual(rt.pendingSummary('u:A'), { profile: true, baseline: true, voiceGuide: true, reflections: 1 }) // A는 그대로
  })
  test('프로필은 변경한 계정의 스냅샷만 그 계정으로 간다(다른 계정이 고친 값이 섞이지 않는다)', async () => {
    const w = world()
    const rt = w.runtime()
    await createAllPendingAs(w, rt, 'A') // A 스냅샷: nick-A
    w.logout(); w.login('B')
    w.profile.value = { ...w.profile.value, nickname: 'nick-B-edit' } // B가 같은 기기에서 프로필 수정(전송은 B의 몫)
    w.login('A'); await rt.resume()
    const sent = w.calls.find((c) => c.kind === 'profile')?.body as { nickname: string }
    assert.equal(sent.nickname, 'nick-A')
  })
  test('4. 게스트 작업은 로그인 계정으로 자동 이전되지 않고 보존된다(모든 유형)', async () => {
    const w = world()
    const rt = w.runtime() // 게스트 상태
    await rt.syncRun(rec('guest-run'))
    await rt.syncProfile()
    await rt.syncBaseline(base)
    await rt.syncVoiceGuidance({ voiceGuide: true })
    await rt.syncReflection('guest-run', { difficulty: 'easy', reasons: [], memo: 'g' } as never)
    assert.equal(w.calls.length, 0)
    w.login('A')
    await rt.resume()
    assert.equal(w.calls.length, 0)
    assert.equal(rt.quarantineSummary().guestQueueItems, 1)
    assert.equal(rt.pendingSummary('guest').profile, true)
    assert.equal(rt.pendingSummary('guest').baseline, true)
    assert.equal(rt.pendingSummary('guest').voiceGuide, true)
    assert.equal(rt.queue.list().length, 0) // A의 대기열은 비어 있다(게스트 항목은 A 것이 아니다)
  })
  test('5. 소유자 정보가 없는 기존(v1) 대기열·대기 작업은 어떤 계정에도 전송하지 않고 보존한다', async () => {
    const storage = mem()
    const legacyQueue = { version: 1, items: [{ clientSessionId: 'old', request: { client_session_id: 'old', mode: 'gps', completion: 'goal', started_at: 'x', ended_at: 'y', elapsed_ms: 1 }, status: 'pending', attempts: 0, nextAttemptAt: 0, lastErrorCode: null }] }
    const legacyPending = { profile: true, baseline: null, voiceGuide: false, reflections: {} }
    storage.map.set(RUN_SYNC_QUEUE_KEY, JSON.stringify(legacyQueue))
    storage.map.set(SYNC_PENDING_KEY, JSON.stringify(legacyPending))
    const w = world(storage)
    const rt = w.runtime()
    w.login('A')
    await rt.resume()
    assert.equal(w.calls.length, 0) // 현재 로그인 계정의 것으로 간주하지 않는다
    assert.deepEqual({ items: rt.quarantineSummary().legacyQueueItems, pending: rt.quarantineSummary().legacyPending }, { items: 1, pending: true })
    // 이후 A가 새 작업을 만들어 저장소를 다시 써도 legacy 데이터는 그대로 남는다
    await rt.syncRun(rec('new'))
    await rt.syncVoiceGuidance({ voiceGuide: true })
    const q = JSON.parse(storage.map.get(RUN_SYNC_QUEUE_KEY)!)
    const p = JSON.parse(storage.map.get(SYNC_PENDING_KEY)!)
    assert.deepEqual(q.legacy, legacyQueue)
    assert.deepEqual(p.legacy, legacyPending)
    assert.deepEqual(w.sentAs('run'), ['A']) // 새 작업만 전송
    assert.equal(w.calls.filter((c) => (c.body as { client_session_id?: string }).client_session_id === 'old').length, 0)
  })
  test('손상된 기존 저장 값도 지우지 않고 보존한다', async () => {
    const storage = mem()
    storage.map.set(RUN_SYNC_QUEUE_KEY, '{broken')
    const w = world(storage)
    const rt = w.runtime()
    w.login('A')
    await rt.syncRun(rec('x'))
    assert.equal(JSON.parse(storage.map.get(RUN_SYNC_QUEUE_KEY)!).legacy, '{broken')
  })
  test('계정을 확인할 수 없으면(로그인 상태지만 userId 없음) 전송하지 않고 보존한다', async () => {
    const w = world()
    const rt = w.runtime()
    w.auth.signedIn = true
    w.auth.userId = null
    await rt.syncRun(rec('u'))
    await rt.syncVoiceGuidance({ voiceGuide: false })
    await rt.resume()
    assert.equal(w.calls.length, 0)
    assert.equal(rt.quarantineSummary().guestQueueItems, 1)
  })
})

describe('전송 도중·만료·재실행·오류', () => {
  test('6. 전송 도중 로그아웃·계정 변경: 이전 요청의 결과는 새 계정 버킷에 반영되지 않고 남은 항목은 새 계정으로 나가지 않는다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.behavior.fail = true
    await rt.syncRun(rec('a1'))
    await rt.syncRun(rec('a2')) // 둘 다 A의 대기열에 backoff로 남는다
    w.behavior.fail = false
    w.clock.t += 1_000_000 // backoff가 지났다
    w.calls.length = 0
    let release!: () => void
    w.behavior.gate = new Promise<void>((r) => (release = r))
    const flushing = rt.resume() // a1이 서버로 나가 있는 상태에서 멈춘다
    await new Promise((r) => setTimeout(r, 0))
    w.logout()
    w.login('B') // 전송 도중 계정 변경
    release()
    await flushing
    const after = JSON.parse(w.storage.map.get(RUN_SYNC_QUEUE_KEY)!)
    assert.deepEqual(w.sentAs('run'), ['A']) // 이미 나간 a1만 A로 나갔고 a2는 B로 나가지 않았다
    assert.equal('u:B' in after.owners, false) // B 버킷이 생기지 않았다
    assert.deepEqual(after.owners['u:A'].items.map((i: { clientSessionId: string }) => i.clientSessionId), ['a2']) // a1만 A 버킷에서 빠지고 a2는 보존
  })
  test('7. 인증 만료(401) 후 다른 계정 로그인: A의 인증 대기 항목은 B가 풀지 못하고, A 재로그인 시 재개된다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.behavior.fail = true
    w.behavior.failWith = '401'
    await rt.syncRun(rec('a1'))
    assert.equal(rt.queue.list()[0]?.status, 'auth-wait')
    w.behavior.fail = false
    w.logout() // 만료로 세션이 지워짐
    w.login('B')
    w.calls.length = 0
    await rt.resume()
    assert.equal(w.calls.length, 0)
    w.logout(); w.login('A')
    await rt.resume()
    assert.deepEqual(w.sentAs('run'), ['A'])
    assert.equal(rt.queue.list().length, 0)
  })
  test('8. 앱 재실행 후 계정별 대기열이 복구된다', async () => {
    const w = world()
    const rt = w.runtime()
    await createAllPendingAs(w, rt, 'A')
    w.logout()
    await createAllPendingAs(w, rt, 'B')
    const restarted = world(w.storage) // 같은 저장소 = 재실행
    const rt2 = restarted.runtime()
    restarted.login('B')
    assert.deepEqual(rt2.pendingSummary('u:A'), { profile: true, baseline: true, voiceGuide: true, reflections: 1 })
    assert.deepEqual(rt2.pendingSummary('u:B'), { profile: true, baseline: true, voiceGuide: true, reflections: 1 })
    restarted.clock.t += 5_000_000
    restarted.server.push(detail('srv-B'))
    await rt2.resume()
    assert.ok(restarted.calls.length >= 4)
    assert.ok(restarted.calls.every((c) => c.as === 'B'))
    assert.equal(rt2.pendingSummary('u:A').profile, true) // A는 여전히 보존
  })
  test('9. 서버 오류 후 재시도해도 소유권이 유지된다(실패 → 다른 계정 로그인 → 원래 계정 복귀 후 전송)', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.behavior.fail = true
    await rt.syncProfile()
    await rt.syncVoiceGuidance({ voiceGuide: false })
    await rt.resume() // 실패 지속
    assert.equal(rt.pendingSummary('u:A').profile, true)
    w.behavior.fail = false
    w.logout(); w.login('B'); w.calls.length = 0
    await rt.resume()
    assert.equal(w.calls.length, 0)
    w.logout(); w.login('A')
    await rt.resume()
    assert.deepEqual(w.sentAs('profile'), ['A'])
    assert.deepEqual(w.sentAs('voice'), ['A'])
  })
  test('요청이 나가 있는 동안 계정이 바뀌어도 응답 결과는 요청한 계정의 버킷에만 반영된다(프로필)', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    let release!: () => void
    w.behavior.gate = new Promise<void>((r) => (release = r))
    const sending = rt.syncProfile() // A의 요청이 서버에서 멈춰 있다
    await new Promise((r) => setTimeout(r, 0))
    w.logout()
    w.login('B')
    const bWork = rt.syncVoiceGuidance({ voiceGuide: true }) // B의 새 작업
    release()
    await Promise.all([sending, bWork])
    assert.equal(rt.pendingSummary('u:A').profile, false) // A의 요청 성공은 A 버킷만 해소
    assert.equal(rt.pendingSummary('u:B').profile, false) // B에는 프로필 작업이 생기지 않았다
    assert.deepEqual(w.sentAs('profile'), ['A'])
    assert.deepEqual(w.sentAs('voice'), ['B'])
  })
})

describe('게스트·서버 설정 없음', () => {
  test('서버 설정이 없어도(api null) 작업은 소유자 버킷에 보존되고 예외가 없다', async () => {
    const storage = mem()
    const rt = createSyncRuntime({ getApi: () => null, isSignedIn: () => true, getUserId: () => 'A', queueStorage: storage })
    await rt.syncRun(rec('x'))
    await rt.resume()
    assert.equal(rt.queue.list().length, 1)
    assert.deepEqual(JSON.parse(storage.map.get(RUN_SYNC_QUEUE_KEY)!).owners['u:A'].items.length, 1)
  })
})
