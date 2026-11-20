import { formatDistanceKm2, formatPace } from '../running/format.ts'
import { countGoalCompleted, totalDistanceM } from '../running/recordQueries.ts'
import type { RunRecord } from '../running/types.ts'

// 성장 화면 표시값 (순수 함수). 저장소는 읽지 않는다.
// 날짜 규칙은 기록 화면과 같다: 기기 로컬 시간대, 기록의 startedAt 기준, 월요일 시작 주.
// 지금보다 늦게 시작한 기록은 뺀다(getVisibleRecords). 거리 합계는 GPS 기록만 더하고 TIME 기록은 러닝 횟수에만 센다.
// 근거가 없는 값(연속 기록, 기준이 없는 페이스 비교)은 만들지 않는다.

// 기록 화면(features/records)에 같은 규칙의 함수가 있지만, 기록 화면이 합쳐지기 전까지 이 화면이 그쪽에 의존하지 않도록 여기에 둔다.
// 기록 화면이 합쳐진 뒤 공통 모듈로 정리할 수 있다.

// 지금보다 늦게 시작한 기록(시계 오류 등)은 보이는 기록에서 뺀다.
export function getVisibleRecords(records: readonly RunRecord[], now: Date): RunRecord[] {
  return records.filter((record) => record.startedAt <= now.getTime())
}

// 요약 거리: 소수 둘째 자리 버림 뒤 끝의 0을 뗀다 ("24.3", "24", "0").
export function formatSummaryDistance(distanceM: number): string {
  const text = formatDistanceKm2(distanceM)
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// 월요일 0시
function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return day
}

