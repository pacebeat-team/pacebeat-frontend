import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[64px] items-center gap-3">
      <span className="min-w-0 flex-1 text-[16px] leading-6">{label}</span>
      <span className="shrink-0 text-[14px] leading-[22px] text-muted">{value}</span>
    </div>
  )
}

// Figma `MY / Data deletion`. 삭제 대상을 안내하기만 한다. 확인해도 어떤 데이터도 지우지 않고 데이터 관리 화면으로 돌아간다.
export function DataDeletePage() {
  const goBack = useMyBack(MY_ROUTES.data)
  return (
    <DeviceScreen title="데이터 삭제" onBack={goBack} onConfirm={goBack} confirmLabel="돌아가기">
      <p className="mt-4 text-[16px] leading-6">러닝 기록과 인솔 측정 데이터를 삭제하면 복원할 수 없어요.</p>
      <h3 className="mt-6 text-[18px] font-medium leading-[25px]">삭제 대상</h3>
      <div className="mt-3 flex flex-col">
        <InfoRow label="러닝 기록" value="거리 · 시간 · 리포트" />
        <div className="h-px bg-line" aria-hidden="true" />
        <InfoRow label="인솔 측정" value="자세 리포트" />
      </div>
      <p className="mt-6 text-[14px] leading-[20px] text-muted">
        이 시안에서는 실제 데이터를 삭제하지 않아요. 돌아가기를 누르면 데이터 관리 화면으로 돌아가요.
      </p>
    </DeviceScreen>
  )
}

export default DataDeletePage
