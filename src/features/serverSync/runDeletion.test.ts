import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { RunCreateRequest, RunDetailResponse } from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'
import { IMPORT_LEDGER_KEY, parseLedger } from './recordImport.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// 로컬 기록 삭제와 Run 전송 대기열(검토 항목 2). 가짜 API·저장소만 쓰며 서버에는 요청하지 않는다. 실서버 검증이 아니다.
// 서버에는 개별 삭제 API가 없다: 이미 서버에 저장된 기록은 지울 수 없고, 이 테스트는 "삭제된 로컬 기록이 새로 서버로 가지 않는 것"과 "서버에 간 기록이 되살아나지 않는 것"만 다룬다.
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
function mem(opts: { failSet?: () => boolean } = {}) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { if (opts.failSet?.()) throw new Error('set'); map.set(k, v) },
  }
}
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }
const rec = (sid: string, memo = ''): RunRecord =>
  ({
    recordId: `rec-${sid}`, sessionId: sid, mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
    goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: memo === '' ? null : { difficulty: 'easy', reasons: [], memo }, sensorReport: null,
    result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
  }) as unknown as RunRecord
const detail = (sid: string): RunDetailResponse => ({ run_id: `r-${sid}`, client_session_id: sid, mode: 'gps', completion: 'goal', started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T10:00:00.000Z', elapsed_ms: 3_600_000, distance_m: 5000, avg_pace_sec_per_km: 360, pace_status: 'ok', has_posture_report: false, target_distance_km: 5, target_duration_sec: 1800, target_pace_sec_per_km: null, cadence_spm: null, cadence_status: 'unavailable', step_count: null, target_pace_keep_ratio_pct: null, music_track_id: null, splits: [], gps_gaps: [], reflection: null }) as unknown as RunDetailResponse

type Mode = 'ok' | 'net' | 'unauthorized'
function world(storage = mem()) {
  const auth = { userId: 'A' as string | null, epoch: 1 }
  const local = new Map<string, RunRecord>()
  const server: RunDetailResponse[] = []
  const created: Array<{ as: string | null; sid: string }> = []
  const bodies: RunCreateRequest[] = []
  const ctl = { mode: 'ok' as Mode, gate: null as null | ReturnType<typeof deferred<void>>, stateOverride: null as null | (() => 'present' | 'absent' | 'unknown') }
  let clock = 1_000_000
  const api: SyncApi = {
    runs: {
      create: async (b) => {
        if (ctl.gate) await ctl.gate.promise
        if (ctl.mode === 'net') throw new NetworkError('x')
        if (ctl.mode === 'unauthorized') throw new ApiError(401, 'UNAUTHORIZED', 'x')
        created.push({ as: auth.userId, sid: b.client_session_id })
        bodies.push(JSON.parse(JSON.stringify(b)) as RunCreateRequest)
        if (!server.some((s) => s.client_session_id === b.client_session_id)) server.push(detail(b.client_session_id))
        return {}
      },
      list: async () => server,
      get: async (id) => { const d = server.find((s) => s.run_id === id); if (!d) throw new ApiError(404, 'NOT_FOUND', 'x'); return d },
      updateReflection: async () => undefined,
    },
    users: { getMe: async () => { throw new NetworkError('x') }, updateMe: async () => undefined, putBaseline: async () => undefined, updateGuidance: async () => undefined },
  }
  const rt = createSyncRuntime({
    getApi: () => api, isSignedIn: () => auth.userId !== null, getUserId: () => auth.userId, getAuthEpoch: () => auth.epoch,
    queueStorage: storage, now: () => clock,
    getLocalProfile: () => ({ profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: () => undefined,
    loadLocalRecords: () => [...local.values()],
    saveLocalRecord: (r) => void local.set(r.sessionId, r),
    localRecordState: (sid) => (ctl.stateOverride ? ctl.stateOverride() : local.has(sid) ? 'present' : 'absent'),
  })
  const save = (sid: string, memo = '') => { const r = rec(sid, memo); local.set(sid, r); return r }
  const del = (sid: string) => void local.delete(sid) // 사용자가 로컬 기록을 지움(저장소에서만 사라진다)
  const switchTo = (uid: string | null) => { auth.userId = uid; auth.epoch += 1 }
  const queueItems = (owner: string) => {
    const j = JSON.parse(storage.map.get(RUN_SYNC_QUEUE_KEY) ?? '{"owners":{}}') as { owners: Record<string, { items: Array<{ clientSessionId: string; status: string }> }> }
    return (j.owners[owner]?.items ?? []).map((i) => i.clientSessionId)
  }
  const ledger = () => parseLedger(storage.map.get(IMPORT_LEDGER_KEY) ?? null)
  return { rt, auth, local, server, created, bodies, ctl, save, del, switchTo, queueItems, ledger, storage, advance: (ms: number) => void (clock += ms) }
}

describe('삭제된 미전송 기록', () => {
  test('전송하지 못한 채 로컬에서 지우면 이후 전송에서 보내지 않고 대기열에서 뺀다', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('s1')) // 오프라인: 대기 중
    assert.deepEqual(w.queueItems('u:A'), ['s1'])
    w.del('s1')
    w.ctl.mode = 'ok'
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.equal(w.created.length, 0)
    assert.deepEqual(w.queueItems('u:A'), [])
    assert.equal(w.local.size, 0) // 로컬 기록은 되살아나지 않는다
    assert.equal(w.ledger().has('s1'), true) // 응답을 못 받았을 수 있는 기록은 서버에서 다시 가져오지 않도록 장부에 남긴다
  })
  test('지우지 않은 기록은 그대로 보낸다(지운 기록만 제외)', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('keep'))
    await w.rt.syncRun(w.save('gone'))
    w.del('gone')
    w.ctl.mode = 'ok'
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.deepEqual(w.created.map((c) => c.sid), ['keep'])
    assert.deepEqual(w.queueItems('u:A'), [])
  })
  test('로그인 전(인증 대기)에 쌓인 기록도 지웠다면 로그인 후 보내지 않는다', async () => {
    const w = world()
    w.ctl.mode = 'unauthorized'
    await w.rt.syncRun(w.save('s1'))
    w.del('s1')
    w.ctl.mode = 'ok'
    await w.rt.resume()
    assert.equal(w.created.length, 0)
    assert.deepEqual(w.queueItems('u:A'), [])
  })
  test('로컬 기록이 있으면 평소처럼 보낸다', async () => {
    const w = world()
    await w.rt.syncRun(w.save('s1'))
    assert.deepEqual(w.created, [{ as: 'A', sid: 's1' }])
  })
})

