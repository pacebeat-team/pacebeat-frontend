import { formatDistanceKm, formatDuration, formatGoalChip, formatPace } from '../running/format.ts'
import { getTargetPaceSecPerKm } from '../running/goal.ts'
import type { GoalDistanceKm } from '../running/types.ts'

// Home 화면 표시값 (순수 함수). 저장된 기록은 읽지 않는다.

// 월요일 시작 요일 라벨 (Figma `week / calendar`)
export const WEEKDAY_LABELS: readonly string[] = ['월', '화', '수', '목', '금', '토', '일']

// 기기 로컬 시각 기준 요일 위치. 월요일 = 0, 일요일 = 6
export function getWeekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

export interface WeekDayView {
  readonly label: string
  readonly isToday: boolean
}

// 월요일부터 7칸. 오늘 칸만 표시한다.
export function buildWeekRow(now: Date): WeekDayView[] {
  const today = getWeekdayIndex(now)
  return WEEKDAY_LABELS.map((label, index) => ({ label, isToday: index === today }))
}

export interface HeroView {
  // "3.0"
  readonly distanceText: string
  // "21:00 목표"
  readonly goalText: string
  // "7:00 /km"
  readonly paceText: string
}

export function buildHeroView(distanceKm: GoalDistanceKm, targetDurationSec: number): HeroView {
  return {
    distanceText: formatDistanceKm(distanceKm),
    goalText: `${formatDuration(targetDurationSec)} 목표`,
    paceText: `${formatPace(getTargetPaceSecPerKm(distanceKm, targetDurationSec))} /km`,
  }
}

// "추천 목표 수정" 행의 값: "3 km · 21:00"
export function buildGoalRowValue(distanceKm: GoalDistanceKm, targetDurationSec: number): string {
  return formatGoalChip(distanceKm, targetDurationSec)
}
