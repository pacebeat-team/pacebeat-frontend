import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import footprint from '../../assets/icons/footprint.svg'
import headphones from '../../assets/icons/headphones.svg'
import musicIcon from '../../assets/icons/music.svg'
import signal from '../../assets/icons/signal.svg'
import volume2 from '../../assets/icons/volume-2.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { formatDistanceKm, formatDuration, formatPace } from '../../features/running/format'
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
import { useGuidanceSettings } from '../../features/my/guidanceSettingsStore'
import { useRunStore } from '../../features/running/runStore'
import type { RunMode } from '../../features/running/types'
import { RunFooter } from './RunFooter'

// Figma `RUN / Ready`. 위치(GPS) 항목만 실제 확인 결과를 보여 준다.
// 음성 안내는 저장된 안내 설정(켜짐/꺼짐)을 보여 준다. 켜짐 문구는 Figma 그대로이고, 꺼짐 문구는 Figma에 없어 같은 형식의 임시 문구이다(docs/unconfirmed-copy.md).
// 이어폰·스마트 인솔은 Figma 문구를 그대로 쓰는 정적 표시이다(실제 기기 상태가 아니다. 후속 Issue에서 연결).
export function ReadyPage() {
  const navigate = useNavigate()
  const draft = useRunStore((state) => state.draft)
  const voiceGuide = useGuidanceSettings((state) => state.voiceGuide)
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
  const signalStart = useCallback(
    (mode: RunMode) => {
      runSetupStore.getState().signalStart(mode)
      navigate(RUN_PATHS.countdown)
    },
    [navigate],
  )

  const rows: readonly { title: string; icon: string; detail: string }[] = [
    { title: 'GPS 신호', icon: signal, detail: `${location.status} · ${location.detail}` },
    { title: '이어폰과 볼륨', icon: headphones, detail: '연결됨 · 볼륨 60%' },
    { title: '음성 안내', icon: volume2, detail: `${voiceGuide ? '켜짐' : '꺼짐'} · 진동은 이 기기에서 지원하지 않아요.` },
    { title: '스마트 인솔', icon: footprint, detail: '연결 안 됨 · 인솔 없이도 달릴 수 있어요.' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="출발 준비" onBack={() => navigate(RUN_PATHS.music)} />
        <h2 className="mt-4 text-[30px] font-light leading-[44px] tracking-[-0.9px] text-ink">달릴 준비가 됐어요.</h2>

        <section aria-label="목표 요약" className="mt-4 flex h-[82px] items-center gap-[14px]">
          <p className="flex w-[174px] shrink-0 items-baseline gap-[6px] text-ink">
            <span className="inline-block min-w-[75px] text-[56px] font-light leading-[64px] tracking-[-1.68px]">{formatDistanceKm(draft.distanceKm)}</span>
            <span className="text-[19px] leading-[27px]">km</span>
          </p>
          <div className="flex w-[154px] min-w-0 flex-col gap-[3px]">
            <p className="text-[23px] leading-8 text-ink">{formatDuration(draft.targetDurationSec)}</p>
            <p className="text-[14px] leading-5 text-muted">
              목표 {formatPace(getTargetPaceSecPerKm(draft.distanceKm, draft.targetDurationSec))} /km
            </p>
          </div>
        </section>

        <ul aria-label="준비 상태" className="mt-[18px] flex flex-col">
          {rows.map((row) => (
            <li key={row.title} className="flex h-[60px] items-center gap-[14px]">
              <img src={row.icon} alt="" className="size-[22px] shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <p className="text-[16px] font-medium leading-[22px] text-ink">{row.title}</p>
                <p className="text-[13px] leading-[19px] text-muted">{row.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <hr className="mt-[18px] border-0 border-t border-line" />

        <div className="mt-4 flex h-[40px] items-center gap-3">
          <img src={musicIcon} alt="" className="size-[22px] shrink-0" aria-hidden="true" />
          <p className="text-[15px] leading-[21px] text-ink">{track === null ? '음악 없이 달리기' : formatTrackBpm(track)}</p>
        </div>
        <p className="text-[13px] leading-5 text-muted">시작을 누르면 3초 후 러닝을 시작해요.</p>
        {/* Figma 기본 상태에는 없는 안내다. 위치를 쓸 수 없어 시간 기록을 강조할 때만 덧붙인다. */}
        {actions.timeEmphasized && (
          <p className="mt-1 text-[13px] leading-5 text-muted">시간만 기록하면 목표 거리·시간은 적용되지 않아요.</p>
        )}
      </div>

      {/* Figma 순서·위계 그대로: 러닝 시작(주) 위, GPS 없이 시간만 기록(보조) 아래. 위치를 쓸 수 없으면 순서·모양은 그대로 두고 글자색만 진하게 한다. */}
      <RunFooter hasSecondary>
        <PrimaryButton label="러닝 시작" disabled={actions.startDisabled} onClick={() => signalStart('gps')} />
        <TextButton
          label="GPS 없이 시간만 기록"
          onClick={() => signalStart('time')}
          className={actions.timeEmphasized ? '!font-medium !text-ink' : ''}
        />
      </RunFooter>
    </div>
  )
}

export default ReadyPage
