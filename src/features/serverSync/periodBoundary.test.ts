import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildWeeklyGrowth } from '../growth/growthView.ts'
import { getRunWeekdays, getWeekStart } from '../home/homeRecords.ts'
import type { RunRecord } from '../running/types.ts'
import { fromRunningGrowth } from './growthMapper.ts'

// Home/Growth 집계 기준 차이를 고정하는 테스트. 서버 기준은 백엔드 코드를 읽은 결과이며(실서버 검증 아님), 화면의 기존 기간 정책은 바꾸지 않는다.
//  - 서버 Home: 주 시작 = UTC 월요일 0시 (routers/home.py: now - timedelta(days=now.weekday()), UTC)
//  - 서버 Growth: weekly=최근 7일 / monthly=최근 30일 롤링, UTC, 버킷 1개 (routers/growth.py)
//  - 화면(로컬): 기기 시간대의 달력 기준 월~일 주
// 두 기준을 임의로 통일하지 않으므로, 어긋나는 경계 시각을 그대로 드러낸다.

function withTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

const serverHomeWeekStartUtc = (now: Date): number => {
  const weekday = (now.getUTCDay() + 6) % 7 // Python weekday(): 월=0
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday)
}
const serverGrowthWindowStart = (now: Date, period: 'weekly' | 'monthly'): number => now.getTime() - (period === 'weekly' ? 7 : 30) * 86_400_000

