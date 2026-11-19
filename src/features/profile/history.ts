// 뒤로 갈 이전 화면이 앱 안에 있는가. React Router가 history.state에 넣는 idx(0부터 시작)로 판단한다.
// 직접 진입이나 새로고침이면 idx가 0이거나 없어서 false다.
export function hasPreviousEntry(historyState: unknown): boolean {
  if (typeof historyState !== 'object' || historyState === null) return false
  const idx = (historyState as { idx?: unknown }).idx
  return typeof idx === 'number' && idx > 0
}
