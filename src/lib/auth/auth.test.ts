import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createApiClient } from '../api/client.ts'
import { ApiError, NetworkError } from '../api/errors.ts'
import { createAuthService, parseTokenResponse } from './authService.ts'
import { readSupabaseConfig } from './config.ts'
import { AUTH_STORAGE_KEY, createAuthStorage } from './storage.ts'
import type { KeyValueStorage } from './storage.ts'

// 가짜 fetch·저장소·시계만 쓴다. 실제 Supabase나 백엔드에는 요청하지 않는다(값도 모두 테스트용 가짜).
const CONFIG = { url: 'https://example.supabase.test', anonKey: 'test-anon-key' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function memoryKv(initial?: string): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(AUTH_STORAGE_KEY, initial)
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

function jwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`
}

interface Call {
  url: string
  init: RequestInit
}
function setup(opts: { session?: { accessToken: string; refreshToken: string; expiresAt: number }; respond?: (c: Call) => Response | Promise<Response>; config?: typeof CONFIG | null; clock?: { t: number } }) {
  const clock = opts.clock ?? { t: 1_000_000 }
  const kv = memoryKv(opts.session ? JSON.stringify({ version: 1, data: opts.session }) : undefined)
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return opts.respond ? opts.respond(call) : json(500, {})
  }) as typeof fetch
  const service = createAuthService({
    config: opts.config === undefined ? CONFIG : opts.config,
    storage: createAuthStorage(kv),
    fetch: fetchFn,
    now: () => clock.t,
  })
  return { service, kv, calls, clock }
}

const refreshBody = (access: string, expiresAt: number) => ({ access_token: access, refresh_token: 'r2', expires_at: Math.floor(expiresAt / 1000) })

describe('Supabase 설정', () => {
  test('URL과 키가 모두 있어야 켜지고, 없으면 null(인증 꺼짐)', () => {
    assert.deepEqual(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://a.test/', VITE_SUPABASE_ANON_KEY: ' k ' }), { url: 'https://a.test', anonKey: 'k' })
    assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://a.test' }), null)
    assert.equal(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'k' }), null)
    assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL: 'ftp://a', VITE_SUPABASE_ANON_KEY: 'k' }), null)
    assert.equal(readSupabaseConfig({}), null)
  })
  test('설정이 없으면 disabled이고 모든 동작이 안전하게 무시된다', async () => {
    const { service, calls } = setup({ config: null })
    await service.init()
    assert.equal(service.getState().status, 'disabled')
    assert.equal(await service.getAccessToken(), null)
    assert.equal(service.setSession({ accessToken: 'a', refreshToken: 'r', expiresAt: 9e12 }), false)
    await service.signOut()
    assert.equal(calls.length, 0)
  })
})

describe('세션 저장소', () => {
  test('손상·형식 불일치·버전 불일치는 세션 없음으로 본다', () => {
    for (const raw of ['not json', '{}', JSON.stringify({ version: 2, data: {} }), JSON.stringify({ version: 1, data: { accessToken: 'a' } }), 'null']) {
      assert.equal(createAuthStorage(memoryKv(raw)).load(), null)
    }
  })
  test('저장소가 없거나 예외를 던져도 앱이 깨지지 않는다', () => {
    const bad: KeyValueStorage = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    const s = createAuthStorage(bad)
    assert.equal(s.load(), null)
    s.save({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 })
    s.clear()
    assert.equal(createAuthStorage(null).load(), null)
  })
})

describe('세션 복구', () => {
  test('저장된 세션이 없으면 signedOut(게스트)', async () => {
    const { service } = setup({})
    await service.init()
    assert.equal(service.getState().status, 'signedOut')
    assert.equal(await service.getAccessToken(), null)
  })
  test('유효한 세션은 갱신 없이 복구되고 userId가 토큰 sub에서 나온다', async () => {
    const access = jwt('user-1')
    const { service, calls, clock } = setup({ session: { accessToken: access, refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 } })
    assert.equal(service.getState().status, 'initializing')
    await service.init()
    assert.deepEqual(service.getState(), { status: 'signedIn', userId: 'user-1' })
    assert.equal(await service.getAccessToken(), access)
    assert.equal(calls.length, 0)
    assert.ok(clock.t)
  })
  test('만료된 세션은 시작할 때 갱신하고 저장소에도 반영한다', async () => {
    const next = jwt('user-1')
    const { service, calls, kv } = setup({
      session: { accessToken: 'old', refreshToken: 'r1', expiresAt: 500_000 },
      respond: () => json(200, refreshBody(next, 1_000_000 + 3_600_000)),
    })
    await service.init()
    assert.equal(service.getState().status, 'signedIn')
    assert.equal(await service.getAccessToken(), next)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${CONFIG.url}/auth/v1/token?grant_type=refresh_token`)
    assert.equal((calls[0].init.headers as Record<string, string>).apikey, CONFIG.anonKey)
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { refresh_token: 'r1' })
    assert.ok(kv.map.get(AUTH_STORAGE_KEY)?.includes(next))
  })
  test('갱신 토큰이 거부되면 세션을 지우고 expired', async () => {
    const { service, kv } = setup({ session: { accessToken: 'old', refreshToken: 'r', expiresAt: 500_000 }, respond: () => json(400, { error: 'invalid_grant' }) })
    await service.init()
    assert.equal(service.getState().status, 'expired')
    assert.equal(kv.map.has(AUTH_STORAGE_KEY), false)
    assert.equal(await service.getAccessToken(), null)
  })
  test('갱신 중 네트워크 오류면 만료 전 토큰은 유지하고, 이미 만료됐으면 쓰지 않는다', async () => {
    const offline = () => { throw new TypeError('offline') }
    const stillValid = setup({ session: { accessToken: 'a', refreshToken: 'r', expiresAt: 1_000_000 + 30_000 }, respond: offline })
    await stillValid.service.init()
    assert.equal(stillValid.service.getState().status, 'signedIn')
    assert.equal(await stillValid.service.getAccessToken(), 'a')
    assert.equal(stillValid.kv.map.has(AUTH_STORAGE_KEY), true)

    const dead = setup({ session: { accessToken: 'a', refreshToken: 'r', expiresAt: 900_000 }, respond: offline })
    await dead.service.init()
    assert.equal(dead.service.getState().status, 'signedOut')
    assert.equal(await dead.service.getAccessToken(), null)
    assert.equal(dead.kv.map.has(AUTH_STORAGE_KEY), true) // 세션은 남겨 두어 네트워크가 돌아오면 다시 갱신할 수 있다
  })
  test('5xx·형식이 이상한 응답은 세션을 지우지 않는다', async () => {
    for (const respond of [() => json(503, {}), () => json(200, { access_token: 'x' })]) {
      const { service, kv } = setup({ session: { accessToken: 'a', refreshToken: 'r', expiresAt: 900_000 }, respond })
      await service.init()
      assert.equal(kv.map.has(AUTH_STORAGE_KEY), true)
      assert.notEqual(service.getState().status, 'expired')
    }
  })
  test('토큰 응답 해석: expires_at 또는 expires_in이 있어야 한다', () => {
    assert.deepEqual(parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 10 }, 1000), { accessToken: 'a', refreshToken: 'r', expiresAt: 11_000 })
    assert.equal(parseTokenResponse({ access_token: 'a', refresh_token: 'r' }, 0), null)
    assert.equal(parseTokenResponse(null, 0), null)
  })
})

