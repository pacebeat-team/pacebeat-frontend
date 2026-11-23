import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { NetworkError, OwnerChangedError } from '../../lib/api/errors.ts'
import type { RunDetailResponse } from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'

// 계정 경계(요청 생성 시점의 소유자·인증 세대 ↔ 실행·응답 시점) 회귀 테스트. 가짜 API·저장소만 사용한다.
const rec = (sid: string): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
  }) as RunRecord
const detail = (sid: string): RunDetailResponse => ({ run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal', started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T10:00:00.000Z', elapsed_ms: 3_600_000, distance_m: 5000, avg_pace_sec_per_km: 360, pace_status: 'ok', has_posture_report: false, target_distance_km: 5, target_duration_sec: 1800, target_pace_sec_per_km: null, cadence_spm: null, cadence_status: 'unavailable', step_count: null, target_pace_keep_ratio_pct: null, music_track_id: null, splits: [], gps_gaps: [], reflection: null }) as unknown as RunDetailResponse
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }
const empty = { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

function world(storage = mem()) {
  const auth = { signedIn: false, userId: null as string | null, epoch: 0 }
  const log: Array<{ kind: string; as: string | null; body?: unknown }> = []
  const requestedFor: Array<string | null> = []
  const gate = { list: null as null | ReturnType<typeof deferred<unknown>>, token: null as null | ReturnType<typeof deferred<void>> }
  const local: RunRecord[] = []
  const server: RunDetailResponse[] = []
  // 요청을 만든 계정(owner)에 묶인 가짜 API: 토큰을 받는 시점(gate 이후)에 현재 계정이 owner와 다르면 OwnerChangedError(실제 ownerBound와 같은 계약).
  const apiFor = (owner: string | null): SyncApi => {
    const guard = async () => {
      if (gate.token) await gate.token.promise
      if (owner !== null && auth.userId !== owner) throw new OwnerChangedError()
    }
    return {
      runs: {
        create: async (b) => { await guard(); log.push({ kind: 'run', as: auth.userId, body: b }); return {} },
        list: async () => { if (gate.list) return gate.list.promise; return server },
        get: async (id) => { const d = server.find((x) => x.run_id === id); if (!d) throw new NetworkError('x'); return d },
        updateReflection: async (id, b) => { await guard(); log.push({ kind: 'reflection', as: auth.userId, body: { id, b } }) },
      },
      users: {
        getMe: async () => blankServerProfile(),
        updateMe: async (b) => { await guard(); log.push({ kind: 'profile', as: auth.userId, body: b }) },
        putBaseline: async (b) => { await guard(); log.push({ kind: 'baseline', as: auth.userId, body: b }) },
        updateGuidance: async (b) => { await guard(); log.push({ kind: 'voice', as: auth.userId, body: b }) },
      },
    }
  }
  const clock = { t: 1_000_000 }
  const runtime = () =>
    createSyncRuntime({
      getApi: (uid) => { requestedFor.push(uid); return apiFor(uid) },
      isSignedIn: () => auth.signedIn,
      getUserId: () => auth.userId,
      getAuthEpoch: () => auth.epoch,
      queueStorage: storage,
      now: () => clock.t,
      getLocalProfile: () => ({ profile: empty, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
      applyProfilePatch: () => {},
      loadLocalRecords: () => local,
      saveLocalRecord: (r) => void local.push(r),
    })
  const login = (uid: string) => { auth.signedIn = true; auth.userId = uid; auth.epoch += 1 }
  const logout = () => { auth.signedIn = false; auth.userId = null; auth.epoch += 1 }
  return { auth, log, requestedFor, gate, local, server, storage, runtime, login, logout, clock }
}

describe('요청 생성 시점의 owner가 API 선택에 쓰인다', () => {
  test('모든 전송·가져오기 진입점이 요청을 만든 계정의 userId로 API를 얻는다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.server.push(detail('srv'))
    await rt.syncRun(rec('r1'))
    await rt.syncProfile()
    await rt.syncBaseline({ skipped: true, baseline_pace_sec_per_km: null, cadence_spm: null, stride_length_cm: null, valid_duration_ms: null, distance_m: null, measured_at: null })
    await rt.syncVoiceGuidance({ voiceGuide: false })
    await rt.syncReflection('srv', { difficulty: null, reasons: [], memo: 'm' } as never)
    await rt.pullRuns()
    await rt.pullProfile()
    assert.ok(w.requestedFor.length >= 7)
    assert.ok(w.requestedFor.every((u) => u === 'A')) // null·다른 계정으로 API를 얻은 진입점이 없다
  })
})

describe('토큰 시점 계정 전환(전송 직전·갱신 도중)', () => {
  test('토큰을 받는 사이 A→B 전환: 5종 모두 OwnerChanged로 나가지 않고 A 버킷에 보존된다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.server.push(detail('srv'))
    w.gate.token = deferred()
    const pending = Promise.all([
      rt.syncRun(rec('r1')),
      rt.syncProfile(),
      rt.syncBaseline({ skipped: false, baseline_pace_sec_per_km: 400, cadence_spm: null, stride_length_cm: null, valid_duration_ms: 1, distance_m: 1, measured_at: null }),
      rt.syncVoiceGuidance({ voiceGuide: false }),
      rt.syncReflection('srv', { difficulty: null, reasons: [], memo: 'm' } as never),
    ])
    await tick()
    w.logout()
    w.login('B') // 토큰 갱신 도중 전환
    w.gate.token.resolve()
    await pending
    assert.equal(w.log.length, 0) // 아무것도 서버로 나가지 않았다(B의 토큰으로도, A의 이름으로도)
    assert.deepEqual(rt.pendingSummary('u:A'), { profile: true, baseline: true, voiceGuide: true, reflections: 1 })
    const q = JSON.parse(w.storage.map.get('pacebeat:sync:run-queue:v1')!)
    assert.deepEqual(q.owners['u:A'].items.map((i: { clientSessionId: string }) => i.clientSessionId), ['r1'])
    assert.equal('u:B' in q.owners, false)
  })
  test('로그아웃 도중에도 마찬가지로 보내지 않고 보존한다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.gate.token = deferred()
    const p = rt.syncVoiceGuidance({ voiceGuide: true })
    await tick()
    w.logout()
    w.gate.token.resolve()
    await p
    assert.equal(w.log.length, 0)
    assert.equal(rt.pendingSummary('u:A').voiceGuide, true)
  })
})

