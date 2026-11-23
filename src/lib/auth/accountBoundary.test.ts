import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { OwnerChangedError } from '../api/errors.ts'
import { createOwnerBoundApi } from '../api/ownerBound.ts'
import { createAuthService, readUserId } from './authService.ts'
import { AUTH_STORAGE_KEY, createAuthStorage } from './storage.ts'

// 계정 경계 회귀 테스트: 토큰 갱신·요청 도중 로그아웃/계정 전환. 가짜 fetch·저장소·시계만 쓴다(실서버 요청 없음, 값은 모두 테스트용).
const CONFIG = { url: 'https://example.supabase.test', anonKey: 'test-anon-key' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const jwt = (sub: string, tag = ''): string => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64({ sub, tag })}.sig`
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function world() {
  const clock = { t: 1_000_000 }
  const map = new Map<string, string>()
  const kv = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
  const refreshCalls: Array<{ refresh_token: string }> = []
  const apiCalls: Array<{ auth: string | null }> = []
  const gates = { refresh: null as null | ReturnType<typeof deferred<Response>>, api: null as null | ReturnType<typeof deferred<Response>> }
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/auth/v1/token')) {
      refreshCalls.push(JSON.parse(String(init?.body)))
      if (gates.refresh) return gates.refresh.promise
      return json(500, {})
    }
    if (url.includes('/auth/v1/')) return json(204, null) // 서버 로그아웃 등 인증 서버 호출은 API 호출로 세지 않는다
    const headers = init?.headers as Record<string, string>
    apiCalls.push({ auth: headers.Authorization ?? null })
    if (gates.api) return gates.api.promise
    return json(200, {})
  }) as typeof fetch
  const service = createAuthService({ config: CONFIG, storage: createAuthStorage(kv), fetch: fetchFn, now: () => clock.t })
  const login = (sub: string, opts: { stale?: boolean } = {}) =>
    service.setSession({ accessToken: jwt(sub, 'orig'), refreshToken: `refresh-${sub}`, expiresAt: clock.t + (opts.stale ? 30_000 : 600_000) })
  const bound = (sub: string) =>
    createOwnerBoundApi({ baseUrl: 'https://api.test', auth: { getState: service.getState, getAccessToken: service.getAccessToken, forceRefresh: service.forceRefresh, handleUnauthorized: service.handleUnauthorized, readUserId }, expectedUserId: sub, fetch: fetchFn })
  const refreshOk = (sub: string) => json(200, { access_token: jwt(sub, 'refreshed'), refresh_token: 'rnew', expires_at: Math.floor((clock.t + 600_000) / 1000) })
  return { clock, service, refreshCalls, apiCalls, gates, login, bound, refreshOk, kvMap: map }
}

describe('인증 서비스: 갱신 도중 계정 변경', () => {
  test('A 갱신 응답이 늦게 도착해도 그 사이 로그인한 B의 세션을 덮어쓰지 않는다', async () => {
    const w = world()
    await w.service.init()
    w.login('A', { stale: true })
    w.gates.refresh = deferred<Response>()
    const token = w.service.getAccessToken() // A 갱신 시작(응답 대기)
    await tick()
    w.login('B') // 그 사이 B 로그인
    w.gates.refresh.resolve(w.refreshOk('A'))
    const got = await token
    assert.equal(readUserId(got ?? ''), 'B')
    assert.equal(w.service.getState().userId, 'B')
    assert.equal(readUserId(JSON.parse(w.kvMap.get(AUTH_STORAGE_KEY)!).data.accessToken), 'B') // 저장소도 B
  })
  test('로그아웃 도중 도착한 A 갱신 응답이 로그아웃한 세션을 되살리지 않는다', async () => {
    const w = world()
    await w.service.init()
    w.login('A', { stale: true })
    w.gates.refresh = deferred<Response>()
    const token = w.service.getAccessToken()
    await tick()
    await w.service.signOut()
    w.gates.refresh.resolve(w.refreshOk('A'))
    assert.equal(await token, null)
    assert.equal(w.service.getState().status, 'signedOut')
    assert.equal(w.kvMap.has(AUTH_STORAGE_KEY), false)
  })
  test('진행 중인 갱신은 같은 세션에서만 공유하고, 계정이 바뀌면 B의 갱신 토큰으로 따로 갱신한다', async () => {
    const w = world()
    await w.service.init()
    w.login('A', { stale: true })
    w.gates.refresh = deferred<Response>()
    const a = w.service.getAccessToken()
    await tick()
    w.login('B', { stale: true })
    const b = w.service.getAccessToken()
    await tick()
    assert.deepEqual(w.refreshCalls.map((c) => c.refresh_token), ['refresh-A', 'refresh-B']) // B가 A의 갱신에 편승하지 않는다
    w.gates.refresh.resolve(w.refreshOk('B'))
    await Promise.all([a, b])
  })
  test('늦은 401 처리는 요청한 계정이 현재 계정일 때만 세션을 만료시킨다', async () => {
    const w = world()
    await w.service.init()
    w.login('B')
    w.service.handleUnauthorized('A') // A 요청의 늦은 401
    assert.equal(w.service.getState().status, 'signedIn')
    w.service.handleUnauthorized('B')
    assert.equal(w.service.getState().status, 'expired')
    w.login('C')
    w.service.handleUnauthorized() // 인자 없는 기존 동작 유지
    assert.equal(w.service.getState().status, 'expired')
  })
})

describe('계정에 묶인 API', () => {
  test('정상: 같은 계정이면 그 계정의 토큰으로 나간다', async () => {
    const w = world()
    await w.service.init()
    w.login('A')
    await w.bound('A').users.getMe()
    assert.equal(w.apiCalls.length, 1)
    assert.equal(readUserId((w.apiCalls[0]?.auth ?? '').replace('Bearer ', '')), 'A')
  })
  test('토큰 갱신 도중 A→B 전환: 요청은 보내지 않는다(B의 토큰이 A의 요청에 붙지 않는다)', async () => {
    const w = world()
    await w.service.init()
    w.login('A', { stale: true })
    w.gates.refresh = deferred<Response>()
    const req = w.bound('A').runs.create({ client_session_id: 'x' } as never)
    const outcome = req.then(() => 'sent', (e: unknown) => e)
    await tick()
    w.login('B')
    w.gates.refresh.resolve(w.refreshOk('A'))
    assert.ok((await outcome) instanceof OwnerChangedError)
    assert.equal(w.apiCalls.length, 0) // 서버로 아무것도 나가지 않았다
  })
  test('토큰 갱신 도중 로그아웃: 요청은 보내지 않는다', async () => {
    const w = world()
    await w.service.init()
    w.login('A', { stale: true })
    w.gates.refresh = deferred<Response>()
    const outcome = w.bound('A').users.getMe().then(() => 'sent', (e: unknown) => e)
    await tick()
    await w.service.signOut()
    w.gates.refresh.resolve(w.refreshOk('A'))
    assert.ok((await outcome) instanceof OwnerChangedError)
    assert.equal(w.apiCalls.length, 0)
  })
  test('요청이 나간 뒤 A→B 전환 + 늦은 401: 재시도하지 않고 B를 로그아웃시키지 않는다', async () => {
    const w = world()
    await w.service.init()
    w.login('A')
    w.gates.api = deferred<Response>()
    const outcome = w.bound('A').users.getMe().then(() => 'ok', (e: unknown) => e)
    await tick()
    w.login('B')
    w.gates.api.resolve(json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }))
    await outcome
    assert.equal(w.apiCalls.length, 1) // A의 요청 1건뿐, B의 토큰으로 재시도하지 않았다
    assert.equal(readUserId((w.apiCalls[0]?.auth ?? '').replace('Bearer ', '')), 'A')
    assert.equal(w.service.getState().status, 'signedIn') // B는 그대로 로그인 상태
    assert.equal(w.service.getState().userId, 'B')
    assert.equal(w.refreshCalls.length, 0) // B의 세션을 A의 401 때문에 갱신하지도 않았다
  })
  test('401 후 갱신 도중 A→B 전환: 새 토큰으로 재시도하지 않는다', async () => {
    const w = world()
    await w.service.init()
    w.login('A')
    w.gates.api = null
    w.gates.refresh = deferred<Response>()
    // 첫 API 응답은 401로 즉시 돌려준다
    const outcomePromise = (async () => {
      try {
        // 401 응답을 만들기 위해 api 게이트를 즉시 해제된 401로 설정
        w.gates.api = deferred<Response>()
        w.gates.api.resolve(json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }))
        await w.bound('A').users.getMe()
        return 'ok'
      } catch (e) {
        return e
      }
    })()
    await tick()
    await tick()
    w.login('B') // 갱신(forceRefresh) 응답을 기다리는 동안 B로 전환
    w.gates.refresh.resolve(w.refreshOk('B'))
    await outcomePromise
    assert.equal(w.apiCalls.length, 1) // 재시도는 나가지 않았다
    assert.equal(w.service.getState().userId, 'B')
    assert.equal(w.service.getState().status, 'signedIn')
  })
})
