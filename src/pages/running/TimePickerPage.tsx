import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { formatDurationKorean, formatPace } from '../../features/running/format'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runStore, useRunStore } from '../../features/running/runStore'
import { buildTimeRows } from '../../features/running/timePicker'

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
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-4 pt-3">
        <ScreenHeader title="목표 시간" onBack={handleBack} />
        <h2 className="mt-4 text-[28px] font-light leading-[36px] text-ink">몇 분 동안 달릴까요?</h2>
        <p className="mt-1 text-[14px] leading-5 text-muted">거리 {distanceKm} km 기준</p>

        <ul role="listbox" aria-label="목표 시간 목록" className="mt-4 flex flex-col gap-2">
          {rows.map((row) => {
            const selected = row.durationSec === currentSec
            return (
              <li key={row.durationSec} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(row.durationSec)}
                  className={`flex h-[52px] w-full cursor-pointer items-center justify-between rounded-[18px] px-4 text-[16px] ${
                    selected ? 'bg-ink text-app-bg' : 'bg-soft text-ink'
                  }`}
                >
                  <span className="font-medium">{formatDurationKorean(row.durationSec)}</span>
                  <span className="text-[14px] opacity-80">
                    {formatPace(row.paceSecPerKm)} /km{row.recommended ? ' · 추천' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="px-3 pb-3">
        <TextButton label="돌아가기" onClick={handleBack} />
      </div>
    </div>
  )
}

export default TimePickerPage
