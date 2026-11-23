import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

// Figma `DEVICE / Connection help`. 연결 값(배터리·마지막 확인)은 시안 예시라서 넣지 않는다. "이 시안에서는 …하지 않아요" 문구는 실제 동작과 같아서 Figma 문구를 그대로 둔다.
export function DeviceHelpPage() {
  const goBack = useMyBack(MY_ROUTES.device)
  return (
    <DeviceScreen title="오른쪽 인솔 확인" onBack={goBack} onConfirm={goBack}>
      <p className="mt-4 text-[16px] leading-[22px]">
        인솔을 휴대폰 가까이 두고 충전 상태를 확인해 주세요. 한쪽만 연결되어도 기본 러닝은 계속할 수 있어요.
      </p>
      <div className="mt-6 flex h-[64px] items-center gap-3">
        <span className="min-w-0 flex-1 text-[16px] leading-[24px]">오른쪽 연결 상태</span>
        <span className="shrink-0 text-[14px] leading-[22px] text-muted">연결 안 됨</span>
      </div>
      <div className="h-px bg-line" aria-hidden="true" />
      <p className="mt-6 text-[14px] leading-[20px] text-muted">
        이 시안에서는 Bluetooth 기기에 연결하지 않아요. 실제 재연결 상태는 앱에서 확인할 수 있어요.
      </p>
      <h3 className="mt-6 text-[18px] font-medium leading-[25px]">연결을 해제하면</h3>
      <p className="mt-3 text-[14px] leading-[20px] text-muted">새 자세 데이터는 수집되지 않지만 저장된 러닝 기록은 남아요. 이 시안에서는 실제 연결을 해제하지 않아요.</p>
    </DeviceScreen>
  )
}

export default DeviceHelpPage
