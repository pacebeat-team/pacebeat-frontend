import type { PostureSide, PostureSummary } from '../running/postureSummary.ts'

// 자세 리포트의 집계와 화면 모델. UI와 저장소를 알지 못하는 순수 함수이다.
// 입력은 "러닝 기록별 자세 요약"(PostureRecordInput)뿐이고, 집계 결과는 저장하지 않는다(기존 기록으로 매번 계산한다).
//
// 범위(미확정 규칙은 아래 상수와 주석에 그대로 적었다. SDK 계약이 아니라 Figma 화면에서 읽은 해석이다):
// - 좌우 균형 카드와 지난주 비교: 최근 4주(28일, 지금 시각 기준 롤링) 안의 "양쪽 측정" 기록.
// - 착지 압력 분포와 "이번 측정에서 보이는 점": 같은 4주 안에서 압력이 있는 최근 3회 기록.
// - 지난주 비교(확정 정책 A): 최근 7일 (now−7일, now] 과 그 직전 7일 (now−14일, now−7일] 의 "양쪽 측정" 기록 평균을 비교한다.
//   두 구간은 앞은 열리고 뒤는 닫힌 구간이라 서로 겹치지 않는다(정확히 now−7일 시각은 직전 7일에 속한다). 28일 분석 기간과는 별개이다.
//   어느 한쪽 구간에 양쪽 측정 기록이 없으면 비교를 만들지 않는다.
// - 한쪽만 측정된 기록은 좌우 비교(균형·비교)에서 제외하고, 가장 최근 것을 안내와 One side 링크로 남긴다. 기록은 지우지 않는다.
// - 측정 품질은 근거와 산정 규칙이 없어서 계산하지 않는다.
// - 평균은 기록마다 같은 비중으로 계산한다(러닝 시간·거리 가중은 정해지지 않았다). 최소 기록 수 기준도 정해지지 않아 1건이면 충분하다.

export const DAY_MS = 24 * 60 * 60 * 1000
export const REPORT_WINDOW_DAYS = 28
export const REPORT_WINDOW_WEEKS = REPORT_WINDOW_DAYS / 7
export const RECENT_PRESSURE_RUNS = 3
// 지난주 비교 구간 길이(일). 최근 7일과 그 직전 7일.
export const COMPARE_DAYS = 7

export interface PostureRecordInput {
  readonly recordId: string
  // 러닝 시작 시각(ms)
  readonly startedAt: number
  readonly posture: PostureSummary | null
}

export interface BalanceView {
  // 합이 100인 정수 비율
  readonly left: number
  readonly right: number
}

export interface PressureView {
  readonly heel: number
  readonly mid: number
  readonly forefoot: number
  // 이 분포를 만든 기록 수(최대 3)
  readonly runs: number
}

export interface ExcludedRun {
  readonly recordId: string
  readonly startedAt: number
  readonly side: Exclude<PostureSide, 'both'>
}

export interface PostureReportModel {
  readonly windowWeeks: number
  // 4주 안에서 자세 요약이 있는 기록 수(한쪽만 측정된 기록 포함)
  readonly measuredRuns: number
  readonly balance: BalanceView | null
  // 오른쪽 비중이 50%보다 높을 때만 값이 있다(몇 %p 높은지). Figma에 있는 문구가 이 경우뿐이다.
  readonly rightAboveEven: number | null
  // 직전 7일 오른쪽 비중 → 최근 7일 오른쪽 비중. 두 구간 모두 양쪽 측정 기록이 있을 때만 있다.
  readonly comparison: { readonly previousRight: number; readonly currentRight: number } | null
  readonly pressure: PressureView | null
  // 가장 많이 모인 구역이 뒤꿈치일 때만 true(Figma에 있는 해석 문장이 이 경우뿐이다).
  readonly heelDominant: boolean
  readonly excluded: ExcludedRun | null
}

