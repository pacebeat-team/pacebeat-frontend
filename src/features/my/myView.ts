import { computeBaselinePace } from '../measurement/baseline.ts'
import { getMetrics } from '../measurement/metrics.ts'
import type { MeasurementSession, MetricsState } from '../measurement/types.ts'
import { formatPace } from '../running/format.ts'
import type { ExperienceLevel, WeeklyRuns } from '../../types/onboarding.ts'
import { isBaselineMeasurementCompleted } from '../../lib/baselineCompletion.ts'

// 마이 메인 표시값 (순수 함수). 저장된 값만 보여 주고, 없는 값은 만들거나 추정하지 않는다.

// 경험 수준 문구. '러닝 입문'은 Figma 문구이고, 나머지는 같은 규칙으로 맞춘 문구다.
const EXPERIENCE_TEXT: Record<ExperienceLevel, string> = {
  beginner: '러닝 입문',
  occasional: '가끔 러닝',
  regular: '꾸준한 러닝',
}

const WEEKLY_RUNS_TEXT: Record<WeeklyRuns, string> = {
  '1': '주 1회 목표',
  '2': '주 2회 목표',
  '3+': '주 3회 이상 목표',
}

// "러닝 입문 · 주 2회 목표". 저장된 값이 없는 쪽은 빼고, 둘 다 없으면 null이다.
export function buildProfileLine(experienceLevel: ExperienceLevel | null, weeklyRuns: WeeklyRuns | null): string | null {
  const parts = [
    ...(experienceLevel === null ? [] : [EXPERIENCE_TEXT[experienceLevel]]),
    ...(weeklyRuns === null ? [] : [WEEKLY_RUNS_TEXT[weeklyRuns]]),
  ]
  return parts.length === 0 ? null : parts.join(' · ')
}

export interface BaselineView {
  // "7:20"
  readonly paceText: string
  // "9월 30일 측정"
  readonly measuredText: string
}

interface MeasurementSnapshot {
  readonly session: MeasurementSession | null
  readonly runSource: { readonly kind: 'real' | 'virtual' } | null
  readonly metrics: MetricsState
}

// 내 기준. 완료한 실제 기초 측정에서 기준 페이스를 구할 수 있을 때만 값이 있다.
// 케이던스·품질은 저장하지 않으므로 만들지 않는다.
export function buildBaselineView(measurement: MeasurementSnapshot): BaselineView | null {
  const { session } = measurement
  if (session === null || session.endedAt === null) return null
  if (!isBaselineMeasurementCompleted(measurement as Parameters<typeof isBaselineMeasurementCompleted>[0])) return null
  const metrics = getMetrics(measurement.metrics, session, session.endedAt)
  const pace = computeBaselinePace(metrics)
  if (pace === null) return null
  const date = new Date(session.startedAt)
  return { paceText: formatPace(pace), measuredText: `${date.getMonth() + 1}월 ${date.getDate()}일 측정` }
}
