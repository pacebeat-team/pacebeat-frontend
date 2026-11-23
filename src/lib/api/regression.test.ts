import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createApiClient } from './client.ts'
import { ApiError, NetworkError } from './errors.ts'
import { createApi } from './endpoints.ts'
import { createAppQueryClient, shouldRetryQuery } from './queryClient.ts'
import { createRunSyncQueue, RUN_SYNC_QUEUE_KEY } from '../../features/serverSync/runSyncQueue.ts'

// #72 회귀 검증: 가짜 fetch·저장소만 쓴다. 실제 서버(운영 포함)와 Supabase에는 요청하지 않는다.
const SRC = fileURLToPath(new URL('../../', import.meta.url))

function listSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listSources(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('API 연동 비활성 상태(설정 없음) 회귀', () => {
  test('환경 설정이 없으면 api는 null이고 인증은 disabled이며 서버 요청이 나가지 않는다', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('{}')
    }) as typeof fetch
    try {
      const { api } = await import('./index.ts')
      const { auth } = await import('../auth/index.ts')
      assert.equal(api, null)
      assert.equal(auth.getState().status, 'disabled')
      await auth.init()
      assert.equal(await auth.getAccessToken(), null)
      assert.equal(calls, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('어떤 화면·Store도 아직 API·인증·서버 동기화 모듈을 직접 쓰지 않는다(연결은 화면 PR 병합 후)', () => {
    const allowed = ['lib/api/', 'lib/auth/', 'features/serverSync/', 'main.tsx']
    const offenders: string[] = []
    for (const file of listSources(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (allowed.some((a) => rel.startsWith(a) || rel === a)) continue
      const text = readFileSync(file, 'utf8')
      if (/from\s+['"][^'"]*(lib\/api|lib\/auth|features\/serverSync|serverSync)\b[^'"]*['"]/.test(text)) offenders.push(rel)
    }
    assert.deepEqual(offenders, [])
  })

  test('fetch 호출은 API Client·인증 서비스 안에만 있다(컴포넌트가 직접 호출하지 않는다)', () => {
    const offenders: string[] = []
    for (const file of listSources(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (rel.startsWith('lib/api/') || rel.startsWith('lib/auth/')) continue
      if (/\bfetch\s*\(/.test(readFileSync(file, 'utf8'))) offenders.push(rel)
    }
    assert.deepEqual(offenders, [])
  })

  test('lib(공통 기반)은 features·pages·stores를 가져오지 않는다', () => {
    const offenders: string[] = []
    for (const file of listSources(join(SRC, 'lib', 'api')).concat(listSources(join(SRC, 'lib', 'auth')))) {
      if (/from\s+['"][^'"]*\/(features|pages|stores)\//.test(readFileSync(file, 'utf8'))) offenders.push(relative(SRC, file))
    }
    assert.deepEqual(offenders, [])
  })
})

describe('오류 처리 매트릭스(401/403/404/422/5xx/네트워크/시간 초과)', () => {
  const body = (status: number, code: string) => new Response(JSON.stringify({ status_code: status, error_code: code, message: 'm' }), { status })
  const clientWith = (fetchFn: typeof fetch, extra: { timeoutMs?: number } = {}) => createApi(createApiClient({ baseUrl: 'https://api.test', fetch: fetchFn, ...extra }))

  for (const [status, code] of [[401, 'AUTH_INVALID_TOKEN'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [422, 'VALIDATION_ERROR'], [500, 'INTERNAL_ERROR'], [503, 'UNAVAILABLE']] as const) {
    test(`${status} 응답은 ApiError(status·error_code 보존)`, async () => {
      const api = clientWith((async () => body(status, code)) as typeof fetch)
      await assert.rejects(api.users.getMe(), (e) => e instanceof ApiError && e.status === status && e.errorCode === code)
    })
  }
  test('표준 형식이 아닌 오류 본문도 ApiError로 다룬다', async () => {
    const api = clientWith((async () => new Response('<html>bad gateway</html>', { status: 502 })) as typeof fetch)
    await assert.rejects(api.users.getMe(), (e) => e instanceof ApiError && e.status === 502)
  })
  test('네트워크 오류는 NetworkError(시간 초과 아님)', async () => {
    const api = clientWith((async () => { throw new TypeError('offline') }) as typeof fetch)
    await assert.rejects(api.users.getMe(), (e) => e instanceof NetworkError && e.timedOut === false)
  })
  test('시간 초과는 NetworkError(timedOut)이고 응답 없는 요청을 취소한다', async () => {
    let aborted = false
    const never = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch
    const api = clientWith(never, { timeoutMs: 20 })
    await assert.rejects(api.users.getMe(), (e) => e instanceof NetworkError && e.timedOut === true)
    assert.equal(aborted, true)
  })
  test('조회 재시도 정책: 4xx(401 포함)는 재시도하지 않고 네트워크·5xx만 제한적으로 재시도한다', () => {
    assert.equal(shouldRetryQuery(0, new ApiError(401, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new ApiError(404, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new ApiError(422, 'X', 'm')), false)
    assert.equal(shouldRetryQuery(0, new NetworkError('x', false)), true)
    assert.equal(shouldRetryQuery(0, new ApiError(503, 'X', 'm')), true)
    assert.equal(shouldRetryQuery(5, new NetworkError('x', false)), false)
    assert.equal(createAppQueryClient().getDefaultOptions().mutations?.retry, false)
  })
})

describe('서버 저장 실패·오프라인에서 로컬 데이터 보존', () => {
  test('저장 대기열은 자기 키만 쓰고 다른 저장 키(러닝 기록·프로필·온보딩 등)를 읽거나 쓰거나 지우지 않는다', async () => {
    const touched: string[] = []
    const map = new Map<string, string>([
      ['pacebeat:run:records:v1', 'RECORDS'],
      ['pacebeat-profile', 'PROFILE'],
      ['pacebeat-onboarding', 'ONBOARDING'],
    ])
    const storage = {
      getItem: (k: string) => (touched.push(k), map.get(k) ?? null),
      setItem: (k: string, v: string) => (touched.push(k), void map.set(k, v)),
    }
    const queue = createRunSyncQueue({
      storage,
      getApi: () => ({ runs: { create: async () => { throw new NetworkError('offline', false) } } }),
      now: () => 1,
    })
    queue.enqueue({ client_session_id: 'a', mode: 'gps', completion: 'goal', started_at: 's', ended_at: 'e', elapsed_ms: 1 })
    await queue.flush()
    assert.deepEqual([...new Set(touched)], [RUN_SYNC_QUEUE_KEY])
    assert.equal(map.get('pacebeat:run:records:v1'), 'RECORDS')
    assert.equal(map.get('pacebeat-profile'), 'PROFILE')
    assert.equal(map.get('pacebeat-onboarding'), 'ONBOARDING')
    assert.equal(queue.list().length, 1)
  })
})
