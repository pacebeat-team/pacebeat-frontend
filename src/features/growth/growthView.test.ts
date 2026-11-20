import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDistanceKm2 } from '../running/format.ts'
import { totalDistanceM } from '../running/recordQueries.ts'
import type { RunRecord } from '../running/types.ts'
import {
  buildMonthlyGrowth,
  buildWeeklyGrowth,
  formatSummaryDistance,
  getVisibleRecords,
  achievementPercent,
  buildChartGuides,
  buildFirstRecord,
  buildPaceCompare,
  getGrowthState,
} from './growthView.ts'

const NOW = new Date(2026, 9, 22, 12) // 2026-10-22(목). 10월 1일은 목요일 → 1주=1~4일, 2주=5~11, 3주=12~18, 4주=19~25
const at = (month: number, day: number, hour = 7) => new Date(2026, month - 1, day, hour).getTime()

let seq = 0
function rec(startedAt: number, over: { km?: number | null; completion?: 'goal' | 'partial' | 'time'; target?: 1 | 3 | 5 | null; pace?: number | null } = {}): RunRecord {
  seq += 1
  const completion = over.completion ?? 'goal'
  const distanceM = completion === 'time' ? null : over.km === undefined ? 3000 : over.km === null ? null : over.km * 1000
  return {
    recordId: `r${seq}`,
    sessionId: `s${seq}`,
    mode: completion === 'time' ? 'time' : 'gps',
    startedAt,
    endedAt: startedAt + 1_200_000,
    goal: { targetDistanceKm: completion === 'time' ? null : (over.target ?? 3), targetDurationSec: null },
    musicTrackId: null,
    result: {
      elapsedMs: 1_200_000,
      distanceM,
      avgPaceSecPerKm: completion === 'time' ? null : over.pace === undefined ? 400 : over.pace,
      splits: [],
      completion,
      gpsGaps: [],
    },
    reflection: null,
    sensorReport: null,
  }
}

test('상태: 0개 empty, 1개 first, 그 이상 ready, 미래 기록은 세지 않는다', () => {
  assert.equal(getGrowthState([], NOW), 'empty')
  assert.equal(getGrowthState([rec(at(10, 1))], NOW), 'first')
  assert.equal(getGrowthState([rec(at(10, 1)), rec(at(10, 2))], NOW), 'ready')
  assert.equal(getGrowthState([rec(at(10, 30))], NOW), 'empty')
  assert.equal(getGrowthState([rec(at(10, 1)), rec(at(10, 30))], NOW), 'first')
})

test('눈금: 5km 단위, 최소 0·5·10·15, 큰 값은 3칸으로 나눈다', () => {
  assert.deepEqual(buildChartGuides(0), [0, 5, 10, 15])
  assert.deepEqual(buildChartGuides(8.6), [0, 5, 10, 15])
  assert.deepEqual(buildChartGuides(15), [0, 5, 10, 15])
  assert.deepEqual(buildChartGuides(15.1), [0, 10, 20, 30])
  assert.deepEqual(buildChartGuides(40), [0, 15, 30, 45])
})

test('목표 달성률: 완주 ÷ 전체 러닝(TIME 포함), 반올림, 없으면 null', () => {
  assert.equal(achievementPercent([]), null)
  const six = Array.from({ length: 6 }, (_, i) => rec(at(10, 1 + i)))
  const two = [rec(at(10, 8), { completion: 'partial', km: 1 }), rec(at(10, 9), { completion: 'time' })]
  assert.equal(achievementPercent([...six, ...two]), 75)
  assert.equal(achievementPercent([rec(at(10, 1)), rec(at(10, 2), { completion: 'partial', km: 1 }), rec(at(10, 3), { completion: 'time' })]), 33)
})

