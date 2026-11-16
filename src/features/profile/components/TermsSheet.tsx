import { useEffect, useRef } from 'react'

// 약관 원문 Bottom Sheet. 실제 약관이 연결되기 전까지는 자리 표시 문구만 보여 준다.
// 가장 가까운 position 조상(AppLayout 프레임) 안에 가둬서 그리므로 앱 프레임 밖으로 넘치지 않는다.
// 닫기: 닫기 버튼, 딤 영역 클릭, Escape 키.
// 키보드 접근성: 열리면 닫기 버튼으로 포커스가 가고, Tab/Shift+Tab은 시트 안에서만 순환한다.
// 시트 바깥(배경 화면, 하단 내비 등)은 열려 있는 동안 inert로 만들어 키보드와 보조기기가 닿지 않게 하고,
// 닫으면 열었던 요소("보기" 버튼)로 포커스를 돌려 준다.

export interface TermsSheetProps {
  onClose: () => void
}

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

export function TermsSheet({ onClose }: TermsSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // 열기 전에 포커스가 있던 요소("보기" 버튼)를 기억해 두었다가 닫을 때 돌려 준다.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restoreOutside = makeOutsideInert(root)
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
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
  }, [onClose])

  return (
    <div ref={rootRef} className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label="약관 원문 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-[#111111] opacity-[0.32]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-sheet-title"
        // 기본 높이는 Figma의 360px. 프레임이 이보다 낮으면 max-h-full로 프레임 높이에 맞추고, 넘치는 본문만 안에서 스크롤한다.
        className="relative flex h-[360px] max-h-full w-full flex-col rounded-t-[28px] bg-[#fefefe] p-[24px]"
      >
        <div className="flex h-[44px] shrink-0 items-center gap-[12px]">
          <h2 id="terms-sheet-title" className="flex-1 text-[20px] font-medium leading-[28px] text-[#111111]">
            약관 원문
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M5 5L17 17M17 5L5 17" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-[24px] min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Figma와 같은 위치에서 줄을 나눈다. break-keep은 폭이 좁아져도 단어 중간에서 끊기지 않게 한다. */}
          <p className="break-keep text-[28px] font-light leading-[38px] text-[#111111]">
            서비스 약관이
            <br />
            연결될 자리예요.
          </p>
        </div>
      </div>
    </div>
  )
}

export default TermsSheet