function isSameMonth(startedAt: number, now: Date): boolean {
  const date = new Date(startedAt)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function isSameWeek(startedAt: number, now: Date): boolean {
  const start = startOfWeek(now).getTime()
  const next = new Date(start)
  next.setDate(next.getDate() + 7)
  return startedAt >= start && startedAt < next.getTime()
}

export type GrowthState = 'empty' | 'first' | 'ready'

// 보이는 기록이 0개면 empty, 1개면 first(첫 기록 화면), 그 이상이면 ready
export function getGrowthState(records: readonly RunRecord[], now: Date): GrowthState {
  const count = getVisibleRecords(records, now).length
  return count === 0 ? 'empty' : count === 1 ? 'first' : 'ready'
}

export interface ChartBar {
  readonly key: string
  readonly label: string
  // 막대 위 값. 거리가 없으면 null(막대도 그리지 않는다)
  readonly valueText: string | null
  // 0~1 (차트 최댓값 대비)
  readonly ratio: number
  readonly highlight: boolean
}

export interface ChartView {
  // 눈금(km): 0부터 올라가는 4개
  readonly guides: readonly number[]
  readonly bars: readonly ChartBar[]
}

const MIN_GUIDE_STEP = 5

// 눈금 간격은 5km 단위이고 최소 5km다. 가장 큰 값이 맨 위 눈금 안에 들어가도록 정한다.
export function buildChartGuides(maxKm: number): number[] {
  const step = Math.max(MIN_GUIDE_STEP, Math.ceil(maxKm / 3 / MIN_GUIDE_STEP) * MIN_GUIDE_STEP)
  return [0, step, step * 2, step * 3]
}

function toChart(items: readonly { key: string; label: string; distanceM: number | null; highlight: boolean }[]): ChartView {
  const maxKm = Math.max(0, ...items.map((item) => (item.distanceM ?? 0) / 1000))
  const guides = buildChartGuides(maxKm)
  const top = guides[guides.length - 1]
  return {
    guides,
    bars: items.map((item) => {
      const hasDistance = item.distanceM !== null && item.distanceM > 0
      return {
        key: item.key,
        label: item.label,
        valueText: hasDistance ? formatSummaryDistance(item.distanceM as number) : null,
        ratio: hasDistance ? Math.min(1, (item.distanceM as number) / 1000 / top) : 0,
        highlight: item.highlight,
      }
    }),
  }
}

// 목표 달성률: 완주 횟수 ÷ 전체 러닝 횟수(%, 반올림). 러닝이 없으면 null
export function achievementPercent(records: readonly RunRecord[]): number | null {
  if (records.length === 0) return null
  return Math.round((countGoalCompleted(records) / records.length) * 100)
}

export interface MonthlyGrowth {
  // "2026년 10월"
  readonly titleText: string
  readonly distanceText: string | null
  readonly chart: ChartView
  readonly runCount: number
  readonly achievementPercent: number
}

// 이번 달 성장. 이번 달 기록이 없으면 null
export function buildMonthlyGrowth(records: readonly RunRecord[], now: Date): MonthlyGrowth | null {
  const month = getVisibleRecords(records, now).filter((record) => isSameMonth(record.startedAt, now))
  if (month.length === 0) return null

  // 달의 첫 주를 1주로 하는 월요일 시작 주. 이번 주까지만 그린다.
  const lead = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7
  const weekIndex = (date: Date) => Math.floor((date.getDate() - 1 + lead) / 7)
  const currentIndex = weekIndex(now)
  const distances: number[] = Array.from({ length: currentIndex + 1 }, () => 0)
  for (const record of month) {
    const index = weekIndex(new Date(record.startedAt))
    distances[index] += record.result.distanceM ?? 0
  }

  return {
    titleText: `${now.getFullYear()}년 ${now.getMonth() + 1}월`,
    distanceText: hasDistance(month) ? formatSummaryDistance(totalDistanceM(month)) : null,
    chart: toChart(
      distances.map((distanceM, index) => ({
        key: `week-${index + 1}`,
        label: index === currentIndex ? '이번 주' : `${index + 1}주`,
        distanceM,
        highlight: index === currentIndex,
      })),
    ),
    runCount: month.length,
    achievementPercent: achievementPercent(month) ?? 0,
  }
}

const ORDINALS = ['첫 러닝', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째', '일곱 번째']

// 막대가 많으면 폭이 좁아 숫자만 쓴다.
function ordinalLabel(index: number, total: number): string {
  return total > 4 ? String(index + 1) : (ORDINALS[index] ?? `${index + 1}번째`)
}

function hasDistance(records: readonly RunRecord[]): boolean {
  return records.some((record) => record.result.distanceM !== null)
}

export interface WeeklyGrowth {
  readonly distanceText: string | null
  readonly chart: ChartView
  readonly runCount: number
}

// 이번 주(월~일) 성장. 이번 주 기록이 없으면 null. 막대는 러닝별 거리다.
export function buildWeeklyGrowth(records: readonly RunRecord[], now: Date): WeeklyGrowth | null {
  const week = getVisibleRecords(records, now)
    .filter((record) => isSameWeek(record.startedAt, now))
    .sort((a, b) => a.startedAt - b.startedAt)
  if (week.length === 0) return null
  return {
    distanceText: hasDistance(week) ? formatSummaryDistance(totalDistanceM(week)) : null,
    chart: toChart(
      week.map((record, index) => ({
        key: record.recordId,
        label: ordinalLabel(index, week.length),
        distanceM: record.result.distanceM,
        highlight: true,
      })),
    ),
    runCount: week.length,
  }
}

export interface PaceCompare {
  // 가장 최근 3 km 완주 페이스 "7:04"
  readonly latestText: string
  // 그 바로 이전 3 km 완주 페이스. 비교할 기록이 하나뿐이면 null
  readonly previousText: string | null
  // 이전보다 빨라졌을 때만 "26초 단축". 같거나 느려졌으면 null
  readonly savedText: string | null
}

// 3 km 거리 목표를 완주한 기록의 페이스. 같은 거리끼리만 비교한다(이전 완주 → 최근 완주). 없으면 null
export function buildPaceCompare(records: readonly RunRecord[], now: Date): PaceCompare | null {
  const runs = getVisibleRecords(records, now)
    .filter((record) => record.result.completion === 'goal' && record.goal.targetDistanceKm === 3 && record.result.avgPaceSecPerKm !== null)
    .sort((a, b) => a.startedAt - b.startedAt)
  const latest = runs[runs.length - 1]
  if (latest === undefined) return null
  const previous = runs[runs.length - 2]
  const latestPace = latest.result.avgPaceSecPerKm as number
  const previousPace = previous === undefined ? null : (previous.result.avgPaceSecPerKm as number)
  const saved = previousPace === null ? 0 : Math.round(previousPace) - Math.round(latestPace)
  return {
    latestText: formatPace(latestPace),
    previousText: previousPace === null ? null : formatPace(previousPace),
    savedText: saved > 0 ? `${saved}초 단축` : null,
  }
}

export interface FirstRecordView {
  // 거리가 없는 기록(TIME)이면 null
  readonly distanceText: string | null
  // "10월 9일"
  readonly dateText: string
}

// 기록이 하나뿐일 때의 첫 기록 요약. 기록이 정확히 하나가 아니면 null
export function buildFirstRecord(records: readonly RunRecord[], now: Date): FirstRecordView | null {
  const visible = getVisibleRecords(records, now)
  if (visible.length !== 1) return null
  const [record] = visible
  const date = new Date(record.startedAt)
  return {
    distanceText: record.result.distanceM === null ? null : formatSummaryDistance(record.result.distanceM),
    dateText: `${date.getMonth() + 1}월 ${date.getDate()}일`,
  }
}
