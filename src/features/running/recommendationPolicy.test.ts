import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStagePacePlan,
  calculateRecommended3KmGoal,
  computeRecentRecordsPace,
  getOnboardingInitialPaceSec,
  getRecencyWeight,
  roundPaceTo5Sec,
} from './recommendationPolicy.ts'
import type { RunRecord } from './types.ts'

const DAY_MS = 86_400_000
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0)

function makeGpsRecord(
  over: {
    daysAgo?: number
    distanceM?: number | null
    avgPaceSecPerKm?: number | null
    completion?: 'goal' | 'partial' | 'time'
    mode?: 'gps' | 'time'
  } = {},
): RunRecord {
  const startedAt = T0 - (over.daysAgo ?? 1) * DAY_MS
  const mode = over.mode ?? 'gps'
  return {
    recordId: `rec-${Math.random()}`,
    sessionId: `sess-${Math.random()}`,
    mode,
    startedAt,
    endedAt: startedAt + 1_260_000,
    goal: { targetDistanceKm: 3, targetDurationSec: 1260 },
    musicTrackId: null,
    result: {
      elapsedMs: 1_260_000,
      distanceM: over.distanceM !== undefined ? over.distanceM : 3000,
      avgPaceSecPerKm: over.avgPaceSecPerKm !== undefined ? over.avgPaceSecPerKm : 420,
      splits: [],
      completion: over.completion ?? 'goal',
      gpsGaps: [],
    },
    reflection: null,
    sensorReport: null,
  }
}

describe('온보딩 첫 목표 9가지 조합 및 구간별 표시 페이스 (PDF 2절 표 대조)', () => {
  test('경험 수준 × 주간 횟수 9가지 조합의 기준 페이스·3km 시간·구간 5초 반올림이 명세 표와 일치한다', () => {
    const cases = [
      { exp: 'beginner' as const, runs: '1' as const, pace: 480, dur: 1440, warmup: 505, rhythm: 475, realtime: 455 }, // 8:00, 24:00, 8:25, 7:55, 7:35
      { exp: 'beginner' as const, runs: '2' as const, pace: 465, dur: 1395, warmup: 490, rhythm: 460, realtime: 440 }, // 7:45, 23:15, 8:10, 7:40, 7:20
      { exp: 'beginner' as const, runs: '3+' as const, pace: 450, dur: 1350, warmup: 475, rhythm: 445, realtime: 430 }, // 7:30, 22:30, 7:55, 7:25, 7:10
      { exp: 'occasional' as const, runs: '1' as const, pace: 435, dur: 1305, warmup: 455, rhythm: 430, realtime: 415 }, // 7:15, 21:45, 7:35, 7:10, 6:55
      { exp: 'occasional' as const, runs: '2' as const, pace: 420, dur: 1260, warmup: 440, rhythm: 415, realtime: 400 }, // 7:00, 21:00, 7:20, 6:55, 6:40
      { exp: 'occasional' as const, runs: '3+' as const, pace: 405, dur: 1215, warmup: 425, rhythm: 400, realtime: 385 }, // 6:45, 20:15, 7:05, 6:40, 6:25
      { exp: 'regular' as const, runs: '1' as const, pace: 405, dur: 1215, warmup: 425, rhythm: 400, realtime: 385 }, // 6:45, 20:15, 7:05, 6:40, 6:25
      { exp: 'regular' as const, runs: '2' as const, pace: 390, dur: 1170, warmup: 410, rhythm: 385, realtime: 370 }, // 6:30, 19:30, 6:50, 6:25, 6:10
      { exp: 'regular' as const, runs: '3+' as const, pace: 375, dur: 1125, warmup: 395, rhythm: 370, realtime: 355 }, // 6:15, 18:45, 6:35, 6:10, 5:55
    ]

    for (const c of cases) {
      assert.equal(getOnboardingInitialPaceSec(c.exp, c.runs), c.pace)
      const rec = calculateRecommended3KmGoal({ experienceLevel: c.exp, weeklyRuns: c.runs, nowMs: T0 })
      assert.equal(rec.basis, 'onboarding')
      assert.equal(rec.distanceKm, 3)
      assert.equal(rec.targetDurationSec, c.dur)
      assert.equal(rec.displayPaceSecPerKm, c.pace)
      assert.equal(rec.stages.warmupPaceSecPerKm, c.warmup)
      assert.equal(rec.stages.rhythmPaceSecPerKm, c.rhythm)
      assert.equal(rec.stages.realtimeInitialPaceSecPerKm, c.realtime)
    }
  })
})

