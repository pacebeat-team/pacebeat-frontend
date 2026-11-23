import { Link } from 'react-router-dom'
import chevronRight from '../../assets/icons/chevron-right.svg'
import dotDisconnected from '../../assets/my/dot-disconnected.svg'
import insoleLeft from '../../assets/my/insole-left.svg'
import insoleRight from '../../assets/my/insole-right.svg'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

function InsoleCard({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex w-[137px] flex-col gap-[10px]">
      <span className="-scale-x-100 block h-[56px] w-[40px]">
        <img src={icon} alt="" aria-hidden="true" className="size-full" />
      </span>
      <p className="text-[18px] font-medium leading-[25px]">{label}</p>
      <p className="flex h-[24px] items-center gap-[7px] text-[14px] leading-[20px]">
        <img src={dotDisconnected} alt="" aria-hidden="true" className="size-[7px]" />
        연결 안 됨
      </p>
    </div>
  )
}

function ActionRow({ to, label, value }: { to: string; label: string; value: string }) {
  return (
    <Link to={to} className="flex h-[64px] w-full items-center gap-3 text-left">
      <span className="min-w-0 flex-1 text-[16px] leading-[24px]">{label}</span>
      <span className="shrink-0 text-right text-[14px] leading-[22px] text-muted">{value}</span>
      <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
    </Link>
  )
}

// Figma `DEVICE / Insoles`. Bluetooth 연결은 아직 없어 두 인솔 모두 "연결 안 됨"으로 보여 준다.
// Figma의 연결됨·배터리·마지막 확인·마지막 보정 값은 시안 예시라서 만들어 보이지 않는다.
export function DeviceInsolesPage() {
  const goBack = useMyBack(MY_ROUTES.root)
  return (
    <DeviceScreen title="스마트 인솔" onBack={goBack}>
      <section aria-label="인솔 연결 상태" className="mt-[18px] flex gap-5 rounded-[28px] bg-soft p-6">
        <InsoleCard label="왼쪽" icon={insoleLeft} />
        <InsoleCard label="오른쪽" icon={insoleRight} />
      </section>
      <div className="mt-5 flex flex-col">
        <ActionRow to={MY_ROUTES.deviceHelp} label="오른쪽 인솔" value="다시 연결" />
        <div className="h-px bg-line" aria-hidden="true" />
        <ActionRow to={MY_ROUTES.deviceCalibration} label="센서 보정" value="다시 보정" />
        <div className="mt-6 h-px bg-line" aria-hidden="true" />
        <p className="mt-[18px] text-[14px] leading-[20px] text-muted">
          자세 데이터는 인솔을 연결한 뒤의 러닝부터 쌓여요. 지난 러닝에는 새로 생기지 않아요.
        </p>
        <Link to={MY_ROUTES.deviceHelp} className="mt-3 flex h-[44px] items-center justify-center text-[14px] leading-[20px] text-muted">
          연결 관리 안내
        </Link>
      </div>
    </DeviceScreen>
  )
}

export default DeviceInsolesPage
