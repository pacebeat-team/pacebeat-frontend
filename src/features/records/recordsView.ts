import { WEEKDAY_LABELS } from '../home/homeView.ts'
import { formatClock, formatDistanceKm2, formatPaceOrDash } from '../running/format.ts'
import { countGoalCompleted, sortNewestFirst, totalDistanceM } from '../running/recordQueries.ts'
import type { RunRecord } from '../running/types.ts'

// 기록 화면 표시값 (순수 함수). 저장소는 읽지 않는다.
// 날짜 규칙: 기기 로컬 시간대, 기록의 startedAt 기준. 월요일 시작 달력.
// 지금보다 늦게 시작한 기록(시계 오류 등)은 Home과 같이 보이는 기록에서 뺀다.

export function getVisibleRecords(records: readonly RunRecord[], now: Date): RunRecord[] {
  return records.filter((record) => record.startedAt <= now.getTime())
}

function isSameMonth(startedAt: number, now: Date): boolean {
  const date = new Date(startedAt)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

// 이번 달 러닝 횟수: GPS 완주·일부·TIME 기록을 모두 센다.
export function countMonthRuns(records: readonly RunRecord[], now: Date): number {
  return getVisibleRecords(records, now).filter((record) => isSameMonth(record.startedAt, now)).length
}

// 요약 거리: 소수 둘째 자리 버림 뒤 끝의 0을 뗀다 ("24.3", "24", "0").
export function formatSummaryDistance(distanceM: number): string {
  const text = formatDistanceKm2(distanceM)
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

export interface RecordsSummary {
  readonly monthCount: number
  // 단위(km)는 화면이 붙인다.
  readonly distanceText: string
  readonly completeCount: number
}

// 이번 달 횟수 / 전체 누적 거리(TIME 제외) / 전체 거리 완주 횟수
export function buildRecordsSummary(records: readonly RunRecord[], now: Date): RecordsSummary {
  const visible = getVisibleRecords(records, now)
  return {
    monthCount: countMonthRuns(records, now),
    distanceText: formatSummaryDistance(totalDistanceM(visible)),
    completeCount: countGoalCompleted(visible),
  }
}

export type DayMarker = 'full' | 'partial' | 'time'

const MARKER_RANK: Record<DayMarker, number> = { full: 3, partial: 2, time: 1 }

function markerOf(record: RunRecord): DayMarker {
  const { completion } = record.result
  return completion === 'goal' ? 'full' : completion === 'partial' ? 'partial' : 'time'
}

export interface CalendarDay {
  readonly day: number
  // 하루에 여러 기록이 있으면 거리 완주 → 일부 러닝 → 시간 기록 순으로 하나만 보인다.
  readonly marker: DayMarker | null
  // 그날 가장 늦게 끝난 기록. 없으면 null
  readonly recordId: string | null
  readonly isToday: boolean
}

export interface CalendarView {
  readonly title: string
  // 월요일부터 7칸씩. 달 밖의 칸은 null
  readonly weeks: readonly (CalendarDay | null)[][]
}

export function buildCalendar(records: readonly RunRecord[], now: Date): CalendarView {
  const year = now.getFullYear()
  const month = now.getMonth()
  const markers = new Map<number, DayMarker>()
  const latestOfDay = new Map<number, RunRecord>()
  for (const record of getVisibleRecords(records, now)) {
    if (!isSameMonth(record.startedAt, now)) continue
    const day = new Date(record.startedAt).getDate()
    const marker = markerOf(record)
    const current = markers.get(day)
    if (current === undefined || MARKER_RANK[marker] > MARKER_RANK[current]) markers.set(day, marker)
    const latest = latestOfDay.get(day)
    if (latest === undefined || record.endedAt > latest.endedAt) latestOfDay.set(day, record)
  }

  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const dayCount = new Date(year, month + 1, 0).getDate()
  const cells: (CalendarDay | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push({
      day,
      marker: markers.get(day) ?? null,
      recordId: latestOfDay.get(day)?.recordId ?? null,
      isToday: day === now.getDate(),
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (CalendarDay | null)[][] = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return { title: `${year}년 ${month + 1}월`, weeks }
}

export interface RecordRowView {
  readonly recordId: string
  // "10.23"
  readonly dateText: string
  // "금요일"
  readonly weekdayText: string
  // GPS "4.50 km" / TIME "09:51"
  readonly mainText: string
  // GPS "31:48 · 7:04/km" / TIME은 없음(값을 만들지 않는다)
  readonly detailText: string | null
  readonly statusText: string
}

export function buildRecordRow(record: RunRecord): RecordRowView {
  const date = new Date(record.startedAt)
  const { completion, distanceM, elapsedMs, avgPaceSecPerKm } = record.result
  const isTime = completion === 'time'
  return {
    recordId: record.recordId,
    dateText: `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
    weekdayText: `${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}요일`,
    mainText: isTime || distanceM === null ? formatClock(elapsedMs) : `${formatDistanceKm2(distanceM)} km`,
    detailText: isTime ? null : `${formatClock(elapsedMs)} · ${formatPaceOrDash(avgPaceSecPerKm)}/km`,
    statusText: completion === 'goal' ? '거리 완주' : completion === 'partial' ? '목표 전 종료' : '시간 기록',
  }
}

// 최신순(endedAt). monthOnly이면 이번 달 기록만.
export function buildRecordRows(records: readonly RunRecord[], now: Date, monthOnly: boolean): RecordRowView[] {
  const visible = getVisibleRecords(records, now).filter((record) => !monthOnly || isSameMonth(record.startedAt, now))
  return sortNewestFirst(visible).map(buildRecordRow)
}
