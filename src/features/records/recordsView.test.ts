import assert from 'node:assert/strict'
import test from 'node:test'
import type { RunRecord } from '../running/types.ts'
import {
  buildCalendar,
  buildRecordRow,
  buildRecordRows,
  buildRecordsSummary,
  countMonthRuns,
  formatSummaryDistance,
  getVisibleRecords,
} from './recordsView.ts'

const NOW = new Date(2026, 9, 24, 12, 0, 0) // 2026-10-24 (토)

function rec(
  id: string,
  at: Date,
  completion: 'goal' | 'partial' | 'time',
  distanceM: number | null = completion === 'time' ? null : 3000,
  extra: Partial<RunRecord['result']> = {},
): RunRecord {
  const startedAt = at.getTime()
  return {
    recordId: id,
    sessionId: `s-${id}`,
    mode: completion === 'time' ? 'time' : 'gps',
    startedAt,
    endedAt: startedAt + 1_800_000,
    goal: { targetDistanceKm: null, targetDurationSec: null },
    musicTrackId: null,
    result: {
      elapsedMs: 1_800_000,
      distanceM,
      avgPaceSecPerKm: distanceM === null ? null : 424,
      splits: [],
      completion,
      gpsGaps: [],
      ...extra,
    },
    reflection: null,
    sensorReport: null,
  }
}

type Cal = ReturnType<typeof buildCalendar>
const findDay = (cal: Cal, n: number) => cal.weeks.flat().find((d) => d?.day === n)

test('formatSummaryDistance: 소수 둘째 자리 버림 뒤 끝의 0을 뗀다', () => {
  assert.equal(formatSummaryDistance(24300), '24.3')
  assert.equal(formatSummaryDistance(24000), '24')
  assert.equal(formatSummaryDistance(0), '0')
  assert.equal(formatSummaryDistance(1429), '1.42')
  assert.equal(formatSummaryDistance(10005), '10')
})

test('요약: 이번 달은 TIME 포함, 누적 거리는 TIME 제외, 거리 완주는 전체 goal', () => {
  const records = [
    rec('a', new Date(2026, 9, 1), 'goal', 3000),
    rec('b', new Date(2026, 9, 2), 'partial', 1500),
    rec('c', new Date(2026, 9, 3), 'time'),
    rec('d', new Date(2026, 8, 20), 'goal', 5000), // 지난달
  ]
  const summary = buildRecordsSummary(records, NOW)
  assert.equal(summary.monthCount, 3)
  assert.equal(summary.distanceText, '9.5')
  assert.equal(summary.completeCount, 2)
})

test('요약: 기록이 없으면 0 / 0 / 0', () => {
  assert.deepEqual(buildRecordsSummary([], NOW), { monthCount: 0, distanceText: '0', completeCount: 0 })
})

test('미래에 시작한 기록은 어디에도 세지 않는다', () => {
  const future = rec('f', new Date(2026, 9, 30), 'goal', 3000)
  assert.deepEqual(getVisibleRecords([future], NOW), [])
  assert.equal(countMonthRuns([future], NOW), 0)
  assert.equal(buildRecordRows([future], NOW, false).length, 0)
  assert.equal(buildCalendar([future], NOW).weeks.flat().every((d) => d === null || d.marker === null), true)
})

test('달력: 월요일 시작, 2026년 10월은 목요일에 1일이 놓인다', () => {
  const calendar = buildCalendar([], NOW)
  assert.equal(calendar.title, '2026년 10월')
  assert.equal(calendar.weeks.length, 5)
  assert.equal(calendar.weeks.every((week) => week.length === 7), true)
  assert.deepEqual(calendar.weeks[0].map((d) => d?.day ?? null), [null, null, null, 1, 2, 3, 4])
  assert.equal(calendar.weeks[4][5]?.day, 31)
  assert.equal(calendar.weeks[4][6], null)
})

test('달력: 오늘만 isToday', () => {
  const days = buildCalendar([], NOW).weeks.flat().filter((d) => d !== null)
  assert.deepEqual(days.filter((d) => d.isToday).map((d) => d.day), [24])
})