describe('추천 기준 4단계 적용 순서 (PDF 1절 & 5절)', () => {
  test('아무 정보도 없으면 기본값 7:00/km (420초, 3km 21:00)', () => {
    const rec = calculateRecommended3KmGoal({ nowMs: T0 })
    assert.equal(rec.basis, 'default_starter')
    assert.equal(rec.targetPaceSecPerKm, 420)
    assert.equal(rec.targetDurationSec, 1260)
  })

  test('기초 측정 완료 & 실제 기록 3개 미만: 기준 페이스 100%를 쓰고 온보딩 응답을 중복 반영하지 않는다', () => {
    const rec = calculateRecommended3KmGoal({
      experienceLevel: 'beginner',
      weeklyRuns: '1', // 480초이지만 기초 측정이 있으면 무시되어야 함
      baselinePaceSecPerKm: 400,
      records: [makeGpsRecord({ avgPaceSecPerKm: 360 }), makeGpsRecord({ avgPaceSecPerKm: 360 })], // 2개뿐
      nowMs: T0,
    })
    assert.equal(rec.basis, 'baseline')
    assert.equal(rec.targetPaceSecPerKm, 400)
    assert.equal(rec.targetDurationSec, 1200)
  })

  test('실제 유효 러닝 3개 이상: 최근 기록 가중 페이스 60% + 기준 페이스 40%', () => {
    const records = [
      makeGpsRecord({ daysAgo: 2, avgPaceSecPerKm: 400, completion: 'goal' }), // 가중치 1.0 * 1.0 = 1.0
      makeGpsRecord({ daysAgo: 10, avgPaceSecPerKm: 420, completion: 'goal' }), // 가중치 0.8 * 1.0 = 0.8
      makeGpsRecord({ daysAgo: 20, avgPaceSecPerKm: 440, completion: 'partial' }), // 가중치 0.6 * 0.5 = 0.3
    ]
    // 가중 평균 = (400*1.0 + 420*0.8 + 440*0.3) / (1.0 + 0.8 + 0.3) = 868 / 2.1 = 413.333...
    // 기준 페이스 450초: 413.333... * 0.6 + 450 * 0.4 = 248 + 180 = 428초
    const rec = calculateRecommended3KmGoal({
      experienceLevel: 'beginner',
      weeklyRuns: '1',
      baselinePaceSecPerKm: 450,
      records,
      nowMs: T0,
    })
    assert.equal(rec.basis, 'recent_runs')
    assert.equal(rec.targetPaceSecPerKm, 428)
    assert.equal(rec.displayPaceSecPerKm, 430) // 5초 단위 반올림
    assert.equal(rec.targetDurationSec, 1284)
  })

  test('최근 기록 필터: 28일 초과, 1km 미만, 4:00/km 미만(239초), 10:00/km 초과(601초), TIME 모드는 제외한다', () => {
    const records = [
      makeGpsRecord({ daysAgo: 29, avgPaceSecPerKm: 400 }), // 28일 초과 제외
      makeGpsRecord({ daysAgo: 2, distanceM: 999, avgPaceSecPerKm: 400 }), // 1km 미만 제외
      makeGpsRecord({ daysAgo: 2, avgPaceSecPerKm: 239 }), // 4:00 미만 제외
      makeGpsRecord({ daysAgo: 2, avgPaceSecPerKm: 601 }), // 10:00 초과 제외
      makeGpsRecord({ daysAgo: 2, mode: 'time', completion: 'time', distanceM: null, avgPaceSecPerKm: null }), // TIME 제외
      makeGpsRecord({ daysAgo: 3, distanceM: 1000, avgPaceSecPerKm: 240 }), // 경계값 포함 (유효 1)
      makeGpsRecord({ daysAgo: 25, distanceM: 3000, avgPaceSecPerKm: 600 }), // 경계값 포함 (유효 2, 22~28일 가중치 0.4)
    ]
    const res = computeRecentRecordsPace(records, T0)
    assert.equal(res.validRecordCount, 2)
    assert.equal(getRecencyWeight(T0 - 25 * DAY_MS, T0), 0.4)
    assert.equal(roundPaceTo5Sec(416), 415)
    assert.equal(buildStagePacePlan(420).warmupPaceSecPerKm, 440)
  })
})
