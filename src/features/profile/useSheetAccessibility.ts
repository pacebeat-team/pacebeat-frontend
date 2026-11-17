import { useEffect, useRef } from 'react'

// 바텀시트(TermsSheet, PickerSheet)가 함께 쓰는 키보드 접근성 로직.
// 열리면 initialFocusRef 요소로 포커스가 가고, Tab/Shift+Tab은 시트(dialogRef) 안에서만 순환한다.
// 시트 바깥(배경 화면, 하단 내비 등)은 열려 있는 동안 inert로 만들어 키보드와 보조기기가 닿지 않게 하고,
// Escape로 닫을 수 있으며, 닫히면 열기 전에 포커스가 있던 요소로 포커스를 돌려 준다.

const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

// root를 감싼 모든 조상의 다른 자식 요소를 inert로 만들고, 되돌리는 함수를 돌려 준다. 원래 inert였던 요소는 건드리지 않는다.
function makeOutsideInert(root: HTMLElement): () => void {
  const changed: HTMLElement[] = []
  let node: HTMLElement = root
  while (node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true
        changed.push(sibling)
      }
    }
    node = node.parentElement
  }
  return () => {
    for (const element of changed) element.inert = false
  }
}

// T는 처음 포커스를 받을 요소의 타입이다. (TermsSheet는 닫기 버튼, PickerSheet는 선택 목록)
export function useSheetAccessibility<T extends HTMLElement>(onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<T>(null)

  // 최신 onClose를 ref로 들고 있다. 부모가 렌더링마다 새 함수를 넘겨도 아래 포커스 관리 effect는 다시 실행되지 않는다.
  // (effect가 다시 실행되면 포커스가 처음 요소로 되돌아가고 inert가 풀렸다 다시 걸린다.)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // 열기 전에 포커스가 있던 요소("보기" 버튼 등)를 기억해 두었다가 닫을 때 돌려 준다.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restoreOutside = makeOutsideInert(root)
    initialFocusRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusable || focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const outside = !dialogRef.current?.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // inert를 먼저 풀어야 포커스를 돌려줄 수 있다.
      restoreOutside()
      previouslyFocused?.focus()
    }
  }, [])

  return { rootRef, dialogRef, initialFocusRef }
}