describe('전송 중 삭제와 서버 응답 지연', () => {
  test('요청이 나가 있는 동안 지우면: 이미 나간 요청은 되돌릴 수 없고, 성공하면 장부에 남아 서버 목록에서 되살아나지 않는다', async () => {
    const w = world()
    w.ctl.gate = deferred()
    const sending = w.rt.syncRun(w.save('s1'))
    await tick()
    w.del('s1') // 전송 중 삭제
    w.ctl.gate.resolve()
    await sending
    assert.deepEqual(w.created.map((c) => c.sid), ['s1']) // 서버에는 저장됐다(서버 삭제 API가 없다)
    assert.deepEqual(w.queueItems('u:A'), [])
    assert.equal(w.ledger().has('s1'), true)
    w.ctl.gate = null
    assert.equal(await w.rt.pullRuns(), 0) // 서버 기록이 로컬로 되살아나지 않는다
    assert.equal(w.local.size, 0)
  })
  test('삭제 후 응답이 늦게 실패해도(네트워크) 재전송하지 않는다 — 다음 전송에서 삭제로 판정해 뺀다', async () => {
    const w = world()
    w.ctl.gate = deferred()
    w.ctl.mode = 'net'
    const sending = w.rt.syncRun(w.save('s1'))
    await tick()
    w.del('s1')
    w.ctl.gate.resolve()
    await sending // 실패: 대기 상태로 남는다
    assert.deepEqual(w.queueItems('u:A'), ['s1'])
    w.ctl.gate = null
    w.ctl.mode = 'ok'
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.equal(w.created.length, 0)
    assert.deepEqual(w.queueItems('u:A'), [])
    assert.equal(w.ledger().has('s1'), true)
  })
  test('전송 중 회고를 고친 뒤 기록을 지우면 회고 재전송도 하지 않는다', async () => {
    const w = world()
    w.ctl.gate = deferred()
    const sending = w.rt.syncRun(w.save('s1'))
    await tick()
    void w.rt.syncReflection('s1', { difficulty: 'hard', reasons: [], memo: '수정' } as never) // 대기열의 요청이 바뀐다
    await tick()
    w.del('s1')
    w.ctl.gate.resolve()
    await sending
    assert.equal(w.created.length, 1) // 첫 요청만 나갔고 재전송은 없다
    assert.deepEqual(w.queueItems('u:A'), [])
  })
  test('서버 저장이 확인된 기록을 로컬에서 지워도 서버 삭제 성공으로 취급하지 않는다(서버 기록은 남고 장부로 재유입만 막는다)', async () => {
    const w = world()
    await w.rt.syncRun(w.save('s1'))
    w.del('s1')
    assert.equal(w.server.length, 1) // 서버에는 그대로 있다
    await w.rt.resume()
    assert.equal(w.local.size, 0)
    assert.equal(w.server.length, 1)
  })
})

