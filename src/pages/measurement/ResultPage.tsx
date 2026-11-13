import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import circleCheck from '../../assets/icons/circle-check.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { MetricBlock } from '../../components/measurement/MetricBlock'
import {
  formatDistanceKm,
  formatDuration,
  formatInteger,
  formatMeters,
  formatPace,
  PLACEHOLDER,
} from '../../features/measurementView/format'
import type { GpsStatus, MeasurementQuality } from '../../features/measurementView/types'
import { useMeasurementView } from '../../features/measurementView/useMeasurementView'

// TODO: Figma에는 "품질 양호 · GPS 안정"만 디자인되어 있다. 나머지 문구는 임시이며 디자인 확인이 필요하다.
const QUALITY_LABELS: Record<MeasurementQuality, string> = {
  good: '양호',
  fair: '보통',
  poor: '낮음',
}

const GPS_RESULT_LABELS: Record<GpsStatus, string> = {
  good: '안정',
  weak: '불안정',
  lost: '끊김 있음',
  unavailable: '사용 불가',
}

export function ResultPage() {
  const navigate = useNavigate()
  const { view } = useMeasurementView()
  const { result } = view

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const handleStartGoal = useCallback(() => {
    // TODO: Figma는 RUN / Music(러닝 목표 설정 이후)으로 이동한다. 해당 화면이 아직 없어
    //       목적지를 임의로 만들지 않고 동작하지 않는다. (연결은 통합 Issue, 기획 확인 필요)
  }, [])

  const handleHome = useCallback(() => {
    navigate('/home')
  }, [navigate])

  // "예시 측정 · 품질 양호 · GPS 안정" (예시 표기는 예시 데이터일 때만)
  const qualityText = [
    view.isSample ? '예시 측정' : null,
    result.quality ? `품질 ${QUALITY_LABELS[result.quality]}` : '품질 정보 없음',
    result.gpsStatus ? `GPS ${GPS_RESULT_LABELS[result.gpsStatus]}` : null,
  ]
    .filter((text): text is string => text !== null)
    .join(' · ')

  const firstGoal = result.firstGoal
  const hasBaseline = result.baselinePaceSecPerKm !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="기초 측정 결과" onBack={handleBack} />

        <h2 className="mt-4 text-[36px] font-light leading-[44px] tracking-[-1.08px] text-ink">
          나의 기준을
          <br />
          찾았어요.
        </h2>

        {/* Figma result / baseline pace: 기준 페이스 카드 */}
        <section className="relative mt-4 flex h-[180px] w-full shrink-0 flex-col gap-2 overflow-hidden rounded-[28px] border border-[rgba(219,224,209,0.32)] bg-[linear-gradient(157.07deg,#000_22.28%,#1a1a18_103.14%)] p-[22px] shadow-[inset_0_-5px_8px_rgba(0,0,0,0.65),inset_0_2px_3px_rgba(255,255,242,0.22)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_138px_at_100%_0,rgba(217,224,204,0.12)_0%,rgba(217,224,204,0.035)_55%,rgba(217,224,204,0)_100%)]"
          />
          <p className="relative text-[16px] font-medium leading-6 text-app-bg">기준 페이스</p>
          <p className="relative flex h-[81px] items-baseline gap-[6px] whitespace-nowrap text-app-bg">
            <span className="text-[70px] font-light leading-[81px] tracking-[-2.1px]">
              {formatPace(result.baselinePaceSecPerKm)}
            </span>
            {hasBaseline && <span className="text-[24px] leading-[29px]">/km</span>}
          </p>
          <div className="relative h-[3px] w-full rounded-sm bg-lime" />
        </section>

        <div className="mt-6 flex gap-8">
          <MetricBlock
            label="달린 거리"
            value={formatDistanceKm(result.distanceM)}
            unit={result.distanceM === null ? undefined : 'km'}
          />
          <MetricBlock label="소요 시간" value={formatDuration(result.elapsedSec)} />
        </div>

        <div className="mt-6 flex gap-8">
          <MetricBlock
            label="케이던스"
            value={formatInteger(result.cadenceSpm)}
            unit={result.cadenceSpm === null ? undefined : 'spm'}
            size="md"
          />
          <MetricBlock
            label="평균 보폭"
            value={formatMeters(result.strideM)}
            unit={result.strideM === null ? undefined : 'm'}
            size="md"
          />
        </div>

        <div className="mt-5 flex items-start gap-2">
          <img src={circleCheck} alt="" className="size-[18px] shrink-0" aria-hidden="true" />
          <p className="min-w-0 text-[13px] leading-5 text-muted">{qualityText}</p>
        </div>

        <hr className="my-5 border-0 border-t border-line" />

        <p className="text-[14px] leading-5 text-muted">첫 목표</p>
        <p className="mt-1 text-[30px] font-light leading-[42px] tracking-[-0.9px] text-ink">
          {firstGoal ? `${firstGoal.distanceKm} km · ${formatDuration(firstGoal.durationSec)}` : PLACEHOLDER}
        </p>
        {firstGoal && hasBaseline && (
          <p className="mt-2 text-[14px] leading-[21px] text-muted">
            페이스는 {formatPace(result.baselinePaceSecPerKm)}/km 그대로,
            <br />
            편하게 달린 기록을 기준으로 추천해요.
          </p>
        )}

        <div className="mt-3">
          <TextButton label="홈으로" onClick={handleHome} />
        </div>
      </div>

      <footer className="px-3 pb-[9px] pt-2">
        {/* 첫 목표가 없으면 시작할 목표가 없으므로 비활성화한다. */}
        <PrimaryButton label="이 목표로 시작" disabled={firstGoal === null} onClick={handleStartGoal} />
      </footer>
    </div>
  )
}

export default ResultPage
