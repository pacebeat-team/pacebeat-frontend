export interface StepIndicatorProps {
  label?: string
  current: number
  total: number
}

// Figma `progress / 시작하기`: 좌측 라벨 + 우측 "1 / 3".
export function StepIndicator({ label = '시작하기', current, total }: StepIndicatorProps) {
  return (
    <div
      className="flex h-[24px] w-full items-center gap-3 font-pace leading-5 text-muted"
      aria-label={`${total}단계 중 ${current}단계`}
    >
      <p className="min-w-0 flex-1 text-[14px]">{label}</p>
      <p className="shrink-0 text-[13px] font-medium">
        {current} / {total}
      </p>
    </div>
  )
}

export default StepIndicator
