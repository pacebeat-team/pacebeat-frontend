import { useEffect, useState } from 'react'

// 화면 키보드가 가리는 아래쪽 높이(px)를 구한다. (순수 함수)
// iOS Safari는 키보드가 올라와도 레이아웃 뷰포트(innerHeight, dvh)를 줄이지 않고 화면 아래를 덮는다.
// 보이는 영역(visualViewport)과 레이아웃 뷰포트의 차이가 키보드 높이다.
// 주소창이 접히고 펼쳐질 때 생기는 작은 차이는 키보드로 보지 않도록 기준값 아래는 0으로 본다.
export const KEYBOARD_MIN_INSET = 80

export function computeKeyboardInset(layoutHeight: number, visibleHeight: number, visibleOffsetTop: number): number {
  const inset = layoutHeight - visibleHeight - visibleOffsetTop
  if (!Number.isFinite(inset) || inset < KEYBOARD_MIN_INSET) return 0
  return Math.round(inset)
}

// 키보드가 가리는 높이를 따라가는 훅. visualViewport가 없는 환경에서는 항상 0이다.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    function update() {
      if (!viewport) return
      setInset(computeKeyboardInset(window.innerHeight, viewport.height, viewport.offsetTop))
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
