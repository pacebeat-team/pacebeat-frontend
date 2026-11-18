import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { formatDurationKorean, formatPace } from '../../features/running/format'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runStore, useRunStore } from '../../features/running/runStore'
import { buildTimeRows } from '../../features/running/timePicker'
import { RunFooter } from './RunFooter'

// Figma `RUN / Time picker`: 시간 행을 누르면 그 값을 목표로 반영하고 Goal로 돌아간다.
// 헤더 뒤로 가기와 "돌아가기"는 목표를 바꾸지 않고 Goal로 돌아간다. (확정 버튼·임시 선택 없음)
export function TimePickerPage() {
  const navigate = useNavigate()
  const distanceKm = useRunStore((state) => state.draft.distanceKm)
  const currentSec = useRunStore((state) => state.draft.targetDurationSec)
  const rows = useMemo(() => buildTimeRows(distanceKm), [distanceKm])

  const handleSelect = useCallback(
    (durationSec: number) => {
      runStore.getState().setTargetDuration(durationSec)
      navigate(RUN_PATHS.goal, { replace: true })
    },
    [navigate],
  )

  const handleBack = useCallback(() => {
    navigate(RUN_PATHS.goal, { replace: true })
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="목표 시간" onBack={handleBack} />
        <h2 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px] text-ink">
          몇 분 동안
          <br />
          달릴까요?
        </h2>
        <p className="mt-4 text-[15px] leading-6 text-muted">시간을 선택하면 목표 페이스도 바뀌어요.</p>

        <ul aria-label="목표 시간 목록" className="mt-6 flex flex-col">
          {rows.map((row) => (
            <li key={row.durationSec} className="border-b border-line last:border-b-0">
              <button
                type="button"
                aria-current={row.durationSec === currentSec ? 'true' : undefined}
                onClick={() => handleSelect(row.durationSec)}
                className="flex h-[64px] w-full cursor-pointer items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1 text-[16px] leading-6 text-ink">{formatDurationKorean(row.durationSec)}</span>
                <span className="shrink-0 text-[14px] leading-[22px] text-muted">
                  {formatPace(row.paceSecPerKm)} /km{row.recommended ? ' · 추천' : ''}
                </span>
                <img src={chevronRight} alt="" className="size-[20px] shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-7 text-[14px] leading-5 text-muted">거리 {distanceKm} km 기준</p>
      </div>

      <RunFooter>
        <PrimaryButton label="돌아가기" onClick={handleBack} />
      </RunFooter>
    </div>
  )
}

export default TimePickerPage
