import { formatClock, formatDistanceKm2 } from '../running/format.ts'
import { sortNewestFirst } from '../running/recordQueries.ts'
import type { RunRecord } from '../running/types.ts'
import { getWeekdayIndex } from './homeView.ts'

// 저장된 러닝 기록 → Home 표시값 (순수 함수). 기록을 읽는 것은 화면의 몫이다.
// 요일 규칙: 월요일 시작, 기기 로컬 시간대, 기록의 startedAt 기준. TIME 기록도 달린 요일에 포함한다.

// now가 속한 주의 월요일 0시(로컬)
export function getWeekStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - getWeekdayIndex(now))
}

// 이번 주(월~일, 로컬)에 시작한 기록이 있는 요일. 월요일 = 0. 지금보다 늦게 시작한 기록(시계 오류 등)은 세지 않는다.
export function getRunWeekdays(records: readonly RunRecord[], now: Date): boolean[] {
  const start = getWeekStart(now)
  const startMs = start.getTime()
  // 일광 절약 시간 전환 주에도 맞도록 달력 날짜로 다음 주 월요일을 구한다.
  const endMs = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7).getTime()
  const days = Array.from({ length: 7 }, () => false)
  for (const record of records) {
    const startedAt = record.startedAt
    if (startedAt < startMs || startedAt >= endMs || startedAt > now.getTime()) continue
    days[getWeekdayIndex(new Date(startedAt))] = true
  }
  return days
}

// 가장 최근 기록(endedAt 기준). 없으면 null
export function getLatestRecord(records: readonly RunRecord[]): RunRecord | null {
  return sortNewestFirst(records)[0] ?? null
}

// "지난 러닝" 행의 값. 완주 "3.00 km · 거리 완주" / 부분 "1.42 km · 목표 전 종료" / TIME "09:51 · 시간 기록"
// 거리는 결과 화면과 같이 소수 둘째 자리 버림이다. 거리 기록이어야 하는데 거리가 없으면(손상) null이다.
export function buildLastRunText(record: RunRecord): string | null {
  const { completion, distanceM, elapsedMs } = record.result
  if (completion === 'time') return `${formatClock(elapsedMs)} · 시간 기록`
  if (distanceM === null) return null
  const distance = `${formatDistanceKm2(distanceM)} km`
  return completion === 'goal' ? `${distance} · 거리 완주` : `${distance} · 목표 전 종료`
}

export interface HomeRecordsView {
  // 월요일부터 7칸. 이번 주에 달린 요일
  readonly runDays: readonly boolean[]
  // 지난 러닝 행의 값. 기록이 없으면 null(행을 숨긴다)
  readonly lastRunText: string | null
}

export const EMPTY_HOME_RECORDS: HomeRecordsView = Object.freeze({
  runDays: Object.freeze(Array.from({ length: 7 }, () => false)),
  lastRunText: null,
})

export function buildHomeRecordsView(records: readonly RunRecord[], now: Date): HomeRecordsView {
  // 지금보다 늦게 시작한 기록(시계 오류 등)은 요일 표시와 마찬가지로 지난 러닝으로 보지 않는다.
  const latest = getLatestRecord(records.filter((record) => record.startedAt <= now.getTime()))
  return {
    runDays: getRunWeekdays(records, now),
    lastRunText: latest === null ? null : buildLastRunText(latest),
  }
}
