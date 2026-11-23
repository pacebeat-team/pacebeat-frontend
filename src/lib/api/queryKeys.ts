// 서버 데이터의 Query Key를 한곳에서 만든다(기능별 첫 요소로 묶는다). 사용자별 데이터는 로그인 방식 확정 후 userId를 앞에 붙인다.
export const queryKeys = {
  profile: () => ['profile'] as const,
  baseline: () => ['baseline'] as const,
  home: () => ['home', 'summary'] as const,
  runs: (range: { from?: string; to?: string } = {}) => ['runs', 'list', range.from ?? null, range.to ?? null] as const,
  run: (runId: string) => ['runs', 'detail', runId] as const,
  growthRunning: (period: 'weekly' | 'monthly') => ['growth', 'running', period] as const,
  growthPosture: (period: 'weekly' | 'monthly') => ['growth', 'posture', period] as const,
  musicPresets: () => ['music', 'presets'] as const,
  insoles: () => ['devices', 'insoles'] as const,
} as const
