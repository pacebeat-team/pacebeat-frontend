import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { createApi } from '../../lib/api/endpoints.ts'
import { createApiClient } from '../../lib/api/client.ts'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import { apiMutations, apiQueries } from './queries.ts'
import type { RunDetailResponse, UserProfileResponse } from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'
import { baselineRequestFromMetrics, baselineSkippedRequest, fromBaselineResponse } from './baselineMapper.ts'
import { fromUserProfileResponse, toProfileUpdateRequest } from './profileMapper.ts'
import { classifyRunSaveFailure, fromRunDetail, parseRunList, runSaveRetryDelayMs, toRunCreateRequest } from './runMapper.ts'
import { fromIso, toIso } from './time.ts'

// 가짜 데이터와 가짜 fetch만 쓴다. 실제 서버·Supabase에는 요청하지 않는다.
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0)
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: 'v1', consentedAt: T0 }
const profile = { nickname: '달리미', birthYear: 1999, gender: 'female' as const, heightCm: 165, weightKg: null }

function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    recordId: 'rec-1',
    sessionId: 'sess-1',
    mode: 'gps',
    startedAt: T0,
    endedAt: T0 + 1_800_000,
    goal: { targetDistanceKm: 3, targetDurationSec: 1_200 },
    musicTrackId: null,
    result: {
      elapsedMs: 1_700_000,
      distanceM: 3000,
      avgPaceSecPerKm: 360,
      splits: [{ index: 1, distanceM: 1000, durationMs: 360_000, paceSecPerKm: 360 }],
      completion: 'goal',
      gpsGaps: [{ lostAtMs: 5000, recoveredAtMs: null }],
    },
    reflection: { difficulty: 'moderate', reasons: ['legs'], memo: '좋았음' },
    ...over,
  } as RunRecord
}

describe('프로필·온보딩 변환', () => {
  test('로컬 → 서버: null은 null로, 동의는 필수 4개가 모두 있을 때만 보낸다', () => {
    const req = toProfileUpdateRequest({ profile, consent, completedAt: T0, experienceLevel: 'occasional', weeklyRuns: '2' })
    assert.equal(req.nickname, '달리미')
    assert.equal(req.weight_kg, null)
    assert.equal(req.running_experience, 'occasional')
    assert.equal(req.weekly_runs, '2')
    assert.equal(req.consent?.privacy_policy, true)
    assert.equal(req.consent?.consented_at, new Date(T0).toISOString())
    assert.equal(req.profile_completed_at, new Date(T0).toISOString())
    assert.equal('onboarding_completed_at' in req, false)

    const partial = toProfileUpdateRequest({ profile: { ...profile, nickname: '' }, consent: { ...consent, privacyPolicy: false }, completedAt: null, experienceLevel: null, weeklyRuns: null })
    assert.equal('consent' in partial, false)
    assert.equal('profile_completed_at' in partial, false)
    assert.equal(partial.nickname, null)
  })
  test('서버 → 로컬: 누락은 안전한 기본값(0이 아니라 null/빈 값)', () => {
    const res: UserProfileResponse = {
      user_id: 'u1', nickname: null, birth_year: null, gender: null, height_cm: null, weight_kg: null, running_experience: null,
      consent: { age_over_14: true, terms_of_service: true, privacy_policy: true, location_terms: true },
      guidance: {}, onboarding_completed_at: null, profile_completed_at: '2026-11-20T09:00:00Z',
    }
    const v = fromUserProfileResponse(res)
    assert.equal(v.profile.nickname, '')
    assert.equal(v.profile.heightCm, null)
    assert.equal(v.consent.marketing, false)
    assert.equal(v.consent.consentedAt, null)
    assert.equal(v.completedAt, Date.UTC(2026, 10, 20, 9))
    assert.equal(v.weeklyRuns, null)
  })
  test('시각 변환은 해석 불가면 null', () => {
    assert.equal(toIso(NaN), null)
    assert.equal(fromIso('nope'), null)
    assert.equal(fromIso(toIso(T0)), T0)
  })
})

