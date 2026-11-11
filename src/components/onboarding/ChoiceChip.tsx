export interface ChoiceChipProps {
  label: string
  selected: boolean
  onSelect: () => void
}

// Figma `choice / 1회`, `2회`, `3회 이상`: 44px 높이의 알약형 선택 칩.
export function ChoiceChip({ label, selected, onSelect }: ChoiceChipProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex h-[44px] flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-5 text-ink transition-opacity active:opacity-[0.78] ${
        selected ? 'bg-lime' : 'bg-soft'
      }`}
    >
      {label}
    </button>
  )
}

export default ChoiceChip
