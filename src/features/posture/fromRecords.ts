import type { RunRecord } from '../running/types.ts'
import type { PostureRecordInput } from './postureReport.ts'

// 저장된 러닝 기록 → 자세 집계 입력. 집계 결과는 저장하지 않고, 기록에서 매번 계산한다.
export function toPostureInputs(records: readonly RunRecord[]): PostureRecordInput[] {
  return records.map((record) => ({ recordId: record.recordId, startedAt: record.startedAt, posture: record.sensorReport }))
}

// "10월 7일" 형식(기기의 현재 시간대 기준)
export function formatMonthDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}
