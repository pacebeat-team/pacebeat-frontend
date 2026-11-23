import type { ReactNode } from 'react'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'

// Figma DEVICE 화면의 공통 틀: 뒤로 가기(마이) + 34px Light 제목 + 내용. footer가 있으면 하단 CTA(확인)를 둔다.
export function DeviceScreen({
  title,
  onBack,
  onConfirm,
  confirmLabel = '확인',
  confirmDisabled = false,
  secondary,
  children,
}: {
  title: string
  onBack: () => void
  onConfirm?: () => void
  confirmLabel?: string
  // 주요 버튼을 누를 수 없게 한다(기본은 눌림)
  confirmDisabled?: boolean
  // 주요 버튼 아래의 보조 버튼(예: 돌아가기)
  secondary?: { label: string; onClick: () => void }
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
          <PrimaryButton label={confirmLabel} onClick={onConfirm} disabled={confirmDisabled} />
          {secondary !== undefined && <TextButton label={secondary.label} onClick={secondary.onClick} />}
        </div>
      )}
    </div>
  )
}
