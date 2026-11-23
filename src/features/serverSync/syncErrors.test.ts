import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'
import type { RunRecord } from '../running/types.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime, SYNC_PENDING_KEY } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// 오류·비정상 응답·저장소 손상 상황에서 사용자 데이터가 사라지거나 무한 재시도되지 않는지 확인한다. 가짜 API·저장소만 쓰며 서버에는 요청하지 않는다.
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }
const emptyProfile = { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const rec = (sid: string): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
  }) as RunRecord

function mem(opts: { failSet?: boolean; failGet?: boolean; seed?: Record<string, string> } = {}) {
  const map = new Map<string, string>(Object.entries(opts.seed ?? {}))
  return {
    map,
    getItem: (k: string) => { if (opts.failGet) throw new Error('get'); return map.get(k) ?? null },
    setItem: (k: string, v: string) => { if (opts.failSet) throw new Error('set'); map.set(k, v) },
  }
}

interface Behavior {
  list?: () => Promise<unknown>
  getMe?: () => Promise<unknown>
  updateGuidance?: () => Promise<unknown>
  create?: () => Promise<unknown>
}
function build(b: Behavior = {}, storage = mem(), apiOn = true) {
  const calls = { list: 0, getMe: 0, guidance: 0, create: 0 }
  const local: RunRecord[] = []
  const api: SyncApi = {
    runs: {
      create: async () => { calls.create += 1; return b.create ? b.create() : {} },
      list: async () => { calls.list += 1; return b.list ? b.list() : [] },
      get: async () => { throw new ApiError(404, 'NOT_FOUND', 'x') },
      updateReflection: async () => undefined,
    },
    users: {
      getMe: async () => { calls.getMe += 1; return (b.getMe ? b.getMe() : blankServerProfile()) as never },
      updateMe: async () => undefined,
      putBaseline: async () => undefined,
      updateGuidance: async () => { calls.guidance += 1; return b.updateGuidance ? b.updateGuidance() : undefined },
    },
  }
  const state = { userId: 'user-A' as string | null, epoch: 0 }
  const rt = createSyncRuntime({
    getApi: () => (apiOn ? api : null),
    isSignedIn: () => state.userId !== null,
    getUserId: () => state.userId,
    getAuthEpoch: () => state.epoch,
    queueStorage: storage,
    now: () => 1_000_000,
    getLocalProfile: () => ({ profile: emptyProfile, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: () => undefined,
    loadLocalRecords: () => local,
    saveLocalRecord: (r) => void local.push(r),
  })
  return { rt, calls, local, storage, state }
}

const STATUSES = [401, 403, 404, 422, 500, 503]

describe('서버 기록 가져오기: 오류·비정상 응답', () => {
  for (const status of STATUSES) {
    test(`목록이 ${status}이면 예외 없이 끝나고 로컬 기록을 바꾸지 않는다(재시도 루프 없음)`, async () => {
      const w = build({ list: async () => { throw new ApiError(status, 'X', 'x') } })
      assert.equal(await w.rt.pullRuns(), 0)
      assert.equal(w.local.length, 0)
      assert.equal(w.calls.list, 1)
    })
  }
  test('네트워크 오류·시간 초과도 마찬가지다', async () => {
    for (const err of [new NetworkError('x'), Object.assign(new NetworkError('t'), { timedOut: true })]) {
      const w = build({ list: async () => { throw err } })
      assert.equal(await w.rt.pullRuns(), 0)
      assert.equal(w.calls.list, 1)
    }
  })
  test('빈 응답·배열이 아닌 응답·잘못된 항목뿐인 응답은 아무것도 가져오지 않는다', async () => {
    for (const body of [null, undefined, {}, 'not json', 7, [], [null, 1, 'x', {}]]) {
      const w = build({ list: async () => body })
      assert.equal(await w.rt.pullRuns(), 0, JSON.stringify(body))
      assert.equal(w.local.length, 0)
    }
  })
})

describe('Guidance 전송: 오류 응답에서 무한 재시도하지 않고 대기를 보존한다', () => {
  for (const status of STATUSES) {
    test(`갱신이 ${status}이면 한 번만 시도하고 대기를 유지한다`, async () => {
      const w = build({ updateGuidance: async () => { throw new ApiError(status, 'X', 'x') } })
      await w.rt.syncVoiceGuidance({ voiceGuide: false })
      await tick()
      assert.equal(w.calls.guidance, 1)
      assert.equal(w.calls.getMe, 1)
      assert.equal(w.rt.pendingSummary().voiceGuide, true)
    })
  }
  test('현재 설정 조회가 실패하면 갱신 요청을 보내지 않는다', async () => {
    for (const err of [new ApiError(500, 'X', 'x'), new NetworkError('x')]) {
      const w = build({ getMe: async () => { throw err } })
      await w.rt.syncVoiceGuidance({ voiceGuide: false })
      assert.equal(w.calls.guidance, 0)
      assert.equal(w.rt.pendingSummary().voiceGuide, true)
    }
  })
  test('같은 변경을 연달아 호출해도 요청이 겹치지 않고 최종 값 하나만 남는다', async () => {
    const w = build()
    await Promise.all([w.rt.syncVoiceGuidance({ voiceGuide: false }), w.rt.syncVoiceGuidance({ voiceGuide: false }), w.rt.syncVoiceGuidance({ voiceGuide: false })])
    await tick()
    assert.ok(w.calls.guidance <= 2)
    assert.equal(w.rt.pendingSummary().voiceGuide, false)
  })
})

describe('저장소 손상·실패', () => {
  test('대기 작업 저장 값이 손상(JSON 아님·형식 불일치)되어도 예외 없이 빈 상태로 시작하고 새 작업을 보낸다', async () => {
    for (const bad of ['{not json', 'null', '[]', '{"version":99}', '{"owners":{"u:user-A":"x"}}']) {
      const w = build({}, mem({ seed: { [SYNC_PENDING_KEY]: bad } }))
      await w.rt.syncVoiceGuidance({ voiceGuide: false })
      assert.equal(w.calls.guidance, 1, bad)
      assert.equal(w.rt.pendingSummary().voiceGuide, false)
    }
  })
  test('저장 대기열 값이 손상되어도 예외 없이 새 기록을 보낸다', async () => {
    for (const bad of ['{not json', 'null', '{"version":2,"owners":{"u:user-A":{"items":"x"}}}']) {
      const w = build({}, mem({ seed: { [RUN_SYNC_QUEUE_KEY]: bad } }))
      await w.rt.syncRun(rec('s1'))
      assert.equal(w.calls.create, 1, bad)
    }
  })
  test('저장소 쓰기가 실패해도 예외 없이 동작한다(이번 실행 동안 전송은 계속된다)', async () => {
    const w = build({}, mem({ failSet: true }))
    await w.rt.syncRun(rec('s1'))
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(w.calls.create, 1)
  })
  test('저장소 읽기가 실패해도 예외 없이 끝난다', async () => {
    const w = build({}, mem({ failGet: true }))
    await w.rt.syncRun(rec('s1'))
    await w.rt.syncVoiceGuidance({ voiceGuide: true })
    assert.ok(true)
  })
})

describe('연동이 꺼져 있거나 계정이 없을 때', () => {
  test('API가 없으면(설정 없음) 어떤 요청도 만들지 않고 로컬 상태를 바꾸지 않는다', async () => {
    const w = build({}, mem(), false)
    await w.rt.syncRun(rec('s1'))
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.equal(await w.rt.pullRuns(), 0)
    assert.deepEqual(w.calls, { list: 0, getMe: 0, guidance: 0, create: 0 })
  })
  test('로그아웃 상태에서는 요청이 나가지 않고, 로그인한 계정의 작업만 전송된다', async () => {
    const w = build()
    w.state.userId = null
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    await w.rt.syncRun(rec('s1'))
    assert.deepEqual(w.calls, { list: 0, getMe: 0, guidance: 0, create: 0 })
  })
  test('목록 항목의 상세를 받지 못하면(404) 그 기록은 가져오지 않고 예외도 없다', async () => {
    const w = build({ list: async () => [{ run_id: 'r1', client_session_id: 's9', mode: 'gps', started_at: '2026-11-01T00:00:00Z', ended_at: '2026-11-01T00:30:00Z', elapsed_ms: 1 }] })
    assert.equal(await w.rt.pullRuns(), 0)
    assert.equal(w.local.length, 0)
  })
})