test('월간: 주차별 합계·이번 주까지·누적 거리·횟수·달성률', () => {
  const records = [
    rec(at(10, 2), { km: 4.1 }), // 1주
    rec(at(10, 6), { km: 3.1 }), // 2주
    rec(at(10, 13), { km: 3 }), // 3주
    rec(at(10, 15), { km: 5.5, completion: 'partial' }), // 3주
    rec(at(10, 20), { km: 8.6 }), // 4주 = 이번 주
    rec(at(10, 21), { completion: 'time' }), // 4주, 거리 없음
    rec(at(9, 30), { km: 10 }), // 지난달(제외)
    rec(at(10, 29), { km: 9 }), // 미래(제외)
  ]
  const view = buildMonthlyGrowth(records, NOW)
  assert.ok(view)
  assert.equal(view.titleText, '2026년 10월')
  assert.equal(view.distanceText, '24.3')
  assert.equal(view.runCount, 6)
  assert.equal(view.achievementPercent, 67)
  assert.deepEqual(view.chart.guides, [0, 5, 10, 15])
  assert.deepEqual(
    view.chart.bars.map((bar) => [bar.label, bar.valueText, bar.highlight]),
    [['1주', '4.1', false], ['2주', '3.1', false], ['3주', '8.5', false], ['이번 주', '8.6', true]],
  )
  assert.equal(view.chart.bars[3].ratio, 8.6 / 15)
})

test('월간: 이번 달 기록이 없으면 null이고, 거리가 없는 주는 막대와 값을 만들지 않는다', () => {
  assert.equal(buildMonthlyGrowth([rec(at(9, 30))], NOW), null)
  const view = buildMonthlyGrowth([rec(at(10, 20), { km: 2 })], NOW)
  assert.ok(view)
  assert.deepEqual(view.chart.bars.map((bar) => [bar.label, bar.valueText, bar.ratio]), [
    ['1주', null, 0],
    ['2주', null, 0],
    ['3주', null, 0],
    ['이번 주', '2', 2 / 15],
  ])
})

test('월간: 같은 날짜 규칙(자정 경계·월 첫날)을 쓰고 요약과 같은 숫자를 낸다', () => {
  const records = [rec(new Date(2026, 9, 1, 0, 0).getTime(), { km: 2.13 }), rec(new Date(2026, 8, 30, 23, 59).getTime(), { km: 9 })]
  const view = buildMonthlyGrowth(records, NOW)
  assert.ok(view)
  assert.equal(view.runCount, 1)
  assert.equal(view.distanceText, '2.13')
  const month = records.slice(0, 1)
  assert.equal(view.distanceText, formatSummaryDistance(totalDistanceM(getVisibleRecords(month, NOW))))
})

test('주간: 월요일 시작 이번 주만, 러닝별 막대, 거리 없는 러닝은 값 없이 둔다', () => {
  const records = [
    rec(at(10, 19), { km: 4.1 }), // 월
    rec(at(10, 21), { km: 4.5 }), // 수
    rec(at(10, 18, 23), { km: 7 }), // 일요일(지난 주)
    rec(at(10, 22, 6), { completion: 'time' }), // 목, 오늘
  ]
  const view = buildWeeklyGrowth(records, NOW)
  assert.ok(view)
  assert.equal(view.runCount, 3)
  assert.equal(view.distanceText, '8.6')
  assert.deepEqual(view.chart.bars.map((bar) => [bar.label, bar.valueText]), [['첫 러닝', '4.1'], ['두 번째', '4.5'], ['세 번째', null]])
  assert.equal(buildWeeklyGrowth([rec(at(10, 12))], NOW), null)
})

test('페이스 비교: 3 km 완주끼리 이전 → 최근, 단축은 빨라졌을 때만', () => {
  const records = [
    rec(at(9, 10), { pace: 450 }),
    rec(at(10, 1), { pace: 424 }),
    rec(at(10, 5), { target: 5, km: 5, pace: 300 }), // 다른 거리는 제외
    rec(at(10, 6), { completion: 'partial', km: 2, pace: 380 }), // 완주 아님
    rec(at(10, 29), { pace: 350 }), // 미래
  ]
  assert.deepEqual(buildPaceCompare(records, NOW), { latestText: '7:04', previousText: '7:30', savedText: '26초 단축' })
  assert.deepEqual(buildPaceCompare([rec(at(10, 1), { pace: 424 })], NOW), { latestText: '7:04', previousText: null, savedText: null })
  assert.deepEqual(buildPaceCompare([rec(at(10, 1), { pace: 400 }), rec(at(10, 2), { pace: 410 })], NOW), {
    latestText: '6:50',
    previousText: '6:40',
    savedText: null,
  })
  assert.equal(buildPaceCompare([rec(at(10, 1), { target: 1, km: 1 })], NOW), null)
})

