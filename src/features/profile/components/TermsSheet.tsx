import { useEffect, useRef } from 'react'

// 약관 원문 Bottom Sheet. 실제 약관이 연결되기 전까지는 자리 표시 문구만 보여 준다.
// 가장 가까운 position 조상(AppLayout 프레임) 안에 가둬서 그리므로 앱 프레임 밖으로 넘치지 않는다.
// 닫기: 닫기 버튼, 딤 영역 클릭, Escape 키.

export interface TermsSheetProps {
  onClose: () => void
}

export function TermsSheet({ onClose }: TermsSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // 열리면 닫기 버튼으로 포커스를 옮기고, 닫히면 열기 전에 포커스가 있던 요소로 돌려 준다.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label="약관 원문 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-[#111111] opacity-[0.32]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-sheet-title"
        className="relative flex min-h-[360px] w-full flex-col rounded-t-[28px] bg-[#fefefe] p-[24px]"
      >
        <div className="flex h-[44px] items-center gap-[12px]">
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
        <p className="mt-[24px] text-[28px] font-light leading-[38px] text-[#111111]">
          서비스 약관이 연결될 자리예요.
        </p>
      </div>
    </div>
  )
}

export default TermsSheet