const run = (startedAt: number, id = String(startedAt)): RunRecord =>
  ({
    recordId: `rec-${id}`, sessionId: id, mode: 'gps', startedAt, endedAt: startedAt + 1_800_000,
    goal: { targetDistanceKm: 3, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
    result: { elapsedMs: 1_800_000, distanceM: 3000, avgPaceSecPerKm: 360, completion: 'goal', splits: [], gpsGaps: [] },
  }) as RunRecord

const inServerHomeWeek = (r: RunRecord, now: Date) => r.startedAt >= serverHomeWeekStartUtc(now) && r.startedAt <= now.getTime()
const inLocalWeek = (r: RunRecord, now: Date) => getRunWeekdays([r], now).some(Boolean)

describe('시간대 환경 확인', () => {
  test('테스트가 시간대를 실제로 바꾼다(KST=UTC+9)', () => {
    assert.equal(withTz('Asia/Seoul', () => new Date(Date.UTC(2026, 10, 22, 16)).getHours()), 1)
    assert.equal(withTz('UTC', () => new Date(Date.UTC(2026, 10, 22, 16)).getHours()), 16)
  })
})

describe('Home 주 경계: 서버(UTC 월요일) ↔ 화면(기기 시간대 월요일)', () => {
  test('KST 월요일 새벽(UTC로는 아직 일요일): 서버는 지난주 기록을 이번 주로 세지만 화면은 세지 않는다', () => {
    withTz('Asia/Seoul', () => {
      const now = new Date(Date.UTC(2026, 10, 22, 16, 0)) // 일 16:00Z = 월 01:00 KST
      const lastFriday = run(Date.UTC(2026, 10, 20, 0, 0))
      assert.equal(getWeekStart(now).getTime(), Date.UTC(2026, 10, 22, 15, 0)) // 화면 주 시작: 월 00:00 KST
      assert.equal(serverHomeWeekStartUtc(now), Date.UTC(2026, 10, 16, 0, 0)) // 서버 주 시작: 지난 월요일 00:00Z
      assert.equal(inServerHomeWeek(lastFriday, now), true)
      assert.equal(inLocalWeek(lastFriday, now), false)
    })
  })
  test('KST 월요일 오전(UTC로는 이미 월요일): 서버는 KST 월요일 새벽 기록을 지난주로, 화면은 이번 주로 센다', () => {
    withTz('Asia/Seoul', () => {
      const now = new Date(Date.UTC(2026, 10, 23, 10, 0)) // 월 10:00Z = 월 19:00 KST
      const mondayDawnKst = run(Date.UTC(2026, 10, 22, 20, 0)) // 월 05:00 KST = 일 20:00Z
      assert.equal(inServerHomeWeek(mondayDawnKst, now), false)
      assert.equal(inLocalWeek(mondayDawnKst, now), true)
    })
  })
  test('시간대가 UTC인 기기에서는 두 기준이 같다(차이는 시간대에서만 생긴다)', () => {
    withTz('UTC', () => {
      for (const iso of ['2026-11-22T16:00:00Z', '2026-11-23T10:00:00Z', '2026-11-23T00:00:00Z', '2026-11-22T23:59:59Z']) {
        const now = new Date(iso)
        assert.equal(getWeekStart(now).getTime(), serverHomeWeekStartUtc(now), iso)
      }
    })
  })
  test('요일 판정은 로컬 기준이라 서버 응답의 요일과 임의로 섞지 않는다(화면 요일 행은 로컬 기록만 쓴다)', () => {
    withTz('Asia/Seoul', () => {
      const now = new Date(Date.UTC(2026, 10, 23, 10, 0))
      const days = getRunWeekdays([run(Date.UTC(2026, 10, 22, 20, 0))], now) // 월 05:00 KST
      assert.deepEqual(days, [true, false, false, false, false, false, false])
    })
  })
})

describe('Growth 기간: 서버(최근 7일/30일 롤링) ↔ 화면(달력 주)', () => {
  test('KST 월요일 새벽에 서버 weekly는 4일 전 기록을 포함하지만 화면의 이번 주 성장에는 없다', () => {
    withTz('Asia/Seoul', () => {
      const now = new Date(Date.UTC(2026, 10, 22, 16, 0))
      const r = run(Date.UTC(2026, 10, 19, 0, 0))
      assert.ok(r.startedAt >= serverGrowthWindowStart(now, 'weekly'))
      assert.equal(buildWeeklyGrowth([r], now), null)
    })
  })
  test('7일 + 1분 전 기록은 서버 weekly에서 빠지고, 30일 monthly에는 남는다', () => {
    const now = new Date(Date.UTC(2026, 10, 24, 0, 0))
    const r = run(now.getTime() - 7 * 86_400_000 - 60_000)
    assert.ok(r.startedAt < serverGrowthWindowStart(now, 'weekly'))
    assert.ok(r.startedAt >= serverGrowthWindowStart(now, 'monthly'))
  })
  test('서버 Growth 응답은 해석하지 않고 그대로 중간 모델로만 옮긴다(기간 경계·시간대를 추정하지 않는다)', () => {
    const view = fromRunningGrowth({
      period: 'weekly', status: 'valid',
      buckets: [{ period_start: '2026-11-17T00:00:00Z', period_end: '2026-11-24T00:00:00Z', run_count: 2, goal_completed_count: 1, total_distance_m: 5000, total_elapsed_ms: 1000, avg_pace_sec_per_km: 300, pace_status: 'valid', difficulty_counts: { easy: 1 } }],
    } as never)
    assert.equal(view.buckets.length, 1) // 서버는 일/주별 시계열이 아니라 버킷 하나만 준다
    assert.equal(view.buckets[0].periodStart, '2026-11-17T00:00:00Z') // 문자열 그대로
  })
  test('서버 통계는 아직 어떤 화면에도 연결되지 않았다(같은 화면에서 서로 다른 기간의 수치가 섞이지 않는다)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join, relative } = await import('node:path')
    const root = new URL('../../', import.meta.url).pathname
    const users: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && /growthMapper|fromRunningGrowth|fromPostureGrowth|growth\.running|growth\.posture|home\.getSummary/.test(readFileSync(full, 'utf8'))) users.push(relative(root, full))
      }
    }
    walk(root)
    assert.deepEqual(users.sort(), ['features/serverSync/growthMapper.ts', 'features/serverSync/queries.ts'])
  })
})
