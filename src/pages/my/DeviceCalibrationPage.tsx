import { Link } from 'react-router-dom'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

// Figma `DEVICE / Calibration`. 안내만 제공하고 센서 값을 바꾸지 않는다.
export function DeviceCalibrationPage() {
  const goBack = useMyBack(MY_ROUTES.device)
  return (
    <DeviceScreen title="센서 재보정" onBack={goBack} onConfirm={goBack}>
      <p className="mt-4 text-[16px] leading-[22px]">연결된 인솔의 보정 안내에 따라 진행해 주세요. 기기마다 보정 방법이 다를 수 있어요.</p>
      <p className="mt-6 text-[18px] font-medium leading-[25px]">오른쪽 인솔을 먼저 연결해 주세요.</p>
      <Link to={MY_ROUTES.deviceHelp} className="mt-4 flex h-[44px] items-center justify-center text-[14px] leading-[20px] text-muted">
        오른쪽 연결 확인
      </Link>
      <p className="mt-4 text-[14px] leading-[20px] text-muted">이 시안은 보정 안내만 제공하며 센서 값을 변경하지 않아요.</p>
    </DeviceScreen>
  )
}

export default DeviceCalibrationPage
