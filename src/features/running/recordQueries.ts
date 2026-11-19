import type { RunRecord } from './types.ts'

// 저장된 러닝 기록 조회·집계 (순수 함수). 홈·기록 화면이 나중에 이 함수들을 쓴다.
// ⚠️ TIME 기록(completion='time')은 거리·페이스가 null이므로 거리 합계·거리 목표 달성 횟수에서 제외한다.

export function sortNewestFirst(records: readonly RunRecord[]): RunRecord[] {
  return [...records].sort((a, b) => b.endedAt - a.endedAt)
}

export function findRecord(records: readonly RunRecord[], recordId: string): RunRecord | null {
  return records.find((record) => record.recordId === recordId) ?? null
}

// 누적 거리(m): GPS 기록만 더한다(TIME 기록 제외).
export function totalDistanceM(records: readonly RunRecord[]): number {
  return records.reduce((sum, record) => sum + (record.result.distanceM ?? 0), 0)
}

// 누적 러닝 시간(ms): TIME 기록도 포함한다.
export function totalElapsedMs(records: readonly RunRecord[]): number {
  return records.reduce((sum, record) => sum + record.result.elapsedMs, 0)
}

// 거리 목표 달성 횟수: 거리 완주(goal)만 센다. 일부 러닝·시간 기록은 세지 않는다.
export function countGoalCompleted(records: readonly RunRecord[]): number {
  return records.filter((record) => record.result.completion === 'goal').length
}

// 거리를 가진 기록만(홈 평균 페이스 등에 사용)
export function recordsWithDistance(records: readonly RunRecord[]): RunRecord[] {
  return records.filter((record) => record.result.distanceM !== null)
}