describe('토큰 공급·갱신', () => {
  test('만료 임박이면 getAccessToken이 먼저 갱신하고, 동시에 불러도 갱신은 한 번', async () => {
    const next = jwt('u')
    const { service, calls } = setup({
      session: { accessToken: 'a', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 },
      respond: () => json(200, refreshBody(next, 1_000_000 + 7_200_000)),
    })
    await service.init()
    const { clock } = setup({})
    void clock
    // 시계를 앞으로: 새 서비스로 임박 상태를 만든다.
    const near = setup({ session: { accessToken: 'a', refreshToken: 'r', expiresAt: 1_000_000 + 10_000 }, respond: () => json(200, refreshBody(next, 1_000_000 + 7_200_000)) })
    await near.service.init()
    const tokens = await Promise.all([near.service.getAccessToken(), near.service.getAccessToken(), near.service.getAccessToken()])
    assert.deepEqual(tokens, [next, next, next])
    assert.equal(near.calls.length, 1)
    assert.equal(calls.length, 0)
  })
  test('setSession으로 로그인 결과를 등록하면 signedIn이 되고 상태 변경이 통지된다', () => {
    const { service, kv } = setup({})
    const seen: string[] = []
    const off = service.onAuthStateChange((s) => seen.push(s.status))
    assert.equal(service.setSession({ accessToken: jwt('u2'), refreshToken: 'r', expiresAt: 2_000_000 }), true)
    assert.deepEqual(service.getState(), { status: 'signedIn', userId: 'u2' })
    assert.ok(kv.map.has(AUTH_STORAGE_KEY))
    off()
    assert.deepEqual(seen, ['signedIn'])
    assert.equal(service.setSession({ accessToken: '', refreshToken: 'r', expiresAt: 1 }), false)
  })
  test('signOut은 로컬을 먼저 지우고 서버 로그아웃을 시도하며, 서버가 실패해도 로그아웃된다', async () => {
    const ok = setup({ respond: () => new Response(null, { status: 204 }) })
    ok.service.setSession({ accessToken: 'tok', refreshToken: 'r', expiresAt: 2_000_000 })
    await ok.service.signOut()
    assert.equal(ok.service.getState().status, 'signedOut')
    assert.equal(ok.kv.map.has(AUTH_STORAGE_KEY), false)
    assert.equal(ok.calls[0].url, `${CONFIG.url}/auth/v1/logout`)
    assert.equal((ok.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok')

    const bad = setup({ respond: () => { throw new TypeError('offline') } })
    bad.service.setSession({ accessToken: 'tok', refreshToken: 'r', expiresAt: 2_000_000 })
    await bad.service.signOut()
    assert.equal(bad.service.getState().status, 'signedOut')
  })
  test('handleUnauthorized: 로그인 상태면 expired, 게스트면 그대로', () => {
    const a = setup({})
    a.service.setSession({ accessToken: 'tok', refreshToken: 'r', expiresAt: 2_000_000 })
    a.service.handleUnauthorized()
    assert.equal(a.service.getState().status, 'expired')
    assert.equal(a.kv.map.has(AUTH_STORAGE_KEY), false)
    const guest = setup({})
    guest.service.handleUnauthorized()
    assert.equal(guest.service.getState().status, 'initializing')
  })
  test('다른 탭의 로그인·로그아웃이 저장소를 통해 반영된다', async () => {
    const { service, kv } = setup({})
    await service.init()
    kv.map.set(AUTH_STORAGE_KEY, JSON.stringify({ version: 1, data: { accessToken: jwt('t'), refreshToken: 'r', expiresAt: 2_000_000 } }))
    service.syncFromStorage()
    assert.equal(service.getState().status, 'signedIn')
    kv.map.delete(AUTH_STORAGE_KEY)
    service.syncFromStorage()
    assert.equal(service.getState().status, 'signedOut')
  })
})

describe('API 클라이언트 + 인증 연결', () => {
  function clientWith(service: ReturnType<typeof setup>['service'], respond: (c: Call) => Response) {
    const calls: Call[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const c = { url: String(input), init: init ?? {} }
      calls.push(c)
      return respond(c)
    }) as typeof fetch
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fetchFn,
      getAccessToken: () => service.getAccessToken(),
      refreshAccessToken: () => service.forceRefresh(),
      onUnauthorized: () => service.handleUnauthorized(),
    })
    return { client, calls }
  }
  const authOf = (c: Call) => (c.init.headers as Record<string, string>).Authorization

  test('요청에 Bearer 토큰이 자동으로 붙는다', async () => {
    const { service } = setup({ session: { accessToken: 'tok1', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 } })
    await service.init()
    const { client, calls } = clientWith(service, () => json(200, { ok: 1 }))
    await client.request('GET', '/api/v1/users/me')
    assert.equal(authOf(calls[0]), 'Bearer tok1')
  })
  test('게스트(세션 없음)는 토큰 없이 나간다', async () => {
    const { service } = setup({})
    await service.init()
    const { client, calls } = clientWith(service, () => json(200, {}))
    await client.request('GET', '/api/v1/users/me')
    assert.equal(authOf(calls[0]), undefined)
  })
  test('401이면 한 번 갱신해 새 토큰으로 다시 보내고 성공하면 로그인 상태를 유지한다', async () => {
    const fresh = jwt('u')
    const { service } = setup({
      session: { accessToken: 'stale', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 },
      respond: () => json(200, refreshBody(fresh, 1_000_000 + 7_200_000)),
    })
    await service.init()
    const { client, calls } = clientWith(service, (c) => (authOf(c) === 'Bearer stale' ? json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }) : json(200, { done: true })))
    assert.deepEqual(await client.request('GET', '/api/v1/users/me'), { done: true })
    assert.equal(calls.length, 2)
    assert.equal(authOf(calls[1]), `Bearer ${fresh}`)
    assert.equal(service.getState().status, 'signedIn')
  })
  test('갱신 뒤에도 401이면 ApiError를 던지고 세션을 만료로 처리한다(무한 재시도 없음)', async () => {
    const fresh = jwt('u')
    const { service, kv } = setup({
      session: { accessToken: 'stale', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 },
      respond: () => json(200, refreshBody(fresh, 1_000_000 + 7_200_000)),
    })
    await service.init()
    const { client, calls } = clientWith(service, () => json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }))
    await assert.rejects(client.request('GET', '/api/v1/users/me'), (e) => e instanceof ApiError && e.isUnauthorized && e.errorCode === 'AUTH_INVALID_TOKEN')
    assert.equal(calls.length, 2)
    assert.equal(service.getState().status, 'expired')
    assert.equal(kv.map.has(AUTH_STORAGE_KEY), false)
  })
  test('갱신 토큰이 거부되면 재시도 없이 expired', async () => {
    const { service } = setup({ session: { accessToken: 'stale', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 }, respond: () => json(400, {}) })
    await service.init()
    const { client, calls } = clientWith(service, () => json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }))
    await assert.rejects(client.request('GET', '/x'), ApiError)
    assert.equal(calls.length, 1)
    assert.equal(service.getState().status, 'expired')
  })
  test('게스트의 401은 로그인 상태를 만들거나 바꾸지 않는다', async () => {
    const { service } = setup({})
    await service.init()
    const { client } = clientWith(service, () => json(401, { status_code: 401, error_code: 'AUTH_MISSING_TOKEN', message: 'x' }))
    await assert.rejects(client.request('GET', '/x'), (e) => e instanceof ApiError && e.errorCode === 'AUTH_MISSING_TOKEN')
    assert.equal(service.getState().status, 'signedOut')
  })
  test('네트워크 오류는 NetworkError이고 세션을 건드리지 않는다', async () => {
    const { service } = setup({ session: { accessToken: 'tok', refreshToken: 'r', expiresAt: 1_000_000 + 3_600_000 } })
    await service.init()
    const { client } = clientWith(service, () => { throw new TypeError('offline') })
    await assert.rejects(client.request('GET', '/x'), NetworkError)
    assert.equal(service.getState().status, 'signedIn')
  })
  test('인증 처리 중 토큰·키가 콘솔에 출력되지 않는다', async () => {
    const out: string[] = []
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug }
    for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void out.push(a.join(' '))
    try {
      const { service } = setup({ session: { accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH', expiresAt: 500_000 }, respond: () => json(400, {}) })
      await service.init()
      await service.signOut()
    } finally {
      Object.assign(console, orig)
    }
    assert.equal(out.join('\n').includes('SECRET'), false)
  })
})
