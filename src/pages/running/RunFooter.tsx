import type { ReactNode } from 'react'

export interface RunFooterProps {
  children: ReactNode
  // 주 버튼 아래에 보조(텍스트) 버튼이 있는가. Figma `layout / fixed footer`: 없으면 하단 홈 인디케이터 영역(16px)이 더 필요하다.
  hasSecondary?: boolean
}

// Figma `layout / fixed footer`: 좌우 12px(버튼 폭 366px), 위 8px, 버튼 사이 간격 없음.
// 아래쪽은 홈 인디케이터 영역(보조 버튼이 있으면 20px, 없으면 36px)이다. 기기의 Safe Area(AppLayout이 이미 더한다)가 있으면 그만큼 뺀다.
export function RunFooter({ children, hasSecondary = false }: RunFooterProps) {
  const bottom = hasSecondary
    ? 'pb-[max(0px,calc(20px-env(safe-area-inset-bottom,0px)))]'
    : 'pb-[max(0px,calc(36px-env(safe-area-inset-bottom,0px)))]'
  return <div className={`flex shrink-0 flex-col px-3 pt-2 ${bottom}`}>{children}</div>
}

export default RunFooter