describe('다른 계정의 대기열은 건드리지 않는다', () => {
  test('A의 대기 기록을 지운 뒤 B가 로그인해 전송해도 A의 대기열은 그대로이고, A가 돌아와야 정리된다', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('a1'))
    w.del('a1')
    w.ctl.mode = 'ok'
    w.switchTo('B')
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.deepEqual(w.queueItems('u:A'), ['a1']) // B의 전송이 A의 항목을 건드리지 않는다
    assert.equal(w.created.length, 0)
    w.switchTo('A')
    await w.rt.resume()
    assert.deepEqual(w.queueItems('u:A'), [])
    assert.equal(w.created.length, 0)
  })
  test('삭제와 계정 전환이 동시에 일어나도(전송 중 A→B) 요청한 계정의 버킷만 정리되고 B의 대기열은 생기지 않는다', async () => {
    const w = world()
    w.ctl.gate = deferred()
    const sending = w.rt.syncRun(w.save('a1'))
    await tick()
    w.del('a1')
    w.switchTo('B')
    w.ctl.gate.resolve()
    await sending
    assert.deepEqual(w.queueItems('u:B'), [])
    assert.ok(w.created.every((c) => c.as === 'A' || c.as === 'B'))
    assert.equal(w.local.size, 0)
  })
  test('로그아웃 상태에서는 아무것도 지우거나 보내지 않는다(대기열 보존)', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('a1'))
    w.switchTo(null)
    w.del('a1')
    w.ctl.mode = 'ok'
    await w.rt.resume()
    assert.deepEqual(w.queueItems('u:A'), ['a1'])
    assert.equal(w.created.length, 0)
  })
})

describe('저장소 오류에서는 보존을 우선한다', () => {
  test('로컬 기록 저장소를 읽을 수 없으면(unknown) 보내지도 지우지도 않고 대기열에 보존한다', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('s1'))
    w.ctl.mode = 'ok'
    w.ctl.stateOverride = () => 'unknown'
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.equal(w.created.length, 0)
    assert.deepEqual(w.queueItems('u:A'), ['s1'])
    assert.equal(w.ledger().has('s1'), false)
    w.ctl.stateOverride = null // 복구되면 보낸다
    await w.rt.resume()
    assert.deepEqual(w.created.map((c) => c.sid), ['s1'])
  })
  test('로컬 기록 확인 중 예외가 나도 보존한다', async () => {
    const w = world()
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('s1'))
    w.ctl.mode = 'ok'
    w.ctl.stateOverride = () => { throw new Error('storage') }
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.equal(w.created.length, 0)
    assert.deepEqual(w.queueItems('u:A'), ['s1'])
  })
  test('장부 저장이 실패해도 예외 없이 끝나고, 같은 실행 안에서는 지운 기록이 되살아나지 않는다', async () => {
    let failing = false
    const storage = mem({ failSet: () => failing })
    const w = world(storage)
    w.ctl.gate = deferred()
    const sending = w.rt.syncRun(w.save('s1'))
    await tick()
    w.del('s1')
    failing = true // 전송 중 저장소가 막힘(대기열·장부 모두 저장 실패)
    w.ctl.gate.resolve()
    await sending
    w.ctl.gate = null
    assert.equal(await w.rt.pullRuns(), 0)
    assert.equal(w.local.size, 0)
  })
  test('대기열 저장이 실패해도 지운 기록을 보내지 않는다(메모리 대기열로 동작)', async () => {
    let failing = false
    const storage = mem({ failSet: () => failing })
    const w = world(storage)
    w.ctl.mode = 'net'
    await w.rt.syncRun(w.save('s1'))
    failing = true
    w.del('s1')
    w.ctl.mode = 'ok'
    w.advance(10 * 60_000)
    await w.rt.resume()
    assert.equal(w.created.length, 0)
  })
})

describe('기존 장부·재유입 방지 정책 보존', () => {
  test('가져온 서버 기록을 지운 뒤 다시 가져오지 않는다(기존 정책)', async () => {
    const w = world()
    w.server.push(detail('srv'))
    assert.equal(await w.rt.pullRuns(), 1)
    w.del('srv')
    assert.equal(await w.rt.pullRuns(), 0)
    assert.equal(w.local.size, 0)
  })
  test('보낸 적 없는 서버 전용 기록은 삭제 판정의 영향을 받지 않고 그대로 가져온다', async () => {
    const w = world()
    w.server.push(detail('other-device'))
    await w.rt.syncRun(w.save('mine'))
    assert.equal(await w.rt.pullRuns(), 1)
    assert.ok(w.local.has('other-device'))
  })
})