describe('응답 도착 전 계정 전환(인증 세대)', () => {
  test('A→B→A로 같은 계정으로 돌아와도 이전 세대의 가져오기 결과는 버린다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.server.push(detail('s1')) // 상세는 받을 수 있으므로, 세대 검사가 없으면 가져오게 된다
    w.gate.list = deferred<unknown>()
    const pulled = rt.pullRuns()
    await tick()
    w.logout(); w.login('B'); w.logout(); w.login('A') // userId는 같지만 세대가 다르다
    w.gate.list.resolve([detail('s1')])
    assert.equal(await pulled, 0)
    assert.equal(w.local.length, 0)
  })
  test('회고 전송: 목록 응답을 기다리는 사이 계정이 바뀌면 PATCH하지 않고 대기를 유지한다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.server.push(detail('srv'))
    w.gate.list = deferred<unknown>()
    const p = rt.syncReflection('srv', { difficulty: null, reasons: [], memo: 'm' } as never)
    await tick()
    w.logout(); w.login('B')
    w.gate.list.resolve([detail('srv')])
    await p
    assert.equal(w.log.length, 0)
    assert.equal(rt.pendingSummary('u:A').reflections, 1)
  })
})

describe('진행 중인 작업이 다른 계정의 동기화를 가로채지 않는다', () => {
  test('A의 가져오기가 진행 중일 때 B가 로그인해 resume하면 B의 대기 작업은 A 작업이 끝난 뒤 B의 인증으로 전송된다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('B')
    await rt.syncVoiceGuidance({ voiceGuide: false }).catch(() => {}) // B 작업(전송은 성공해서 비운다)
    w.log.length = 0
    // B 대기 작업을 만들되 보내지 못한 상태로 둔다
    w.gate.token = deferred()
    const mk = rt.syncProfile()
    await tick()
    w.gate.token.resolve()
    await mk
    // 위에서 전송 성공했으므로, 다시 보류 상태를 직접 만든다: B가 오프라인일 때의 작업
    w.gate.token = deferred()
    void rt.syncVoiceGuidance({ voiceGuide: true })
    await tick()
    w.logout() // 전송 도중 로그아웃 → B의 작업은 보존
    w.gate.token.resolve()
    await tick()
    w.gate.token = null
    w.log.length = 0
    // A가 로그인해 가져오기가 진행 중(목록 응답 대기)
    w.login('A')
    w.gate.list = deferred<unknown>()
    const aResume = rt.resume()
    await tick()
    // 그 사이 B가 다시 로그인해 resume
    w.logout(); w.login('B')
    const bResume = rt.resume()
    w.gate.list.resolve([])
    await Promise.all([aResume, bResume])
    assert.ok(w.log.some((l) => l.kind === 'voice' && l.as === 'B')) // B의 대기 작업이 B의 인증으로 전송됨(가로채이지 않았다)
    assert.ok(w.log.every((l) => l.as === 'B'))
  })
})

describe('앱 재실행', () => {
  test('재실행 후에도 소유자별 대기 작업은 그대로이고 현재 계정 것만 전송된다', async () => {
    const w = world()
    const rt = w.runtime()
    w.login('A')
    w.gate.token = deferred()
    const p = rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    w.logout()
    w.gate.token.resolve()
    await p
    const w2 = world(w.storage) // 같은 저장소 = 재실행(인증 세대 0부터 다시 시작)
    const rt2 = w2.runtime()
    w2.login('B')
    await rt2.resume()
    assert.equal(w2.log.length, 0) // A의 작업은 B로 나가지 않는다
    w2.logout(); w2.login('A')
    await rt2.resume()
    assert.deepEqual(w2.log.map((l) => [l.kind, l.as]), [['voice', 'A']])
  })
})
