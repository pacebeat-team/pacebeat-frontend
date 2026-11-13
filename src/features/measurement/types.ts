// 측정 엔진 타입.
// - 시각은 모두 epoch ms(Date.now()와 같은 기준)이고, JSON으로 저장하고 복원해도 그대로 유지된다.

// 세션이 없으면(대기) 세션 값은 null이다.
export type SessionStatus = 'running' | 'paused' | 'finished'

// user: 사용자가 직접 종료 / auto: 측정 시간에 도달해 자동 종료
export type SessionEndReason = 'user' | 'auto'

// 사용자가 직접 일시정지한 구간. resumedAt이 null이면 아직 일시정지 중이다.
export interface ManualPause {
  readonly pausedAt: number
  readonly resumedAt: number | null
}

export interface MeasurementSession {
  readonly id: string
  readonly status: SessionStatus
  readonly startedAt: number
  readonly endedAt: number | null
  readonly endReason: SessionEndReason | null
  // 경과 시간에서 빼는 구간은 사용자가 직접 일시정지한 시간뿐이다.
  // GPS 끊김, 새로고침 후 GPS 재확인 대기 시간은 여기에 기록하지 않는다(경과 시간에 포함).
  readonly pauses: readonly ManualPause[]
}
