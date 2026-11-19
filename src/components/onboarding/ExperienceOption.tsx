import radio from '../../assets/icons/radio.svg'
import radioChecked from '../../assets/icons/radio-checked.svg'
import radioDot from '../../assets/icons/radio-dot.svg'

export interface ExperienceOptionProps {
  title: string
  description: string
  selected: boolean
  onSelect: () => void
}

// Figma `choice / ...`: 84px 높이의 라디오 선택 행.
export function ExperienceOption({
  title,
  description,
  selected,
  onSelect,
}: ExperienceOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex h-[84px] w-full cursor-pointer items-center gap-[14px] text-left"
    >
      <span className="relative size-[24px] shrink-0">
        <img
          src={selected ? radioChecked : radio}
          alt=""
          className="size-[24px]"
          aria-hidden="true"
        />
        {selected && (
          <img
            src={radioDot}
            alt=""
            className="absolute left-[6px] top-[6px] size-[12px]"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className="text-[18px] font-medium leading-[24px] text-ink">{title}</span>
        <span className="text-[14px] leading-5 text-muted">{description}</span>
      </span>
    </button>
  )
}

export default ExperienceOption
