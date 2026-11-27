import chevronLeft from '../../assets/icons/chevron-left.svg'

export interface ScreenHeaderProps {
  title: string
  onBack: () => void
}

// Figma `header / 러닝 경험`, `header / 권한 안내`: 44px 높이, 뒤로가기 버튼 + 제목.
// 스크롤 시에도 항상 상단에 고정(sticky top-0)되도록 배경색과 z-index를 적용한다.
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <header className="sticky top-0 z-20 -mx-6 -mt-3 flex h-[56px] shrink-0 items-center gap-2 bg-app-bg/95 px-6 pt-3 backdrop-blur-xs">
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로 가기"
        className="flex size-[44px] shrink-0 cursor-pointer items-start p-[10px]"
      >
        <img src={chevronLeft} alt="" className="size-[24px]" aria-hidden="true" />
      </button>
      <h1 className="font-pace text-[16px] font-medium leading-[22px] text-ink">{title}</h1>
    </header>
  )
}

export default ScreenHeader
