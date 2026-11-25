// 화면과 서버 동기화 사이의 가벼운 신호(순수 DOM 이벤트). 화면이 API 모듈을 직접 가져오지 않게 하는 연결점이다.
// - reflection-saved: 기록 상세에서 회고를 로컬에 저장한 직후(서버로 보낼 때 쓴다)
// - runs-changed: 서버에서 가져온 기록이 로컬에 추가됐을 때(기록 화면이 다시 읽는다)
// - runs-deleted: 마이 > 내 데이터 삭제에서 로컬 기록 전체 삭제가 완료됐을 때(서버 기록도 함께 삭제한다)
export const REFLECTION_SAVED_EVENT = 'pacebeat:reflection-saved'
export const RUNS_CHANGED_EVENT = 'pacebeat:runs-changed'
export const RUNS_DELETED_EVENT = 'pacebeat:runs-deleted'

export function notifyReflectionSaved(detail: { readonly sessionId: string; readonly reflection: unknown }): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REFLECTION_SAVED_EVENT, { detail }))
}

export function notifyRunsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RUNS_CHANGED_EVENT))
}

export function notifyRunsDeleted(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RUNS_DELETED_EVENT))
}