test('달력: 같은 날 여러 기록이면 완주 → 일부 → 시간 우선', () => {
  const day = (h: number) => new Date(2026, 9, 5, h)
  const mixed = buildCalendar([rec('1', day(7), 'time'), rec('2', day(8), 'partial', 800), rec('3', day(9), 'goal')], NOW)
  assert.equal(findDay(mixed, 5)?.marker, 'full')
  const noGoal = buildCalendar([rec('1', day(7), 'time'), rec('2', day(8), 'partial', 800)], NOW)
  assert.equal(findDay(noGoal, 5)?.marker, 'partial')
  assert.equal(findDay(buildCalendar([rec('1', day(7), 'time')], NOW), 5)?.marker, 'time')
  assert.equal(findDay(buildCalendar([], NOW), 5)?.marker, null)
})

test('달력: 하루에 기록이 여러 개면 가장 늦게 끝난 기록으로 연결한다', () => {
  const a = rec('early', new Date(2026, 9, 5, 7), 'goal', 3000)
  const b = rec('late', new Date(2026, 9, 5, 19), 'partial', 500)
  assert.equal(findDay(buildCalendar([a, b], NOW), 5)?.recordId, 'late')
  assert.equal(findDay(buildCalendar([a, b], NOW), 6)?.recordId, null)
})

test('달력: 로컬 날짜(자정 직전·직후)로 센다', () => {
  const late = rec('l', new Date(2026, 9, 6, 23, 59), 'goal', 3000)
  const early = rec('e', new Date(2026, 9, 7, 0, 1), 'partial', 500)
  const cal = buildCalendar([late, early], NOW)
  assert.equal(findDay(cal, 6)?.marker, 'full')
  assert.equal(findDay(cal, 7)?.marker, 'partial')
})

test('달력: 지난달 기록은 이번 달 달력에 나타나지 않는다', () => {
  const cal = buildCalendar([rec('o', new Date(2026, 8, 30), 'goal', 3000)], NOW)
  assert.equal(cal.weeks.flat().every((d) => d === null || d.marker === null), true)
})

test('달력: 2월 28/29일·6주 달', () => {
  assert.equal(buildCalendar([], new Date(2026, 1, 10)).weeks.flat().filter((d) => d).length, 28)
  assert.equal(buildCalendar([], new Date(2028, 1, 10)).weeks.flat().filter((d) => d).length, 29)
  assert.equal(buildCalendar([], new Date(2026, 2, 10)).weeks.length, 6) // 2026-03-01은 일요일
})

test('행: 거리 완주·일부·TIME 표시', () => {
  const full = buildRecordRow(rec('a', new Date(2026, 9, 23, 7), 'goal', 4500, { elapsedMs: 1_908_000, avgPaceSecPerKm: 424 }))
  assert.deepEqual(
    [full.dateText, full.weekdayText, full.mainText, full.detailText, full.statusText],
    ['10.23', '금요일', '4.50 km', '31:48 · 7:04/km', '거리 완주'],
  )
  const partial = buildRecordRow(rec('b', new Date(2026, 9, 20, 7), 'partial', 1429))
  assert.equal(partial.mainText, '1.42 km')
  assert.equal(partial.statusText, '목표 전 종료')
  assert.equal(partial.weekdayText, '화요일')
  const time = buildRecordRow(rec('c', new Date(2026, 9, 18, 7), 'time', null, { elapsedMs: 591_000 }))
  assert.equal(time.mainText, '09:51')
  assert.equal(time.detailText, null)
  assert.equal(time.statusText, '시간 기록')
})

test('행: 페이스가 없으면 값을 만들지 않고 —', () => {
  const row = buildRecordRow(rec('p', new Date(2026, 9, 3), 'partial', 100, { avgPaceSecPerKm: null }))
  assert.equal(row.detailText, '30:00 · —/km')
})

test('행: 최신순 정렬, monthOnly는 이번 달만', () => {
  const records = [
    rec('old', new Date(2026, 8, 1), 'goal', 3000),
    rec('mid', new Date(2026, 9, 3), 'goal', 3000),
    rec('new', new Date(2026, 9, 20), 'goal', 3000),
  ]
  assert.deepEqual(buildRecordRows(records, NOW, false).map((r) => r.recordId), ['new', 'mid', 'old'])
  assert.deepEqual(buildRecordRows(records, NOW, true).map((r) => r.recordId), ['new', 'mid'])
})
