import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

export function ArrowRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronLeftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.2l2.5 2.5L16.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BackHeader({ title }: { title: string }) {
  const navigate = useNavigate()

  return (
    <header className="flex h-11 w-full items-center gap-2">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="이전 화면"
        className="flex h-11 w-11 items-center justify-center rounded-full active:bg-[#f4f4f6]"
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </button>
      <span className="text-[16px] font-medium leading-[22px]">{title}</span>
    </header>
  )
}

interface StepProgressProps {
  current: number
  label?: string
}

export function StepProgress({ current, label = '시작하기' }: StepProgressProps) {
  return (
    <div className="flex h-6 items-center justify-between text-[#626174]">
      <span className="text-[14px] leading-5">{label}</span>
      <span className="font-poppins text-[13px] font-medium leading-5">{current} / 3</span>
    </div>
  )
}

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function PrimaryButton({ children, disabled, className = '', ...props }: PrimaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex h-16 w-full items-center gap-3 rounded-full pl-7 pr-3 text-left text-[18px] font-medium leading-[25px] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[#dedee5] disabled:text-[#92919f] ${
        disabled ? 'bg-[#dedee5]' : 'bg-[#111] text-white'
      } ${className}`}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${disabled ? 'bg-[#f4f4f6]' : 'bg-white text-[#111]'}`}>
        <ArrowRightIcon className="h-6 w-6" />
      </span>
    </button>
  )
}

export function FixedFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-auto w-full shrink-0 bg-white px-3 pb-[calc(9px+env(safe-area-inset-bottom,0px))] pt-2">
      {children}
    </footer>
  )
}
