// 일반 RUN 준비 흐름(목표 → 음악 → 준비 확인 → 카운트다운)의 경로·접근 규칙·하단 네비 규칙.
// 순수 함수만 둔다. 화면(React)·Store·브라우저 API에 의존하지 않는다.

export const RUN_PATHS = Object.freeze({
  goal: '/running',
  time: '/running/time',
  music: '/running/music',
  ready: '/running/ready',
  countdown: '/running/countdown',
  // 진행·일시정지는 같은 경로이다(세션 상태로 화면이 바뀐다). 종료 확인은 진행 화면 위의 별도 화면이다.
  active: '/running/active',
  end: '/running/end',
  // 종료된 세션의 결과. #47 전까지는 자리 표시 화면이다.
  result: '/running/result',
  // 거리 목표 완주로 끝났을 때만 거치는 도착 화면(0.8초 뒤 결과로 넘어간다)과 구간별 기록 상세
  arrival: '/running/arrival',
  resultDetails: '/running/result/details',
})

// 음악 미리 듣기 화면: /running/music/<trackId>
export function getMusicPreviewPath(trackId: string): string {
  return `${RUN_PATHS.music}/${trackId}`
}

function isMusicPreviewPath(path: string): boolean {
  const prefix = `${RUN_PATHS.music}/`
  return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/')
}

// 준비 흐름의 진행 단계(이 앱을 연 뒤 메모리에만 있다. 새로고침하면 처음부터 다시 시작한다).
// 0 아직 목표 화면을 보지 않음 → 1 목표 화면 진입 → 2 목표 확정(다음) → 3 음악 확정(다음/음악 없이) → 4 시작 신호
export type RunSetupLevel = 0 | 1 | 2 | 3 | 4

// 활성 세션 상태: none(없음) / active(진행·일시정지) / finished(종료됐고 아직 정리하지 않음)
export type RunSessionPhase = 'none' | 'active' | 'finished'

// 종료된 세션의 결과 흐름에 속한 경로인가(도착·결과·구간별 기록)
export function isFinishedPath(pathname: string): boolean {
  return FINISHED_PATHS.includes(normalizeRunPath(pathname))
}

// 저장된 세션 상태에서 phase를 구한다. 세션이 없으면 none.
export function getRunSessionPhase(session: { readonly status: 'running' | 'paused' | 'finished' } | null): RunSessionPhase {
  if (session === null) return 'none'
  return session.status === 'finished' ? 'finished' : 'active'
}

// 복귀 바 등이 쓰는 phase. 기록 저장을 마친 세션(saved)은 저장소에 아직 남아 있어도 끝난 것으로 본다.
export function resolveGuardPhase(status: 'running' | 'paused' | 'finished' | null, saved: boolean): RunSessionPhase {
  if (saved) return 'none'
  return getRunSessionPhase(status === null ? null : { status })
}

// 목표 거리 도달로 자동 종료된 세션이라 도착 화면을 거쳐야 하는가
export function isArrivalPending(session: { readonly status: 'running' | 'paused' | 'finished'; readonly endReason: string | null } | null): boolean {
  return session !== null && session.status === 'finished' && session.endReason === 'auto'
}

const ACTIVE_PATHS: readonly string[] = [RUN_PATHS.active, RUN_PATHS.end]
const FINISHED_PATHS: readonly string[] = [RUN_PATHS.result, RUN_PATHS.arrival, RUN_PATHS.resultDetails]

const REQUIRED_LEVEL: Readonly<Record<string, RunSetupLevel>> = {
  [RUN_PATHS.goal]: 0,
  [RUN_PATHS.time]: 1,
  [RUN_PATHS.music]: 2,
  [RUN_PATHS.ready]: 3,
  [RUN_PATHS.countdown]: 4,
}

export function normalizeRunPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function isRunPath(pathname: string): boolean {
  const path = normalizeRunPath(pathname)
  return path === RUN_PATHS.goal || path.startsWith(`${RUN_PATHS.goal}/`)
}

// 선행 단계를 거치지 않고 들어온 경로는 목표 화면으로 보낸다. 접근할 수 있으면 null.
// 알 수 없는 /running/* 경로도 목표 화면으로 보낸다.
// 세션이 있으면 세션이 우선한다: 진행 중이면 진행 화면(또는 종료 확인)만, 종료됐으면 결과 화면만 접근할 수 있다.
// (러닝 탭을 다시 열면 활성 세션 화면으로 돌아오는 복귀 진입점이 된다.)
// saved: 이 세션의 기록 저장을 마쳤다(정리는 결과 흐름을 벗어난 뒤).
// arrivalPending: 목표 거리 도달로 방금 자동 종료됐다(endReason 'auto'). 진행·종료 확인 화면에서 끝난 경우 결과가 아니라 도착 화면으로 보낸다.
// 화면 전환을 이 규칙 한 곳에서만 정하므로, 진행 화면이 언마운트되는 시점에 따라 도착 화면이 빠지는 일이 없다.
export function resolveRunRedirect(
  pathname: string,
  level: RunSetupLevel,
  phase: RunSessionPhase = 'none',
  arrivalPending = false,
  saved = false,
): string | null {
  const path = normalizeRunPath(pathname)
  // 기록 저장을 마친 세션: 결과 흐름 화면에서는 아무것도 하지 않는다(저장 뒤의 이동을 가드가 가로채지 않는다).
  // 그 밖의 경로는 세션이 없는 것처럼 다룬다(저장 직후 "다음 목표"가 결과 화면으로 되돌려지지 않는다).
  if (phase === 'finished' && saved) {
    if (FINISHED_PATHS.includes(path)) return null
    return resolveRunRedirect(pathname, level, 'none', false, false)
  }
  if (phase === 'active') return ACTIVE_PATHS.includes(path) ? null : RUN_PATHS.active
  if (phase === 'finished') {
    if (FINISHED_PATHS.includes(path)) return null
    return arrivalPending && ACTIVE_PATHS.includes(path) ? RUN_PATHS.arrival : RUN_PATHS.result
  }
  if (ACTIVE_PATHS.includes(path) || FINISHED_PATHS.includes(path)) return RUN_PATHS.goal
  // 음악 미리 듣기는 음악 화면과 같은 단계(목표 확정)가 필요하다.
  const required = isMusicPreviewPath(path) ? REQUIRED_LEVEL[RUN_PATHS.music] : REQUIRED_LEVEL[path]
  if (required === undefined) return RUN_PATHS.goal
  return level >= required ? null : RUN_PATHS.goal
}

// 러닝 탭·상단 복귀 바가 향하는 곳. 활성 세션이 있으면 진행·일시정지 화면, 종료됐으면 결과, 없으면 목표 화면.
export function getRunReturnPath(phase: RunSessionPhase): string {
  if (phase === 'active') return RUN_PATHS.active
  if (phase === 'finished') return RUN_PATHS.result
  return RUN_PATHS.goal
}

// 하단 네비는 러닝 흐름에서 목표·음악 화면과 진행 화면(진행 중일 때)에서만 보인다.
// 시간 선택·음악 미리 듣기·준비 확인·카운트다운·일시정지·종료 확인·결과에서는 숨긴다.
export function isRunNavVisible(pathname: string, sessionStatus: 'running' | 'paused' | 'finished' | null = null): boolean {
  const path = normalizeRunPath(pathname)
  if (path === RUN_PATHS.active) return sessionStatus === 'running'
  return path === RUN_PATHS.goal || path === RUN_PATHS.music
}
