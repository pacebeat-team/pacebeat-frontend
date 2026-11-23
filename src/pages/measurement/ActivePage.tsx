import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import mascot from '../../assets/images/mascot-p.png'
import music from '../../assets/icons/music.svg'
import stateActive from '../../assets/icons/state-active.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { TextButton } from '../../components/common/TextButton'
import { MetricBlock } from '../../components/measurement/MetricBlock'
import {
  formatClock,
  formatDistanceKm,
  formatInteger,
  formatPace,
  formatWholeMinutes,
  getProgressRatio,
  PLACEHOLDER,
} from '../../features/measurementView/format'
import { describeActiveGps, describeRestoreHint } from '../../features/measurementView/activeCopy'
import { useAttachRestoredSession, useMeasurementView, useStopOnLeave } from '../../features/measurementView/useMeasurementView'

export function ActivePage() {
  const navigate = useNavigate()
  const { view, actions, isVirtual, sessionStatus, restore } = useMeasurementView()
  const { active } = view

  // 측정 화면을 떠날 때 진행 중인 측정을 정리한다. (뒤로가기 등)
  useStopOnLeave()
  // 새로고침으로 복원된 세션이면 GPS 재확인을 시작한다.
  useAttachRestoredSession()

  // 화면 이동은 이 effect 한 곳에서만 한다. 사용자 종료와 가상 시나리오 완료는 모두 세션이 종료 상태가 되는 것으로
  // 나타나므로, 어느 쪽이든 여기서 Result로 이동한다. (replace라서 개발 환경 StrictMode의 이중 실행에도 안전하다.)
  // 세션이 없으면(주소로 직접 진입, 새로고침) 측정할 것이 없으므로 Guide로 보낸다.
  useEffect(() => {
    if (sessionStatus === 'finished') {
      navigate('/measurement/result', { replace: true })
    } else if (sessionStatus === null) {
      navigate('/measurement/guide', { replace: true })
    }
  }, [sessionStatus, navigate])

  const handleStop = useCallback(() => {
    // Figma: 확인 없이 종료한다. (종료 확인 팝업 필요 여부는 기획 확인 필요) 이동은 위 effect가 한다.
    actions.stop()
  }, [actions])

  const progress = getProgressRatio(active.elapsedSec, active.targetDurationSec)
  const minSave = formatWholeMinutes(active.minSaveSec)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(155.4deg,#c4fa3f_32.82%,#e4ffa5_108.52%)] font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        {/* 측정 상태와 GPS 상태 */}
        <div className="flex h-[36px] items-center gap-[10px]">
          <img src={stateActive} alt="" className="size-[7px] shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[17px] font-medium leading-6 text-ink">
            {restore ? '기초 측정 일시정지' : '기초 측정 중'}
            {isVirtual && ' · 가상 데이터'}
          </p>
          <p className="text-[13px] leading-5 text-ink">
            GPS {describeActiveGps(active.gpsStatus) ?? PLACEHOLDER}
          </p>
        </div>

        {/* 경과 시간 / 측정 시간, 진행 바 */}
        <p className="mt-9 text-[92px] font-light leading-[112px] tracking-[-2.76px] text-ink">
          {formatClock(active.elapsedSec)}
        </p>
        <p className="text-[22px] leading-8 text-ink">/ {formatClock(active.targetDurationSec)}</p>

        <div
          role="progressbar"
          aria-label="측정 진행률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="relative mt-6 h-1 w-full overflow-hidden rounded-sm bg-[#eafab7]"
        >
          <div
            className="absolute left-0 top-0 h-1 rounded-sm bg-ink"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="mt-[30px] flex h-[112px] items-center gap-5">
          <img
            src={mascot}
            alt="P! 마스코트"
            className="pointer-events-none h-[104px] w-[78px] shrink-0 object-contain"
          />
          <p className="min-w-0 text-[20px] leading-[29px] text-ink">
            대화할 수 있을 정도로
            <br />
            편하게 달려 주세요.
          </p>
        </div>

        {/* 거리, 현재 페이스, 케이던스 */}
        <div className="mt-7 flex gap-8">
          <MetricBlock
            label="거리"
            value={formatDistanceKm(active.distanceM)}
            unit={active.distanceM === null ? undefined : 'km'}
          />
          <MetricBlock
            label="현재 페이스"
            value={formatPace(active.currentPaceSecPerKm)}
            unit={active.currentPaceSecPerKm === null ? undefined : '/km'}
            size="md"
          />
        </div>

        <div className="mt-[22px] flex items-baseline gap-3 text-ink">
          <p className="min-w-0 flex-1 text-[14px] leading-5">케이던스</p>
          <p className="whitespace-nowrap text-[20px] font-light leading-[28px]">
            {formatInteger(active.cadenceSpm)}
            {active.cadenceSpm !== null && ' spm'}
          </p>
        </div>

        <hr className="my-[22px] border-0 border-t border-ink" />

        <div className="flex items-start gap-[10px]">
          <img src={music} alt="" className="size-[20px] shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1 text-ink">
            <p className="text-[15px] font-medium leading-[22px]">박자 안내 꺼짐</p>
            <p className="text-[13px] leading-5">측정 중에는 박자를 맞추지 않아요.</p>
          </div>
        </div>
      </div>

      <footer className="flex flex-col px-3 pb-[9px] pt-2">
        {/* 새로고침으로 복원된 세션만: GPS가 다시 확인된 뒤 사용자가 직접 이어간다. (TODO: Figma에 없는 상태라 문구는 임시) */}
        {restore && (
          <>
            <p className="px-4 pb-2 text-[13px] leading-5 text-ink">
              {describeRestoreHint(restore.canResume)}
            </p>
            <PrimaryButton label="측정 이어가기" disabled={!restore.canResume} onClick={actions.resume} />
          </>
        )}
        <TextButton label="측정 그만하기" onClick={handleStop} />
        {/* 최소 저장 시간이 있을 때만 안내한다. "예시 기준"은 예시 데이터일 때만 붙인다. */}
        {minSave && (
          <p className="text-[13px] leading-[18px] text-ink">
            {minSave} 이상 기록부터 저장{view.isSample && ' · 예시 기준'}
          </p>
        )}
      </footer>
    </div>
  )
}

export default ActivePage
