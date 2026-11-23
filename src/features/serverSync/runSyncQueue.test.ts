import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { RunCreateRequest } from '../../lib/api/types.ts'
import { createRunSyncQueue, RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import type { RunCreator } from './runSyncQueue.ts'

// 가짜 API·저장소·시계만 쓴다. 실제 서버에는 요청하지 않는다.
const req = (id: string): RunCreateRequest => ({ client_session_id: id, mode: 'gps', completion: 'goal', started_at: '2026-11-20T09:00:00.000Z', ended_at: '2026-11-20T09:30:00.000Z', elapsed_ms: 1000 })

function memStorage(initial?: string) {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(RUN_SYNC_QUEUE_KEY, initial)
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

function setup(behavior: (body: RunCreateRequest, call: number) => Promise<unknown>, storage = memStorage()) {
  const clock = { t: 1_000_000 }
  const sent: string[] = []
  let calls = 0
  const api: RunCreator = { runs: { create: async (body) => { calls += 1; const r = await behavior(body, calls); sent.push(body.client_session_id); return r } } }
  const queue = createRunSyncQueue({ storage, getApi: () => api, now: () => clock.t })
  return { queue, storage, clock, sent, calls: () => calls }
}

describe('러닝 저장 대기열', () => {
  test('같은 client_session_id는 한 번만 등록되고 성공하면 대기열에서 빠진다', async () => {
    const s = setup(async () => ({}))
    assert.equal(s.queue.enqueue(req('a')), true)
    assert.equal(s.queue.enqueue(req('a')), false)
    assert.equal(s.queue.enqueue({ ...req(''), client_session_id: '' }), false)
    const r = await s.queue.flush()
    assert.deepEqual(r, { kind: 'done', sent: 1, remaining: { pending: 0, authWait: 0, rejected: 0 } })
    assert.deepEqual(s.sent, ['a'])
    assert.equal(s.queue.list().length, 0)
  })
  test('동시에 flush를 불러도 한 번만 전송한다', async () => {
    const s = setup(async () => ({}))
    s.queue.enqueue(req('a'))
    const [x, y] = await Promise.all([s.queue.flush(), s.queue.flush()])
    assert.equal(x, y)
    assert.equal(s.calls(), 1)
  })
  test('네트워크 실패는 항목을 보존하고 backoff 뒤에 다시 보낸다', async () => {
    const s = setup(async (_b, call) => { if (call === 1) throw new NetworkError('x', false); return {} })
    s.queue.enqueue(req('a'))
    s.queue.enqueue(req('b'))
    const first = await s.queue.flush()
    assert.equal(first.kind === 'done' && first.sent, 0)
    assert.equal(s.calls(), 1) // 나머지는 다음 기회로
    assert.equal(s.queue.list().length, 2)
    assert.equal(s.queue.list()[0].attempts, 1)
    await s.queue.flush() // 아직 대기 시간 전
    assert.equal(s.calls(), 1)
    s.clock.t += 2000
    const second = await s.queue.flush()
    assert.equal(second.kind === 'done' && second.sent, 2)
    assert.equal(s.queue.list().length, 0)
  })
  test('401은 auth-wait로 멈추고 로그인 후 재개하면 보낸다', async () => {
    let authed = false
    const s = setup(async () => { if (!authed) throw new ApiError(401, 'AUTH_MISSING_TOKEN', 'x'); return {} })
    s.queue.enqueue(req('a'))
    await s.queue.flush()
    assert.equal(s.queue.summary().authWait, 1)
    await s.queue.flush()
    assert.equal(s.calls(), 1)
    authed = true
    s.queue.resumeAfterAuth()
    await s.queue.flush()
    assert.equal(s.queue.list().length, 0)
  })
  test('422 등은 rejected로 남기고(자동 재시도 없음) 다른 항목은 계속 보낸다', async () => {
    const s = setup(async (b) => { if (b.client_session_id === 'bad') throw new ApiError(422, 'VALIDATION_ERROR', 'x'); return {} })
    s.queue.enqueue(req('bad'))
    s.queue.enqueue(req('ok'))
    await s.queue.flush()
    assert.deepEqual(s.sent, ['ok'])
    assert.equal(s.queue.list()[0].status, 'rejected')
    assert.equal(s.queue.list()[0].lastErrorCode, 'VALIDATION_ERROR')
    s.clock.t += 10_000_000
    await s.queue.flush()
    assert.equal(s.calls(), 2)
    s.queue.remove('bad')
    assert.equal(s.queue.list().length, 0)
  })
  test('새로고침 후에도 대기열이 남고, 손상된 저장 값은 빈 대기열이다', async () => {
    const first = setup(async () => { throw new NetworkError('x', true) })
    first.queue.enqueue(req('a'))
    await first.queue.flush()
    const again = createRunSyncQueue({ storage: first.storage, getApi: () => null, now: () => 1 })
    assert.equal(again.list().length, 1)
    assert.equal(again.list()[0].attempts, 1)
    for (const raw of ['nope', '{}', JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: [{ clientSessionId: 1 }] })]) {
      assert.equal(createRunSyncQueue({ storage: memStorage(raw), getApi: () => null }).list().length, 0)
    }
  })
  test('API가 꺼져 있으면(null) 아무것도 보내거나 바꾸지 않는다', async () => {
    const storage = memStorage()
    const q = createRunSyncQueue({ storage, getApi: () => null })
    q.enqueue(req('a'))
    assert.deepEqual(await q.flush(), { kind: 'disabled' })
    assert.equal(q.list().length, 1)
  })
  test('저장소가 없거나 쓰기가 실패해도 동작한다', async () => {
    const q = createRunSyncQueue({ storage: { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }, getApi: () => ({ runs: { create: async () => ({}) } }) })
    assert.equal(q.enqueue(req('a')), true)
    await q.flush()
    assert.equal(q.list().length, 0)
    assert.equal(createRunSyncQueue({ storage: null, getApi: () => null }).enqueue(req('z')), true)
  })
})
