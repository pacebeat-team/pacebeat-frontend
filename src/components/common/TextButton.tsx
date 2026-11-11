import type { ButtonHTMLAttributes } from 'react'

export interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

// Figma `button / 계정 만들기`, `button / 나중에 할게요`: 44px 높이의 텍스트 버튼.
export function TextButton({
  label,
  className = '',
  type = 'button',
  ...props
}: TextButtonProps) {
  return (
    <button
      type={type}
      className={`flex h-[44px] w-full cursor-pointer items-center justify-center font-pace text-[14px] leading-5 text-muted disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {label}
    </button>
  )
}

export default TextButton
