import type { ReactNode } from 'react'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'

// Figma DEVICE 화면의 공통 틀: 뒤로 가기(마이) + 34px Light 제목 + 내용. footer가 있으면 하단 CTA(확인)를 둔다.
export function DeviceScreen({
  title,
  onBack,
  onConfirm,
  confirmLabel = '확인',
  children,
}: {
  title: string
  onBack: () => void
  onConfirm?: () => void
  confirmLabel?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="마이" onBack={onBack} />
        <h2 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.02px]">{title}</h2>
        {children}
      </div>
      {onConfirm !== undefined && (
        <div className="shrink-0 px-3 pb-[9px] pt-2">
          <PrimaryButton label={confirmLabel} onClick={onConfirm} />
        </div>
      )}
    </div>
  )
}
