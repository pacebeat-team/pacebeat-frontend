import type { ButtonHTMLAttributes } from 'react'
import arrowRight from '../../assets/icons/arrow-right.svg'
import arrowRightDisabled from '../../assets/icons/arrow-right-disabled.svg'

export interface PrimaryButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
}

// Figma `button / primary`: 64px CTA, 좌 28px / 우 12px 패딩, 44px 원형 액션.
// Pressed는 시각 피드백(opacity 78%)만, Disabled는 클릭 불가.
export function PrimaryButton({
  label,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`flex h-[64px] w-full items-center gap-3 rounded-full py-[10px] pl-7 pr-3 text-left font-pace text-[18px] font-medium leading-[25px] transition-opacity ${
        disabled
          ? 'cursor-not-allowed bg-disabled-surface text-disabled-text'
          : 'cursor-pointer bg-ink text-app-bg active:opacity-[0.78]'
      } ${className}`}
      {...props}
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-app-bg">
        <img
          src={disabled ? arrowRightDisabled : arrowRight}
          alt=""
          className="size-[24px]"
          aria-hidden="true"
        />
      </span>
    </button>
  )
}

export default PrimaryButton
