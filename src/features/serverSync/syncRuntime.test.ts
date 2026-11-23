import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { RunCreateRequest } from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// 가짜 API·저장소만 쓴다. 실제 서버에는 요청하지 않는다.
const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    recordId: 'rec-s1',
    sessionId: 's1',
    mode: 'gps',
    startedAt: Date.UTC(2026, 10, 20, 9, 0),
    endedAt: Date.UTC(2026, 10, 20, 9, 30),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 },
    musicTrackId: null,
    reflection: null,
    sensorReport: null,
    result: { elapsedMs: 1_800_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
    ...over,
  }) as RunRecord

function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

function setup(opts: { signedIn?: boolean; apiOn?: boolean; create?: (b: RunCreateRequest) => Promise<unknown> } = {}) {
  const storage = mem()
  const sent: RunCreateRequest[] = []
  const profile: unknown[] = []
  const baseline: unknown[] = []
  const api: SyncApi = {
    runs: { create: async (b) => { sent.push(b); return opts.create ? opts.create(b) : {} } },
    users: { updateMe: async (b) => void profile.push(b), putBaseline: async (b) => void baseline.push(b) },
  }
  const state = { signedIn: opts.signedIn ?? true }
  const rt = createSyncRuntime({ getApi: () => (opts.apiOn === false ? null : api), isSignedIn: () => state.signedIn, queueStorage: storage })
  return { rt, storage, sent, profile, baseline, state }
}

describe('서버 동기화 연결', () => {
  test('로그인한 상태면 러닝 기록이 sessionId를 client_session_id로 보내진다', async () => {
    const s = setup()
    await s.rt.syncRun(record())
    assert.equal(s.sent.length, 1)
    assert.equal(s.sent[0]?.client_session_id, 's1')
    assert.equal(s.rt.queue.list().length, 0)
  })
  test('같은 기록을 두 번 넘겨도 중복 전송하지 않는다(성공 후 재호출은 새 요청이지만 서버가 upsert)', async () => {
    const s = setup({ signedIn: false })
    await s.rt.syncRun(record())
    await s.rt.syncRun(record())
    assert.equal(s.rt.queue.list().length, 1)
    assert.equal(s.sent.length, 0)
  })
  test('게스트·서버 꺼짐이면 전송하지 않고 대기열에만 남으며 로그인하면 이어서 보낸다', async () => {
    const s = setup({ signedIn: false })
    await s.rt.syncRun(record())
    assert.equal(s.sent.length, 0)
    assert.equal(s.rt.queue.list().length, 1)
    s.state.signedIn = true
    await s.rt.resume()
    assert.equal(s.sent.length, 1)
    assert.equal(s.rt.queue.list().length, 0)
    const off = setup({ apiOn: false })
    await off.rt.syncRun(record())
    assert.equal(off.sent.length, 0)
  })
  test('네트워크 실패는 예외 없이 대기열에 남고 401은 인증 대기가 된다', async () => {
    const net = setup({ create: async () => { throw new NetworkError('x') } })
    await net.rt.syncRun(record())
    assert.equal(net.rt.queue.list().length, 1)
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
    assert.equal(s.rt.queue.list().length, 0)
  })
  test('프로필·기초 측정은 로그인했을 때만 보내고 실패해도 던지지 않는다', async () => {
    const s = setup({ signedIn: false })
    const local = { profile: { nickname: 'a', birthYear: null, gender: null, heightCm: null, weightKg: null }, consent: { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }, completedAt: 1, experienceLevel: null, weeklyRuns: null }
    await s.rt.syncProfile(local)
    await s.rt.syncBaseline({ skipped: true, baseline_pace_sec_per_km: null, cadence_spm: null, stride_length_cm: null, valid_duration_ms: null, distance_m: null, measured_at: null })
    assert.equal(s.profile.length + s.baseline.length, 0)
    s.state.signedIn = true
    await s.rt.syncProfile(local)
    assert.equal(s.profile.length, 1)
    assert.equal((s.profile[0] as { height_cm: unknown }).height_cm, null)
  })
})
