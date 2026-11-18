// 일반 RUN 준비 흐름(목표 → 음악 → 준비 확인 → 카운트다운)의 경로·접근 규칙·하단 네비 규칙.
// 순수 함수만 둔다. 화면(React)·Store·브라우저 API에 의존하지 않는다.

export const RUN_PATHS = Object.freeze({
  goal: '/running',
  time: '/running/time',
  music: '/running/music',
  ready: '/running/ready',
  // 카운트다운과 실제 세션 시작은 R3(#46)의 책임이다. 여기서는 경로만 정한다.
  countdown: '/running/countdown',
})

// 준비 흐름의 진행 단계(이 앱을 연 뒤 메모리에만 있다. 새로고침하면 처음부터 다시 시작한다).
// 0 아직 목표 화면을 보지 않음 → 1 목표 화면 진입 → 2 목표 확정(다음) → 3 음악 확정(다음/음악 없이) → 4 시작 신호
export type RunSetupLevel = 0 | 1 | 2 | 3 | 4

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
export function resolveRunRedirect(pathname: string, level: RunSetupLevel): string | null {
  const path = normalizeRunPath(pathname)
  const required = REQUIRED_LEVEL[path]
  if (required === undefined) return RUN_PATHS.goal
  return level >= required ? null : RUN_PATHS.goal
}

// 하단 네비는 러닝 흐름에서 목표·음악 화면에서만 보인다(시간 선택·준비 확인·카운트다운에서는 숨김).
export function isRunNavVisible(pathname: string): boolean {
  const path = normalizeRunPath(pathname)
  return path === RUN_PATHS.goal || path === RUN_PATHS.music
}
