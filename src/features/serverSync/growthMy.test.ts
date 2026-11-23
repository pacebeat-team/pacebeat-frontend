import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { createApi } from '../../lib/api/endpoints.ts'
import { createApiClient } from '../../lib/api/client.ts'
import { ApiError } from '../../lib/api/errors.ts'
import { apiMutations, apiQueries } from './queries.ts'
import { fromPostureGrowth, fromRunningGrowth } from './growthMapper.ts'
import { mergeServerGuidance, toGuidancePayload } from './guidanceMapper.ts'
import { fromInsolePair } from './insoleMapper.ts'

// 가짜 데이터와 가짜 fetch만 쓴다. 실제 서버·Supabase에는 요청하지 않는다.
describe('Growth 변환', () => {
  test('러닝 통계: null 보존, 기록 0건이면 isEmpty, 시각 문자열은 해석하지 않는다', () => {
    const empty = fromRunningGrowth({ period: 'weekly', status: 'no_data', buckets: [{ period_start: '2026-11-16', period_end: '2026-11-22', run_count: 0, goal_completed_count: 0, total_distance_m: null, total_elapsed_ms: null, avg_pace_sec_per_km: null, pace_status: 'no_data', difficulty_counts: {} }] })
    assert.equal(empty.isEmpty, true)
    assert.equal(empty.buckets[0].totalDistanceM, null)
    assert.equal(empty.buckets[0].periodStart, '2026-11-16')
    const some = fromRunningGrowth({ period: 'monthly', status: 'valid', buckets: [{ period_start: 'a', period_end: 'b', run_count: 2, goal_completed_count: 1, total_distance_m: 6000, total_elapsed_ms: 2_000_000, avg_pace_sec_per_km: 333, pace_status: 'valid', difficulty_counts: { easy: 2 } }] })
    assert.equal(some.isEmpty, false)
    assert.deepEqual(some.buckets[0].difficultyCounts, { easy: 2 })
  })
  test('자세 통계: 서버 값을 이름만 바꿔 옮기고 판정을 만들지 않는다', () => {
    const v = fromPostureGrowth({ period: 'weekly', overall_status: 'single_foot', buckets: [{ period_start: 'a', period_end: 'b', valid_session_count: 0, single_foot_session_count: 2, status: 'single_foot', avg_ground_contact_left_ms: 200, avg_ground_contact_right_ms: null, avg_left_load_ratio_pct: null, avg_right_load_ratio_pct: null, dominant_feedback: ['x'] }] })
    assert.equal(v.overallStatus, 'single_foot')
    assert.equal(v.buckets[0].avgGroundContactRightMs, null)
    assert.equal('dominant' in v.buckets[0], false)
  })
})

describe('안내 설정·인솔 변환', () => {
  test('음성 안내만 매핑하고 나머지 로컬 설정은 보존한다', () => {
    assert.deepEqual(toGuidancePayload({ voiceGuide: false }), { voice_guidance_enabled: false })
    const local = { beatGuide: true, voiceGuide: true, frequency: 'both' as const, autoPause: false }
    const merged = mergeServerGuidance(local, { voice_guidance_enabled: false, guidance_frequency_km: 2, vibration_intensity: 'high' })
    assert.equal(merged.voiceGuide, false)
    assert.equal(merged.frequency, 'both')
    assert.equal(merged.autoPause, false)
    assert.equal(merged.beatGuide, local.beatGuide)
    assert.equal(mergeServerGuidance(local, {}), local)
    assert.equal(mergeServerGuidance(local, null), local)
  })
  test('인솔: 등록 없음은 null이고 값 없음은 0이 아니라 null', () => {
    const none = fromInsolePair({ left: null, right: null, connection_mode: 'ble' })
    assert.equal(none.noneRegistered, true)
    const one = fromInsolePair({ left: { id: '1', side: 'left', device_identifier: 'd', is_connected: true, battery_pct: null, firmware_version: null, calibration_status: 'not_started', signal_quality: 'unavailable', last_seen_at: null }, right: null, connection_mode: 'ble' })
    assert.equal(one.left?.batteryPct, null)
    assert.equal(one.right, null)
    assert.equal(one.noneRegistered, false)
  })
})

describe('Query·Mutation 옵션 (가짜 fetch)', () => {
  function setup(respond: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; method: string }[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      return respond(String(input), init ?? {})
    }) as typeof fetch
    const api = createApi(createApiClient({ baseUrl: 'https://api.test', fetch: fetchFn }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    return { api, qc, calls }
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  test('성공 조회는 캐시되고, 실패는 ApiError로 전달된다(캐시 오염 없음)', async () => {
    const good = setup(() => ok({ period: 'weekly', status: 'no_data', buckets: [] }))
    const data = await good.qc.fetchQuery(apiQueries.growthRunning(good.api, 'weekly'))
    assert.equal(data.status, 'no_data')
    await good.qc.fetchQuery(apiQueries.growthRunning(good.api, 'weekly'))
    assert.equal(good.calls.length, 1)

    const bad = setup(() => new Response(JSON.stringify({ status_code: 401, error_code: 'AUTH_MISSING_TOKEN', message: 'x' }), { status: 401 }))
    await assert.rejects(bad.qc.fetchQuery(apiQueries.growthRunning(bad.api, 'monthly')), (e) => e instanceof ApiError && e.isUnauthorized)
    assert.equal(bad.qc.getQueryData(['growth', 'running', 'monthly']), undefined)
  })

  test('안내 설정 수정 mutation은 음성 안내만 보내고 프로필 캐시를 무효화한다', async () => {
    const s = setup(() => ok({ voice_guidance_enabled: false }))
    s.qc.setQueryData(['profile'], {})
    const opts = apiMutations.updateGuidance(s.api, s.qc)
    await opts.mutationFn(toGuidancePayload({ voiceGuide: false }))
    assert.equal(s.calls[0].method, 'PATCH')
    assert.equal(s.calls[0].url, 'https://api.test/api/v1/users/me/guidance')
    await opts.onSuccess()
    assert.equal(s.qc.getQueryState(['profile'])?.isInvalidated, true)
  })
  test('인솔 상태 조회는 등록이 없는 응답도 그대로 전달한다', async () => {
    const s = setup(() => ok({ left: null, right: null, connection_mode: 'ble' }))
    const data = await s.qc.fetchQuery(apiQueries.insoles(s.api))
    assert.equal(fromInsolePair(data).noneRegistered, true)
  })
})
