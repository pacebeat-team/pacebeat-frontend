import { Link } from 'react-router-dom'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

function LinkRow({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex h-[64px] w-full items-center gap-3 text-left">
      <span className="min-w-0 flex-1 text-[16px] leading-6">{label}</span>
      <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
    </Link>
  )
}

const Line = () => <div className="h-px bg-line" aria-hidden="true" />

// Figma `MY / Data management`.
export function DataPage() {
  const goBack = useMyBack(MY_ROUTES.root)
  return (
    <DeviceScreen title="내 데이터" onBack={goBack} onConfirm={() => goBack()} confirmLabel="마이로 돌아가기">
      <p className="mt-4 text-[18px] leading-[25px]">나의 기록을 확인하고, 필요한 데이터를 직접 관리해요.</p>
      <div className="mt-6 flex flex-col">
        <LinkRow to="/records" label="러닝 기록 보기" />
        <Line />
        <LinkRow to={MY_ROUTES.dataExport} label="데이터 내보내기" />
        <Line />
        <LinkRow to={MY_ROUTES.dataDelete} label="데이터 삭제" />
      </div>
      <p className="mt-6 text-[14px] leading-[20px] text-muted">러닝 기록과 인솔 측정 데이터가 포함돼요.</p>
    </DeviceScreen>
  )
}

export default DataPage
