import chevronLeft from '../../assets/icons/chevron-left.svg'

export interface ScreenHeaderProps {
  title: string
  onBack: () => void
}

// Figma `header / 러닝 경험`, `header / 권한 안내`: 44px 높이, 뒤로가기 버튼 + 제목.
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <header className="flex h-[44px] w-full items-center gap-2">
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