export interface OneSideModel {
  readonly recordId: string
  readonly startedAt: number
  readonly side: Exclude<PostureSide, 'both'>
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

// 합이 정확히 100이 되도록 반올림한다(가장 큰 소수 부분부터 올림).
function roundToHundred(values: readonly number[]): number[] {
  const floors = values.map(Math.floor)
  let remainder = 100 - floors.reduce((total, value) => total + value, 0)
  const order = values.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order) {
    if (remainder <= 0) break
    floors[index] += 1
    remainder -= 1
  }
  return floors
}

function inRange(record: PostureRecordInput, from: number, to: number): boolean {
  return Number.isFinite(record.startedAt) && record.startedAt >= from && record.startedAt <= to
}

// (from, to] 구간: 앞은 제외, 뒤는 포함
function inHalfOpen(record: PostureRecordInput, from: number, to: number): boolean {
  return Number.isFinite(record.startedAt) && record.startedAt > from && record.startedAt <= to
}

function balanceOf(records: readonly PostureRecordInput[]): BalanceView | null {
  const lefts = records.flatMap((record) => (record.posture?.measuredSide === 'both' && record.posture.balance !== null ? [record.posture.balance.left] : []))
  if (lefts.length === 0) return null
  const left = Math.round(mean(lefts))
  return { left, right: 100 - left }
}

export function buildPostureReport(records: readonly PostureRecordInput[], now: number): PostureReportModel | null {
  const from = now - REPORT_WINDOW_DAYS * DAY_MS
  const measured = records.filter((record) => record.posture !== null && inRange(record, from, now))
  if (measured.length === 0) return null

  const balance = balanceOf(measured)
  const recentWeek = balanceOf(records.filter((record) => inHalfOpen(record, now - COMPARE_DAYS * DAY_MS, now)))
  const previousWeek = balanceOf(records.filter((record) => inHalfOpen(record, now - 2 * COMPARE_DAYS * DAY_MS, now - COMPARE_DAYS * DAY_MS)))

  const latestFirst = [...measured].sort((a, b) => b.startedAt - a.startedAt)
  const withPressure = latestFirst.flatMap((record) => (record.posture?.pressure ? [record.posture.pressure] : [])).slice(0, RECENT_PRESSURE_RUNS)
  let pressure: PressureView | null = null
  if (withPressure.length > 0) {
    const [heel, mid, forefoot] = roundToHundred([
      mean(withPressure.map((zones) => zones.heel)),
      mean(withPressure.map((zones) => zones.mid)),
      mean(withPressure.map((zones) => zones.forefoot)),
    ])
    pressure = { heel, mid, forefoot, runs: withPressure.length }
  }

  const oneSide = latestFirst.find((record) => record.posture !== null && record.posture.measuredSide !== 'both')
  const excluded: ExcludedRun | null =
    oneSide?.posture && oneSide.posture.measuredSide !== 'both' ? { recordId: oneSide.recordId, startedAt: oneSide.startedAt, side: oneSide.posture.measuredSide } : null

  return {
    windowWeeks: REPORT_WINDOW_WEEKS,
    measuredRuns: measured.length,
    balance,
    rightAboveEven: balance !== null && balance.right > 50 ? balance.right - 50 : null,
    comparison: recentWeek !== null && previousWeek !== null ? { previousRight: previousWeek.right, currentRight: recentWeek.right } : null,
    pressure,
    heelDominant: pressure !== null && pressure.heel > pressure.mid && pressure.heel > pressure.forefoot,
    excluded,
  }
}

// One side 화면: 한쪽만 측정된 기록일 때만 만든다. 기간 제한은 없다(기록은 보존되어 있다).
export function buildOneSide(records: readonly PostureRecordInput[], recordId: string): OneSideModel | null {
  const record = records.find((item) => item.recordId === recordId)
  if (!record?.posture || record.posture.measuredSide === 'both') return null
  return { recordId: record.recordId, startedAt: record.startedAt, side: record.posture.measuredSide }
}

export const POSTURE_PATH = '/growth/posture'
export const postureOneSidePath = (recordId: string): string => `${POSTURE_PATH}/${encodeURIComponent(recordId)}`
