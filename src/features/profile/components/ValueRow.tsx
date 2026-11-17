import chevronRight from '../../../assets/icons/chevron-right.svg'
import { formatValue } from '../pickerOptions.ts'

// 값을 보여 주고 누르면 선택 시트가 열리는 행 (Figma field / 출생연도 · 키 · 몸무게).
// 왼쪽에 라벨과 "선택 항목", 오른쪽에 값과 단위, 맨 끝에 chevron이 있다. 값이 없으면 줄표를 보여 준다.

export interface ValueRowProps {
  label: string
  // 라벨 아래 작은 글씨. Figma에서는 "선택 항목"이다.
  hint: string
  value: number | null
  unit: string
  onClick: () => void
}

export function ValueRow({ label, hint, value, unit, onClick }: ValueRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`${label}, ${value === null ? '선택 안 함' : `${value} ${unit}`}`}
      className="flex h-[88px] w-full cursor-pointer items-center gap-[12px] text-left"
    >
      <span className="flex w-[126px] shrink-0 flex-col gap-[4px]">
        <span className="text-[16px] font-medium leading-[24px] text-[#111111]">{label}</span>
        <span className="text-[13px] font-normal leading-[18px] text-[#626174]">{hint}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-baseline justify-end gap-[6px] whitespace-nowrap">
        <span className="text-[28px] font-light leading-[40px] text-[#111111]">{formatValue(value)}</span>
        <span className="text-[16px] font-normal leading-[24px] text-[#626174]">{unit}</span>
      </span>
      <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
    </button>
  )
}

export default ValueRow