describe('기초 측정 변환', () => {
  test('기준 페이스는 기존 규칙(유효 2분 미만이면 null)을 따른다', () => {
    const ok = baselineRequestFromMetrics({ validMs: 300_000, avgPaceSecPerKm: 400, distanceM: 750 }, T0)
    assert.equal(ok.baseline_pace_sec_per_km, 400)
    assert.equal(ok.cadence_spm, null)
    assert.equal('quality_status' in ok, false)
    const short = baselineRequestFromMetrics({ validMs: 60_000, avgPaceSecPerKm: 400, distanceM: 150 }, null)
    assert.equal(short.baseline_pace_sec_per_km, null)
    assert.equal(short.measured_at, null)
    assert.equal(baselineSkippedRequest().skipped, true)
  })
  test('서버 → 화면: null 유지', () => {
    const v = fromBaselineResponse({ user_id: 'u', skipped: true, quality_status: 'no_data', baseline_pace_sec_per_km: null, cadence_spm: null, stride_length_cm: null, valid_duration_ms: null, distance_m: null, measured_at: null })
    assert.equal(v.paceSecPerKm, null)
    assert.equal(v.measuredAt, null)
  })
})

describe('Running 기록 변환', () => {
  test('GPS 기록 → 저장 요청(client_session_id는 호출자가 지정, 지어내지 않는다)', () => {
    const req = toRunCreateRequest(record(), 'client-1')
    assert.ok(req)
    assert.equal(req.client_session_id, 'client-1')
    assert.equal(req.completion, 'goal')
    assert.equal(req.distance_m, 3000)
    assert.equal(req.target_distance_km, 3)
    assert.deepEqual(req.splits, [{ index: 1, distance_m: 1000, duration_ms: 360_000, pace_sec_per_km: 360 }])
    assert.deepEqual(req.gps_gaps, [{ lost_at_ms: 5000, recovered_at_ms: null }])
    assert.deepEqual(req.reflection, { difficulty: 'moderate', reasons: ['legs'], memo: '좋았음' })
    assert.equal('posture_report' in req, false)
    assert.equal('cadence_spm' in req, false)
  })
  test('TIME 기록은 거리·페이스가 null이고 구간이 없다(0 금지)', () => {
    const time = record({ mode: 'time', goal: { targetDistanceKm: null, targetDurationSec: null }, result: { elapsedMs: 600_000, distanceM: null, avgPaceSecPerKm: null, splits: [], completion: 'time', gpsGaps: [] }, reflection: null })
    const req = toRunCreateRequest(time, 'c2')
    assert.ok(req)
    assert.equal(req.mode, 'time')
    assert.equal(req.distance_m, null)
    assert.equal(req.avg_pace_sec_per_km, null)
    assert.deepEqual(req.splits, [])
    assert.equal(req.reflection, null)
    assert.equal(req.target_distance_km, null)
  })
  test('시각이 잘못됐거나 client_session_id가 없으면 요청을 만들지 않는다', () => {
    assert.equal(toRunCreateRequest(record({ startedAt: NaN }), 'c'), null)
    assert.equal(toRunCreateRequest(record(), ''), null)
  })
  test('서버 상세 → 화면 모델: null 보존, TIME이면 거리·페이스 숨김', () => {
    const detail: RunDetailResponse = {
      run_id: 'r1', client_session_id: 'c1', mode: 'time', completion: 'time', started_at: '2026-11-20T09:00:00Z', ended_at: '2026-11-20T09:10:00Z', elapsed_ms: 600_000,
      distance_m: 123, avg_pace_sec_per_km: 300, pace_status: 'no_data', has_posture_report: false, target_distance_km: null, target_duration_sec: null, target_pace_sec_per_km: null,
      cadence_spm: null, cadence_status: 'no_data', step_count: null, target_pace_keep_ratio_pct: null, music_track_id: null, splits: [], gps_gaps: [],
      reflection: { difficulty: null, reasons: [], memo: '' }, posture_report: null,
    }
    const v = fromRunDetail(detail)
    assert.equal(v.distanceM, null)
    assert.equal(v.avgPaceSecPerKm, null)
    assert.equal(v.startedAt, Date.UTC(2026, 10, 20, 9))
    assert.deepEqual(v.reflection, { difficulty: null, reasons: [], memo: '' })
    assert.equal(v.cadenceSpm, null)
  })
  test('목록은 최상위 배열만 읽고, 모양이 다른 응답은 미확정(null), 어긋난 항목은 건너뛴다', () => {
    const item = { run_id: 'r', client_session_id: 'c', mode: 'gps', completion: 'goal', started_at: '2026-11-20T09:00:00Z', ended_at: '2026-11-20T09:30:00Z', elapsed_ms: 1, distance_m: 5, avg_pace_sec_per_km: 6, pace_status: 'valid', has_posture_report: false }
    assert.equal(parseRunList({ items: [item] }), null)
    assert.equal(parseRunList(null), null)
    assert.equal(parseRunList([item, { run_id: 'x' }, 3])?.length, 1)
    assert.deepEqual(parseRunList([]), [])
  })
  test('저장 실패 분류: 어떤 경우에도 로컬 삭제를 요구하지 않는다', () => {
    assert.equal(classifyRunSaveFailure(new NetworkError('x', false)), 'retry')
    assert.equal(classifyRunSaveFailure(new NetworkError('x', true)), 'retry')
    assert.equal(classifyRunSaveFailure(new ApiError(401, 'AUTH_INVALID_TOKEN', 'x')), 'auth')
    assert.equal(classifyRunSaveFailure(new ApiError(503, 'X', 'x')), 'retry')
    assert.equal(classifyRunSaveFailure(new ApiError(429, 'X', 'x')), 'retry')
    assert.equal(classifyRunSaveFailure(new ApiError(422, 'VALIDATION_ERROR', 'x')), 'rejected')
    assert.deepEqual([1, 2, 3, 20, 0, NaN].map(runSaveRetryDelayMs), [2000, 4000, 8000, 300_000, 2000, 2000])
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
    const good = setup(() => ok({ user_id: 'u1' }))
    const data = await good.qc.fetchQuery(apiQueries.profile(good.api))
    assert.equal(data.user_id, 'u1')
    await good.qc.fetchQuery(apiQueries.profile(good.api))
    assert.equal(good.calls.length, 1)

    const bad = setup(() => new Response(JSON.stringify({ status_code: 401, error_code: 'AUTH_MISSING_TOKEN', message: 'x' }), { status: 401 }))
    await assert.rejects(bad.qc.fetchQuery(apiQueries.profile(bad.api)), (e) => e instanceof ApiError && e.isUnauthorized)
    assert.equal(bad.qc.getQueryData(['profile']), undefined)
  })
  test('기록 목록 조회는 날짜 범위를 그대로 query로 전달하고, 응답 형식이 미확정이면 null을 돌려준다', async () => {
    const s = setup(() => ok({ items: [] }))
    const data = await s.qc.fetchQuery(apiQueries.runs(s.api, { from: '2026-11-01', to: '2026-11-30' }))
    assert.equal(data, null)
    assert.ok(s.calls[0].url.includes('from=2026-11-01') && s.calls[0].url.includes('to=2026-11-30'))
    const arr = setup(() => ok([]))
    assert.deepEqual(await arr.qc.fetchQuery(apiQueries.runs(arr.api)), [])
  })
  test('기록 저장 mutation: 성공하면 runs·growth·home 캐시를 무효화하고, 실패하면 무효화하지 않는다', async () => {
    const s = setup(() => ok({ run_id: 'r1' }))
    s.qc.setQueryData(['runs', 'list', null, null], [])
    s.qc.setQueryData(['growth', 'running', 'weekly'], {})
    const opts = apiMutations.createRun(s.api, s.qc)
    const req = toRunCreateRequest(record(), 'c1')
    assert.ok(req)
    await opts.mutationFn(req)
    await opts.onSuccess()
    assert.equal(s.calls[0].method, 'POST')
    assert.equal(s.qc.getQueryState(['runs', 'list', null, null])?.isInvalidated, true)
    assert.equal(s.qc.getQueryState(['growth', 'running', 'weekly'])?.isInvalidated, true)

    const f = setup(() => new Response(JSON.stringify({ status_code: 422, error_code: 'VALIDATION_ERROR', message: 'x' }), { status: 422 }))
    f.qc.setQueryData(['runs', 'list', null, null], [])
    await assert.rejects(apiMutations.createRun(f.api, f.qc).mutationFn(req), ApiError)
    assert.equal(f.qc.getQueryState(['runs', 'list', null, null])?.isInvalidated, false)
  })
  test('회고 수정은 해당 기록 상세만 무효화한다', async () => {
    const s = setup(() => ok({}))
    s.qc.setQueryData(['runs', 'detail', 'r1'], {})
    s.qc.setQueryData(['runs', 'detail', 'r2'], {})
    const opts = apiMutations.updateReflection(s.api, s.qc)
    await opts.mutationFn({ runId: 'r1', reflection: { difficulty: 'easy' } })
    assert.equal(s.calls[0].url, 'https://api.test/api/v1/runs/r1/reflection')
    await opts.onSuccess(null, { runId: 'r1' })
    assert.equal(s.qc.getQueryState(['runs', 'detail', 'r1'])?.isInvalidated, true)
    assert.equal(s.qc.getQueryState(['runs', 'detail', 'r2'])?.isInvalidated, false)
  })
})
