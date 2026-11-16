import checkIcon from '../../../assets/icons/check.svg'

// 가입 동의 화면의 한 줄. 체크 영역(토글)과 "보기"(약관 상세)는 서로 다른 버튼이라 동작이 섞이지 않는다.
// variant 'all'은 "전체 동의하기" 행이다. (체크 24px, 제목 18px + 설명 13px)

interface BaseProps {
  checked: boolean
  onToggle: () => void
}

interface ItemProps extends BaseProps {
  variant?: 'item'
  label: string
  // 있으면 오른쪽에 "보기" 버튼을 보여 준다. 만 14세 이상 항목처럼 상세가 없으면 넘기지 않는다.
  onView?: () => void
}

interface AllProps extends BaseProps {
  variant: 'all'
  label: string
  description: string
}

export type ConsentRowProps = ItemProps | AllProps

function CheckCircle({ checked, size }: { checked: boolean; size: 22 | 24 }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border border-solid ${
        size === 24 ? 'size-[24px]' : 'size-[22px]'
      } ${checked ? 'border-[#111111] bg-[#111111]' : 'border-[#dedee5] bg-[#fefefe]'}`}
    >
      {checked && <img src={checkIcon} alt="" className="size-[16px]" />}
    </span>
  )
}

export function ConsentRow(props: ConsentRowProps) {
  const { checked, onToggle, label } = props

  if (props.variant === 'all') {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex h-[64px] w-full cursor-pointer items-center gap-[14px] text-left"
      >
        <CheckCircle checked={checked} size={24} />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[18px] font-medium leading-[26px] text-[#111111]">{label}</span>
          <span className="text-[13px] font-normal leading-[19px] text-[#626174]">{props.description}</span>
        </span>
      </button>
    )
  }

  const { onView } = props
  return (
    <div className="flex h-[56px] w-full items-center gap-[10px]">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[12px] text-left"
      >
        <CheckCircle checked={checked} size={22} />
        <span className="min-w-0 flex-1 text-[15px] font-normal leading-[22px] text-[#111111]">{label}</span>
      </button>
      {onView && (
        <button
          type="button"
          onClick={onView}
          aria-label={`${label} 보기`}
          className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center text-[13px] font-normal leading-[20px] text-[#626174]"
        >
          보기
        </button>
      )}
    </div>
  )
}

export default ConsentRow
