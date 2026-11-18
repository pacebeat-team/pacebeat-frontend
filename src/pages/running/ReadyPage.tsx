import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { formatDuration, formatPace } from '../../features/running/format'
import { getTargetPaceSecPerKm } from '../../features/running/goal'
import {
  describeLocationReadiness,
  getReadyActions,
  queryLocationReadiness,
} from '../../features/running/locationReadiness'
import type { LocationReadiness } from '../../features/running/locationReadiness'
import { findMusicTrack, formatTrackBpm } from '../../features/running/music'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { useRunStore } from '../../features/running/runStore'
import type { RunMode } from '../../features/running/types'

export function ReadyPage() {
  const navigate = useNavigate()
  const draft = useRunStore((state) => state.draft)
  const [readiness, setReadiness] = useState<LocationReadiness | null>(null)

  // 화면에 들어올 때 위치 사용 가능 여부를 확인한다(권한 요청은 하지 않는다).
  useEffect(() => {
    let cancelled = false
    void queryLocationReadiness().then((result) => {
      if (!cancelled) setReadiness(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const location = describeLocationReadiness(readiness)
  const actions = getReadyActions(readiness)
  const track = findMusicTrack(draft.musicTrackId)

  // 시작 신호만 보낸다. 카운트다운과 실제 세션 시작은 R3가 처리한다. 시간 기록은 사용자가 직접 눌러야만 시작 신호가 된다.
  const signal = useCallback(
    (mode: RunMode) => {
      runSetupStore.getState().signalStart(mode)
      navigate(RUN_PATHS.countdown)
    },
    [navigate],
  )

  const rows: readonly { title: string; status: string; detail: string }[] = [
    { title: 'GPS 신호', status: location.status, detail: location.detail },
    { title: '이어폰과 볼륨', status: '확인 필요', detail: '이어폰을 연결하고 볼륨을 확인해 주세요.' },
    { title: '음성 안내', status: '켜짐', detail: '진동은 이 기기에서 지원하지 않아요.' },
    { title: '스마트 인솔', status: '연결 안 됨', detail: '인솔 없이도 달릴 수 있어요' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-4 pt-3">
        <ScreenHeader title="출발 준비" onBack={() => navigate(RUN_PATHS.music)} />
        <h2 className="mt-4 text-[28px] font-light leading-[36px] text-ink">달릴 준비가 됐어요.</h2>

        <section aria-label="목표 요약" className="mt-4 rounded-[24px] bg-soft p-4">
          <p className="text-[24px] font-light leading-[32px] text-ink">
            {draft.distanceKm} km · {formatDuration(draft.targetDurationSec)}
          </p>
          <p className="mt-1 text-[14px] leading-5 text-muted">
            목표 페이스 {formatPace(getTargetPaceSecPerKm(draft.distanceKm, draft.targetDurationSec))} /km
          </p>
        </section>

        <ul className="mt-4 flex flex-col gap-3" aria-label="준비 상태">
          {rows.map((row) => (
            <li key={row.title} className="flex flex-col gap-1">
              <p className="text-[16px] font-medium leading-6 text-ink">
                {row.title} <span className="text-muted">· {row.status}</span>
              </p>
              <p className="text-[14px] leading-5 text-muted">{row.detail}</p>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[14px] leading-5 text-muted">
          음악 {track === null ? '없음' : formatTrackBpm(track)}
        </p>
      </div>

      <div className="flex flex-col gap-1 px-3 pb-3">
        <p className="px-4 pb-1 text-[13px] leading-[18px] text-muted">시작을 누르면 3초 후 러닝을 시작해요.</p>
        {actions.timeEmphasized ? (
          <>
            <PrimaryButton label="GPS 없이 시간만 기록" onClick={() => signal('time')} />
            <TextButton label="러닝 시작" disabled onClick={() => signal('gps')} />
          </>
        ) : (
          <>
            <PrimaryButton label="러닝 시작" disabled={actions.startDisabled} onClick={() => signal('gps')} />
            <TextButton label="GPS 없이 시간만 기록" onClick={() => signal('time')} />
          </>
        )}
        <p className="px-4 text-[13px] leading-[18px] text-muted">
          시간만 기록하면 목표 거리·시간은 적용되지 않아요.
        </p>
      </div>
    </div>
  )
}

export default ReadyPage