test('첫 기록: 기록이 정확히 하나일 때만, TIME이면 거리 없음', () => {
  assert.deepEqual(buildFirstRecord([rec(at(10, 9), { km: 2.1, completion: 'partial' })], NOW), { distanceText: '2.1', dateText: '10월 9일' })
  assert.deepEqual(buildFirstRecord([rec(at(10, 9), { completion: 'time' })], NOW), { distanceText: null, dateText: '10월 9일' })
  assert.equal(buildFirstRecord([], NOW), null)
  assert.equal(buildFirstRecord([rec(at(10, 9)), rec(at(10, 10))], NOW), null)
})

test('거리가 있는 기록이 없으면 누적 거리는 0이 아니라 null이다', () => {
  const timeOnly = [rec(at(10, 20), { completion: 'time' })]
  assert.equal(buildMonthlyGrowth(timeOnly, NOW)?.distanceText, null)
  assert.equal(buildWeeklyGrowth(timeOnly, NOW)?.distanceText, null)
})

test('주간: 러닝이 5회 이상이면 막대 이름은 숫자', () => {
  const records = [19, 19, 20, 20, 21].map((d, i) => rec(at(10, d, 6 + i)))
  assert.deepEqual(buildWeeklyGrowth(records, NOW)?.chart.bars.map((bar) => bar.label), ['1', '2', '3', '4', '5'])
})

test('페이스 단축: 소수 페이스는 표시 초(반올림)끼리 뺀다', () => {
  const records = [rec(at(10, 1), { pace: 450.4 }), rec(at(10, 2), { pace: 424.6 })]
  assert.deepEqual(buildPaceCompare(records, NOW), { latestText: '7:05', previousText: '7:30', savedText: '25초 단축' })
})

test('월간: 1일이 일요일인 달은 첫 주가 하루뿐이다', () => {
  const now = new Date(2026, 10, 10, 12) // 2026-11-01은 일요일
  const records = [rec(new Date(2026, 10, 1, 7).getTime(), { km: 2 }), rec(new Date(2026, 10, 2, 7).getTime(), { km: 3 })]
  const view = buildMonthlyGrowth(records, now)
  assert.deepEqual(view?.chart.bars.map((bar) => [bar.label, bar.valueText]), [['1주', '2'], ['2주', '3'], ['이번 주', null]])
})

// 기록 화면(features/records/recordsView.ts, 이 브랜치에는 없음)의 원래 구현을 그대로 옮긴 기준 구현이다.
// 로컬 helper가 같은 결과를 내는지 확인한다.
function referenceVisible(records: readonly RunRecord[], now: Date): RunRecord[] {
  return records.filter((record) => record.startedAt <= now.getTime())
}
function referenceSummaryDistance(distanceM: number): string {
  const text = formatDistanceKm2(distanceM)
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

test('helper: formatSummaryDistance는 기록 화면의 요약 거리와 같은 결과다', () => {
  const samples = [0, 1, 9, 10, 99, 100, 999, 1000, 1005, 1010, 1099, 2130, 2999.9, 3000, 12345, 24300, 24000, 24999, 100000, 123456.789, 5e5]
  for (const meters of samples) assert.equal(formatSummaryDistance(meters), referenceSummaryDistance(meters), String(meters))
  assert.equal(formatSummaryDistance(0), '0')
  assert.equal(formatSummaryDistance(24300), '24.3')
  assert.equal(formatSummaryDistance(24000), '24')
})

test('helper: getVisibleRecords는 기록 화면과 같이 지금보다 늦게 시작한 기록만 뺀다', () => {
  const records = [rec(at(10, 21)), rec(at(10, 22, 12)), rec(at(10, 22, 13)), rec(at(11, 3))]
  assert.deepEqual(getVisibleRecords(records, NOW), referenceVisible(records, NOW))
  assert.equal(getVisibleRecords(records, NOW).length, 2)
  assert.deepEqual(getVisibleRecords([], NOW), [])
})
