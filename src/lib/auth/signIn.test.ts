import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createAuthService } from './authService.ts'
import { AUTH_STORAGE_KEY, createAuthStorage } from './storage.ts'
import type { KeyValueStorage } from './storage.ts'

// 이메일·비밀번호 로그인과 세션 수명주기. 가짜 fetch·저장소·시계만 쓴다. 실제 Supabase에는 요청하지 않는다(값은 모두 테스트용 가짜). 실서버 검증이 아니다.
const CONFIG = { url: 'https://example.supabase.test', anonKey: 'test-anon-key' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub })}.sig`
function kv(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}
interface Call { url: string; init: RequestInit }
function setup(respond: (c: Call, n: number) => Response | Promise<Response>, config: typeof CONFIG | null = CONFIG) {
  const store = kv()
  const calls: Call[] = []
  const clock = { t: 1_000_000 }
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return respond(call, calls.length)
  }) as typeof fetch
  const service = createAuthService({ config, storage: createAuthStorage(store), fetch: fetchFn, now: () => clock.t })
  return { service, store, calls, clock }
}
const ok = (sub: string, expiresInSec = 3600) => json(200, { access_token: jwt(sub), refresh_token: `r-${sub}`, expires_in: expiresInSec })
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('이메일·비밀번호 로그인', () => {
  test('성공하면 세션을 저장하고 signedIn으로 알린다. 요청은 anon 키 헤더와 password grant만 쓴다', async () => {
    const s = setup(() => ok('A'))
    const seen: string[] = []
    s.service.onAuthStateChange((st) => seen.push(`${st.status}:${st.userId}`))
    assert.deepEqual(await s.service.signInWithPassword(' user@example.test ', 'pw'), { ok: true })
    assert.deepEqual(seen, ['signedIn:A'])
    assert.equal(s.calls.length, 1)
    assert.equal(s.calls[0].url, 'https://example.supabase.test/auth/v1/token?grant_type=password')
    assert.equal(s.calls[0].init.method, 'POST')
    const headers = s.calls[0].init.headers as Record<string, string>
    assert.equal(headers.apikey, 'test-anon-key')
    assert.equal('Authorization' in headers, false) // 로그인 요청에는 토큰이 없다
    assert.deepEqual(JSON.parse(String(s.calls[0].init.body)), { email: 'user@example.test', password: 'pw' }) // 이메일은 공백만 정리, 비밀번호는 그대로
    assert.ok(s.store.map.has(AUTH_STORAGE_KEY))
    assert.equal(await s.service.getAccessToken(), jwt('A'))
  })
  test('설정이 없으면(인증 꺼짐) 요청 없이 disabled이고 상태가 바뀌지 않는다', async () => {
    const s = setup(() => ok('A'), null)
    assert.deepEqual(await s.service.signInWithPassword('a@b.test', 'pw'), { ok: false, reason: 'disabled' })
    assert.equal(s.calls.length, 0)
    assert.equal(s.service.getState().status, 'disabled')
  })
  test('빈 이메일·비밀번호는 요청하지 않는다', async () => {
    const s = setup(() => ok('A'))
    for (const [e, p] of [['', 'pw'], ['   ', 'pw'], ['a@b.test', '']] as const) assert.deepEqual(await s.service.signInWithPassword(e, p), { ok: false, reason: 'invalid-input' })
    assert.equal(s.calls.length, 0)
  })
  test('오류 분류: 400/401/422는 invalid-credentials, 429는 rate-limited, 5xx·네트워크·시간 초과는 network. 세션은 만들지 않는다', async () => {
    for (const [status, reason] of [[400, 'invalid-credentials'], [401, 'invalid-credentials'], [422, 'invalid-credentials'], [429, 'rate-limited'], [500, 'network'], [503, 'network']] as const) {
      const s = setup(() => json(status, { msg: 'x' }))
      assert.deepEqual(await s.service.signInWithPassword('a@b.test', 'pw'), { ok: false, reason }, String(status))
      assert.equal(s.store.map.has(AUTH_STORAGE_KEY), false)
      assert.notEqual(s.service.getState().status, 'signedIn')
    }
    const net = setup(() => { throw new TypeError('offline') })
    assert.deepEqual(await net.service.signInWithPassword('a@b.test', 'pw'), { ok: false, reason: 'network' })
  })
  test('비정상 성공 응답(JSON 아님·토큰 누락·sub 없는 토큰)은 bad-response이고 세션을 만들지 않는다', async () => {
    const bodies: Response[] = [new Response('not json', { status: 200 }), json(200, {}), json(200, { access_token: 'x', refresh_token: 'y', expires_in: 10 }), json(200, { access_token: jwt('A'), refresh_token: 'r' })]
    for (const body of bodies) {
      const s = setup(() => body.clone())
      assert.deepEqual(await s.service.signInWithPassword('a@b.test', 'pw'), { ok: false, reason: 'bad-response' })
      assert.equal(s.store.map.has(AUTH_STORAGE_KEY), false)
    }
  })
  test('응답을 기다리는 동안 로그아웃하면 그 응답은 버린다(로그아웃한 세션이 되살아나지 않는다)', async () => {
    const gate = deferred<Response>()
    const s = setup(() => gate.promise)
    const pending = s.service.signInWithPassword('a@b.test', 'pw')
    await s.service.signOut()
    gate.resolve(ok('A'))
    assert.deepEqual(await pending, { ok: false, reason: 'superseded' })
    assert.notEqual(s.service.getState().status, 'signedIn')
    assert.equal(s.store.map.has(AUTH_STORAGE_KEY), false)
  })
  test('로그인 요청이 겹치면 먼저 끝난 로그인이 이기고 늦게 도착한 응답은 버린다(계정이 뒤섞이지 않는다)', async () => {
    const gateA = deferred<Response>()
    const gateB = deferred<Response>()
    const s = setup((_c, n) => (n === 1 ? gateA.promise : gateB.promise))
    const a = s.service.signInWithPassword('a@b.test', 'pw')
    const b = s.service.signInWithPassword('c@d.test', 'pw')
    gateB.resolve(ok('B'))
    assert.deepEqual(await b, { ok: true })
    gateA.resolve(ok('A'))
    assert.deepEqual(await a, { ok: false, reason: 'superseded' })
    assert.equal(s.service.getState().userId, 'B')
  })
  test('요청 오류·응답 본문에 입력값·토큰이 오류 결과로 새지 않는다', async () => {
    const s = setup(() => json(401, { msg: 'secret-pw-echo', access_token: 'leak' }))
    const result = await s.service.signInWithPassword('a@b.test', 'secret-pw')
    assert.equal(JSON.stringify(result).includes('secret-pw'), false)
    assert.equal(JSON.stringify(result).includes('leak'), false)
  })
})

describe('계정 전환·로그아웃·세션 복원', () => {
  test('로그인한 상태에서 다른 계정으로 로그인하면 계정이 바뀌고 상태 변경이 한 번 알려진다', async () => {
    let n = 0
    const s = setup(() => ok(n++ === 0 ? 'A' : 'B'))
    await s.service.signInWithPassword('a@b.test', 'pw')
    const seen: string[] = []
    s.service.onAuthStateChange((st) => seen.push(`${st.status}:${st.userId}`))
    await s.service.signInWithPassword('c@d.test', 'pw')
    assert.deepEqual(seen, ['signedIn:B'])
  })
  test('로그아웃하면 로컬 세션이 먼저 지워지고 서버 로그아웃이 닿지 않아도 signedOut이다', async () => {
    const s = setup((c) => (c.url.includes('/logout') ? json(500, {}) : ok('A')))
    await s.service.signInWithPassword('a@b.test', 'pw')
    await s.service.signOut()
    assert.equal(s.service.getState().status, 'signedOut')
    assert.equal(s.store.map.has(AUTH_STORAGE_KEY), false)
    assert.equal(await s.service.getAccessToken(), null)
  })
  test('새로고침(새 서비스)에서 저장된 세션을 복원하고, 만료 임박이면 갱신한다', async () => {
    const first = setup(() => ok('A', 3600))
    await first.service.signInWithPassword('a@b.test', 'pw')
    const raw = first.store.map.get(AUTH_STORAGE_KEY) as string
    const store2 = kv()
    store2.map.set(AUTH_STORAGE_KEY, raw)
    const calls: string[] = []
    const svc = createAuthService({ config: CONFIG, storage: createAuthStorage(store2), fetch: (async (u: RequestInfo | URL) => { calls.push(String(u)); return json(200, {}) }) as typeof fetch, now: () => 1_000_000 })
    await svc.init()
    assert.equal(svc.getState().status, 'signedIn')
    assert.equal(svc.getState().userId, 'A')
    assert.equal(calls.length, 0) // 아직 유효하므로 갱신하지 않는다
    const late = createAuthService({ config: CONFIG, storage: createAuthStorage(store2), fetch: (async (u: RequestInfo | URL) => { calls.push(String(u)); return json(200, { access_token: jwt('A'), refresh_token: 'r2', expires_in: 3600 }) }) as typeof fetch, now: () => 1_000_000 + 3_600_000 - 30_000 })
    await late.init()
    assert.ok(calls.some((u) => u.includes('grant_type=refresh_token')))
    assert.equal(late.getState().status, 'signedIn')
  })
  test('갱신 토큰이 거부되면 세션을 지우고 expired(다시 로그인 필요)로 알린다', async () => {
    const s = setup(() => ok('A', 3600))
    await s.service.signInWithPassword('a@b.test', 'pw')
    const store2 = kv()
    store2.map.set(AUTH_STORAGE_KEY, s.store.map.get(AUTH_STORAGE_KEY) as string)
    const svc = createAuthService({ config: CONFIG, storage: createAuthStorage(store2), fetch: (async () => json(400, { error: 'invalid_grant' })) as typeof fetch, now: () => 1_000_000 + 3_600_000 - 30_000 })
    await svc.init()
    assert.equal(svc.getState().status, 'expired')
    assert.equal(store2.map.has(AUTH_STORAGE_KEY), false)
  })
})
