import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import running from '../../assets/icons/running.svg'
import signal from '../../assets/icons/signal.svg'
import volume2 from '../../assets/icons/volume-2.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { PermissionItem } from '../../components/onboarding/PermissionItem'
import { StepIndicator } from '../../components/onboarding/StepIndicator'
import { checkMotionFitnessSupport, requestLocationPermission } from '../../lib/permissions'
import { useOnboardingStore } from '../../stores/onboardingStore'

// TODO: 측정 Guide 화면이 구현되면 해당 경로로 교체한다. (이동 목적지 미확정)
const NEXT_PATH = '/home'

export function PermissionsPage() {
  const navigate = useNavigate()
  const [isRequesting, setIsRequesting] = useState(false)
  const setLocationPermission = useOnboardingStore((state) => state.setLocationPermission)
  const setMotionFitnessSupport = useOnboardingStore((state) => state.setMotionFitnessSupport)

  // 이 화면이 아직 유효한지 추적한다. 건너뛰기/뒤로 가기/언마운트 후 늦게 도착한
  // 권한 응답으로 저장이나 페이지 이동이 일어나지 않게 하기 위함이다.
  const isActiveRef = useRef(false)

  useEffect(() => {
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
    }
  }, [])

  const handleBack = useCallback(() => {
    isActiveRef.current = false
    navigate('/onboarding/experience')
  }, [navigate])

  const handleContinue = useCallback(async () => {
    if (isRequesting) return
    setIsRequesting(true)

    // 위치 권한을 요청하고, 허용/거부 어느 쪽이든 다음 단계로 이동한다. (거부 시 시간 전용 상태 저장)
    // 응답이 없으면 일정 시간 뒤 null로 끝나며, 이 경우에도 다음 단계로 이동한다.
    const locationPermission = await requestLocationPermission()

    // 대기 중에 사용자가 건너뛰거나 뒤로 이동했다면 저장과 이동을 하지 않는다.
    if (!isActiveRef.current) return

    setLocationPermission(locationPermission)
    setMotionFitnessSupport(checkMotionFitnessSupport())

    navigate(NEXT_PATH, { replace: true })
  }, [isRequesting, navigate, setLocationPermission, setMotionFitnessSupport])

  const handleSkip = useCallback(() => {
    // "나중에 할게요": 권한을 요청하지 않으므로 저장값은 null로 유지한다.
    // 이미 진행 중인 권한 요청은 취소할 수 없지만, 이후 도착하는 응답은 무시한다.
    isActiveRef.current = false
    navigate(NEXT_PATH, { replace: true })
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="권한 안내" onBack={handleBack} />

        <div className="mt-3">
          <StepIndicator current={2} total={3} />
        </div>

        <h2 className="mt-3 text-[36px] font-light leading-[46px] tracking-[-1.08px] text-ink">
          달리는 동안
          <br />
          필요한 것들
        </h2>
        <p className="mt-[10px] text-[15px] leading-[22px] text-muted">
          허용하지 않아도 앱은 쓸 수 있어요.
        </p>

        <div className="mt-7">
          <PermissionItem
            icon={signal}
            title="위치"
            tag="거리·페이스 기록에 필요"
            descriptions={[
              '러닝 중 이동한 거리와 페이스를 계산해요.',
              '허용하지 않으면 시간만 기록해요.',
            ]}
          />
        </div>

        <hr className="my-6 border-0 border-t border-line" />

        <PermissionItem
          icon={running}
          title="동작 및 피트니스"
          tag="선택 · 지원 기기에서만"
          descriptions={['발걸음으로 케이던스를 측정해요.', '지원하지 않는 기기에서는 생략돼요.']}
        />

        <hr className="my-6 border-0 border-t border-line" />

        <p className="text-[14px] leading-[21px] text-muted">
          위치 기록은 러닝 중에만 남겨요.
          <br />
          마이의 데이터 관리에서 조회하거나 지울 수 있어요.
        </p>

        <div className="mt-4 flex items-start gap-[10px]">
          <img src={volume2} alt="" className="size-[20px] shrink-0" aria-hidden="true" />
          <p className="text-[14px] leading-[21px] text-muted">
            음악·음성 안내는 앱 안에서 설정해요.
          </p>
        </div>
      </div>

      <footer className="flex flex-col px-3 pb-[9px] pt-2">
        <PrimaryButton
          label="권한 확인하고 계속"
          disabled={isRequesting}
          onClick={handleContinue}
        />
        <TextButton label="나중에 할게요" onClick={handleSkip} />
      </footer>
    </div>
  )
}

export default PermissionsPage
