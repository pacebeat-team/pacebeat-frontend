import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createApiClient } from './client.ts'
import { parseApiBaseUrl, readApiConfig } from './config.ts'
import { createApi } from './endpoints.ts'
import { ApiError, NetworkError, parseApiError } from './errors.ts'
import { queryKeys } from './queryKeys.ts'
import { createAppQueryClient, shouldRetryQuery } from './queryClient.ts'

// 이 테스트는 가짜 fetch만 쓴다. 실제 서버(운영 포함)에는 요청하지 않는다.
interface Call {
  url: string
  init: RequestInit
}
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { fn, calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('API 설정', () => {
  test('주소는 http(s)만 받고 끝 슬래시를 정리한다', () => {
    assert.equal(parseApiBaseUrl('https://api.example.com/'), 'https://api.example.com')
    assert.equal(parseApiBaseUrl(' http://localhost:8000// '), 'http://localhost:8000')
    for (const bad of [undefined, null, '', '  ', 'ftp://x.com', 'not a url', 3]) assert.equal(parseApiBaseUrl(bad), null)
  })
  test('환경변수가 없으면 연동 꺼짐(null)이다', () => {
    assert.equal(readApiConfig({}), null)
    assert.deepEqual(readApiConfig({ VITE_API_BASE_URL: 'https://a.b' }), { baseUrl: 'https://a.b' })
  })
})

describe('오류 해석', () => {
  test('표준 오류 본문(status_code/error_code/message)을 ApiError로 만든다', () => {
    const error = parseApiError(401, { status_code: 401, error_code: 'AUTH_MISSING_TOKEN', message: '인증 토큰이 필요합니다.' })
    assert.ok(error instanceof ApiError)
    assert.equal(error.errorCode, 'AUTH_MISSING_TOKEN')
    assert.equal(error.isUnauthorized, true)
  })
  test('본문이 표준 모양이 아니면 UNKNOWN과 상태 코드로 만든다', () => {
    assert.equal(parseApiError(502, null).errorCode, 'UNKNOWN')
    assert.equal(parseApiError(500, 'oops').status, 500)
    assert.equal(parseApiError(422, { detail: [] }).errorCode, 'UNKNOWN')
  })
})

describe('공통 클라이언트', () => {
  test('토큰이 있으면 Bearer 헤더를 붙이고, auth:false면 붙이지 않는다', async () => {
    const f = fakeFetch(() => json(200, {}))
    const client = createApiClient({ baseUrl: 'https://x.test', getAccessToken: () => 'TOKEN', fetch: f.fn })
    await client.request('GET', '/a')
    await client.request('GET', '/health', { auth: false })
    const h0 = f.calls[0].init.headers as Record<string, string>
    const h1 = f.calls[1].init.headers as Record<string, string>
    assert.equal(h0.Authorization, 'Bearer TOKEN')
    assert.equal(h1.Authorization, undefined)
  })
  test('토큰이 없으면 Authorization 없이 요청한다', async () => {
    const f = fakeFetch(() => json(200, {}))
    await createApiClient({ baseUrl: 'https://x.test', getAccessToken: () => null, fetch: f.fn }).request('GET', '/a')
    assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, undefined)
  })
  test('쿼리 문자열은 값이 있는 것만 붙이고 JSON 본문을 보낸다', async () => {
    const f = fakeFetch(() => json(200, {}))
    const client = createApiClient({ baseUrl: 'https://x.test', fetch: f.fn })
    await client.request('POST', '/runs', { query: { from: '2026-11-01', to: undefined, n: 0 }, body: { a: 1 } })
    assert.equal(f.calls[0].url, 'https://x.test/runs?from=2026-11-01&n=0')
    assert.equal(f.calls[0].init.body, '{"a":1}')
    assert.equal((f.calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/json')
  })
  test('204는 null이다', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }))
    assert.equal(await createApiClient({ baseUrl: 'https://x.test', fetch: f.fn }).request('DELETE', '/a'), null)
  })
  test('오류 응답은 ApiError이고, 401이면 onUnauthorized를 한 번 부른다(재시도하지 않는다)', async () => {
    const f = fakeFetch(() => json(401, { status_code: 401, error_code: 'AUTH_INVALID_TOKEN', message: 'x' }))
    let notified = 0
    const client = createApiClient({ baseUrl: 'https://x.test', fetch: f.fn, onUnauthorized: () => void (notified += 1) })
    await assert.rejects(client.request('GET', '/a'), (e: unknown) => e instanceof ApiError && e.errorCode === 'AUTH_INVALID_TOKEN')
    assert.equal(notified, 1)
    assert.equal(f.calls.length, 1)
  })
  test('403·404·422·500은 ApiError이고 onUnauthorized를 부르지 않는다', async () => {
    for (const status of [403, 404, 422, 500]) {
      let notified = 0
      const f = fakeFetch(() => json(status, { status_code: status, error_code: 'X', message: 'm' }))
      const client = createApiClient({ baseUrl: 'https://x.test', fetch: f.fn, onUnauthorized: () => void (notified += 1) })
      await assert.rejects(client.request('GET', '/a'), (e: unknown) => e instanceof ApiError && e.status === status)
      assert.equal(notified, 0)
    }
  })
  test('네트워크 오류는 NetworkError이다', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('failed to fetch')
    })
    await assert.rejects(createApiClient({ baseUrl: 'https://x.test', fetch: f.fn }).request('GET', '/a'), (e: unknown) => e instanceof NetworkError && !e.timedOut)
  })
  test('시간 초과는 timedOut NetworkError이다', async () => {
    const f = fakeFetch(
      (call) =>
        new Promise((_, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await assert.rejects(createApiClient({ baseUrl: 'https://x.test', fetch: f.fn, timeoutMs: 20 }).request('GET', '/a'), (e: unknown) => e instanceof NetworkError && e.timedOut)
  })
  test('호출한 쪽이 취소하면 NetworkError가 아니라 취소 오류가 그대로 나온다', async () => {
    const f = fakeFetch(
      (call) =>
        new Promise((_, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const controller = new AbortController()
    const pending = createApiClient({ baseUrl: 'https://x.test', fetch: f.fn }).request('GET', '/a', { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, (e: unknown) => !(e instanceof NetworkError))
  })
  test('JSON이 아닌 성공 본문은 null로 읽는다', async () => {
    const f = fakeFetch(() => new Response('ok', { status: 200 }))
    assert.equal(await createApiClient({ baseUrl: 'https://x.test', fetch: f.fn }).request('GET', '/a'), null)
  })
})

describe('엔드포인트 경로와 메서드(OpenAPI 1.0.0)', () => {
  test('각 함수가 문서의 메서드·경로를 호출한다', async () => {
    const f = fakeFetch(() => json(200, {}))
    const api = createApi(createApiClient({ baseUrl: 'https://x.test', fetch: f.fn }))
    await api.health()
    await api.users.getMe()
    await api.users.updateGuidance({ voice_guidance_enabled: false, vibration_guidance_enabled: true, guidance_frequency_km: 1, vibration_intensity: 'medium' })
    await api.runs.get('a/b')
    await api.runs.list({ from: '2026-11-01' })
    await api.growth.posture('monthly')
    await api.devices.updateInsole('left', { is_connected: true })
    const seen = f.calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)
    assert.deepEqual(seen, [
      'GET /health',
      'GET /api/v1/users/me',
      'PATCH /api/v1/users/me/guidance',
      'GET /api/v1/runs/a%2Fb',
      'GET /api/v1/runs?from=2026-11-01',
      'GET /api/v1/growth/posture?period=monthly',
      'PATCH /api/v1/devices/insoles/left',
    ])
  })
})

describe('Query 설정', () => {
  test('서버가 응답한 4xx는 재시도하지 않고, 5xx·네트워크 오류는 한 번만 재시도한다', () => {
    assert.equal(shouldRetryQuery(0, new ApiError(404, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new ApiError(401, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new ApiError(500, 'X', 'm')), true)
    assert.equal(shouldRetryQuery(1, new ApiError(500, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new NetworkError('x')), true)
    assert.equal(shouldRetryQuery(1, new NetworkError('x')), false)
  })
  test('쓰기는 자동 재시도하지 않는다', () => {
    assert.equal(createAppQueryClient().getDefaultOptions().mutations?.retry, false)
  })
  test('Query Key는 기능별 첫 요소로 묶이고 매개변수가 키에 들어간다', () => {
    assert.deepEqual(queryKeys.runs({ from: 'a' }), ['runs', 'list', 'a', null])
    assert.notDeepEqual(queryKeys.growthPosture('weekly'), queryKeys.growthPosture('monthly'))
    assert.equal(queryKeys.run('r1')[0], 'runs')
  })
})
