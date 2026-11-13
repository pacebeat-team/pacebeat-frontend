export interface MetricBlockProps {
  label: string
  value: string
  unit?: string
  // lg: 34px(거리, 소요 시간), md: 32px(현재 페이스, 케이던스, 평균 보폭)
  size?: 'lg' | 'md'
}

// Figma `metric / ...`: 라벨(14px) + 큰 숫자 + 단위(13px).
export function MetricBlock({ label, value, unit, size = 'lg' }: MetricBlockProps) {
  const valueClassName =
    size === 'lg'
      ? 'text-[34px] leading-[39px] tracking-[-1.02px]'
      : 'text-[32px] leading-[37px] tracking-[-0.96px]'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <p className="text-[14px] leading-5 text-muted">{label}</p>
      <p className="flex items-baseline gap-[6px] whitespace-nowrap text-ink">
        <span className={`font-light ${valueClassName}`}>{value}</span>
        {unit && <span className="text-[13px] leading-[18px]">{unit}</span>}
      </p>
    </div>
  )
}

export default MetricBlock
