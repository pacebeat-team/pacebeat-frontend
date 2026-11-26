import { useNavigate } from 'react-router-dom'
import attention from '../../assets/icons/run-attention.svg'
import mascot from '../../assets/images/mascot-p.png'
import { PauseIcon, StopIcon } from '../../components/common/RunIcons'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { TextButton } from '../../components/common/TextButton'
import { formatClock, formatDistanceKm, formatDistanceKm2, formatPace, formatRemainingKm2, formatPaceOrDash } from '../../features/running/format'
import { findMusicTrack } from '../../features/running/music'
import { evaluateStageCoaching } from '../../features/running/phoneSensorEngine'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runLive, selectLiveMetrics, selectLiveSensorAndStage, useRunLive } from '../../features/running/runLive'
import { getGoalProgress, getRequiredPaceSecPerKm } from '../../features/running/runProgress'
import { useRunStore } from '../../features/running/runStore'
import { AudioToggle } from './AudioToggle'
import { RunFooter } from './RunFooter'
import { useBlockBack, useRunClock } from './useRunClock'

// Figma `RUNNING / 01~02`(진행)와 `RUN / Paused`(일시정지). 세션 상태에 따라 화면이 바뀐다.
export function ActivePage() {
  const navigate = useNavigate()
  const active = useRunStore((state) => state.activeSession)
  const liveState = useRunLive((state) => state)
  const { gps, now } = liveState
  const status = active?.session.status ?? null

  useRunClock(status === 'running')
  useBlockBack(status !== null && status !== 'finished')

  // 목표 거리 도달 등으로 세션이 끝났을 때의 화면 전환(도착 → 결과)은 RunFlowGuard가 정한다(이 화면은 이동하지 않는다).

  if (active === null || status === 'finished') return null
  const metrics = selectLiveMetrics(active, gps, now)
  if (metrics === null) return null
  const sensorAndStage = selectLiveSensorAndStage(active, liveState)
  const sensor = sensorAndStage?.sensor ?? null
  const stageGuidance = sensorAndStage?.stageGuidance ?? null
  const selectedTrack = findMusicTrack(active.musicTrackId)
  const effectivePaceSec = metrics.currentPaceSecPerKm ?? sensor?.paceSecPerKm ?? null
  const coaching = evaluateStageCoaching(
    effectivePaceSec,
    stageGuidance?.displayPaceSecPerKm ?? null,
    selectedTrack?.bpm ?? null,
  )
  const isTime = active.mode === 'time'
  const progress = getGoalProgress(active.goal, metrics.distanceM)

  if (status === 'paused') {
    const required = getRequiredPaceSecPerKm(active.goal, metrics.distanceM, metrics.elapsedMs)
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
        <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-3 [&>*]:shrink-0">
          <p className="text-[23.5px] font-bold leading-[29px]">P!PACE</p>
          <h1 className="mt-4 text-[36px] font-light leading-[44px] tracking-[-1.08px]">잠시 쉬어가요.</h1>
          <p className="mt-7 text-[82px] font-light leading-[94px] tracking-[-2.46px]">
            {formatClock(metrics.elapsedMs)}
          </p>
          {isTime ? (
            <p className="text-[17px] leading-[26px]">GPS 없이 시간만 기록했어요.</p>
          ) : (
            <p className="text-[17px] leading-[26px]">
              {formatDistanceKm2(metrics.distanceM ?? 0)} km · 평균 {formatPaceOrDash(metrics.avgPaceSecPerKm)} /km
            </p>
          )}
          {!isTime && progress !== null && (
            <div className="mt-[37px] flex gap-5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] text-muted">남은 거리</p>
                <p className="mt-[4px] flex items-baseline gap-1 text-ink">
                  <span className="text-[35px] font-light leading-[42px] tracking-[-1.05px]">{formatRemainingKm2(progress.remainingM)}</span>
                  <span className="text-[14px] leading-5">km</span>
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] text-muted">재개 후 필요 페이스</p>
                <p className="mt-[4px] flex items-baseline gap-1 text-ink">
                  <span className="text-[35px] font-light leading-[42px] tracking-[-1.05px]">{required === null ? '—' : formatPace(required)}</span>
                  <span className="text-[14px] leading-5">/km</span>
                </p>
              </div>
            </div>
          )}
          <p className={`${isTime ? 'mt-[62px]' : 'mt-[35px]'} text-[23px] leading-[34px]`}>러닝을 잠시 멈췄어요.</p>
          <p className="mt-[10px] text-[15px] leading-6 text-muted">준비되면 계속 달릴 수 있어요.</p>
          <p className="mt-[24px] text-[16px] leading-[25px] text-muted">
            목표 전에 끝내도
            <br />
            달린 만큼의 기록은 남아요.
          </p>

        </div>
        <RunFooter hasSecondary>
          <PrimaryButton label="계속 달리기" onClick={() => runLive.resume()} />
          <TextButton label="종료하고 기록 확인" onClick={() => navigate(RUN_PATHS.end)} />
        </RunFooter>
      </div>
    )
  }

  // Figma `RUNNING / 01`: 상태 바(44) 아래 위 18·좌우 14 패딩, 이어서 12 · 가이드 116 · 8 · 거리 161 · 2 · 진행 78 · 24 · 지표 78 · 28 · 조작 114.
  const guideText = (() => {
    if (isTime) {
      return (
        <>
          시간을 기록하며
          <br />
          편하게 달려요.
        </>
      )
    }
    if (stageGuidance?.isCompletionFirst) {
      return (
        <>
          무리하지 말고
          <br />
          내 리듬으로 완주해요!
        </>
      )
    }
    if (stageGuidance?.section === 'warmup') {
      return (
        <>
          몸풀기 구간 ({formatPaceOrDash(stageGuidance.displayPaceSecPerKm)}/km)
          <br />
          가볍게 리듬을 찾아요.
        </>
      )
    }
    if (stageGuidance?.section === 'realtime') {
      return (
        <>
          막판 스퍼트 ({formatPaceOrDash(stageGuidance.displayPaceSecPerKm)}/km)
          <br />
          {stageGuidance.isFrozenAfter95Pct ? '끝까지 페이스를 유지해요!' : '목표보다 조금 일찍 도착해요!'}
        </>
      )
    }
    if (coaching.status === 'speed_up') {
      return (
        <>
          목표보다 조금 느려요
          <br />
          박자에 맞춰 보폭을 높여요.
        </>
      )
    }
    if (coaching.status === 'slow_down') {
      return (
        <>
          목표보다 빨라요
          <br />
          리듬을 조금 늦춰도 좋아요.
        </>
      )
    }
    return (
      <>
        목표 페이스로
        <br />
        달리고 있어요.
      </>
    )
  })()
  return (
    <div className="flex min-h-0 flex-1 flex-col font-pace text-ink">
      {/* 키가 작은 화면(예: 375x667)에서는 지표가 모두 보이도록 위 영역을 줄인다. */}
      <div className="flex flex-1 flex-col overflow-y-auto px-[14px] pt-[18px] [@media(max-height:700px)]:pt-2 [&>*]:shrink-0">
        <p className="text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <div className="h-3 [@media(max-height:700px)]:h-1" />
        <div className="relative flex h-[116px] w-full flex-col pl-[95px] pt-8 [@media(max-height:700px)]:h-[60px] [@media(max-height:700px)]:pl-[56px] [@media(max-height:700px)]:pt-3">
          <img src={mascot} alt="" className="run-mascot pointer-events-none absolute left-[3.5px] top-3 h-[116px] w-[88px] object-contain [--run-mascot-shift:10px] [@media(max-height:700px)]:top-0 [@media(max-height:700px)]:h-[60px] [@media(max-height:700px)]:w-[46px] [@media(max-height:700px)]:[--run-mascot-shift:5px]" aria-hidden="true" />
          <img src={attention} alt="" className="pointer-events-none absolute left-[71px] top-[6px] size-[28px] [@media(max-height:700px)]:hidden" aria-hidden="true" />
          <p className="w-[190px] text-[23px] leading-[30px] [@media(max-height:700px)]:text-[18px] [@media(max-height:700px)]:leading-[22px]">{guideText}</p>
          <AudioToggle className="absolute right-[7px] top-0" />
        </div>
        <div className="h-2" />

        {isTime ? (
          <div className="flex h-[161px] flex-col pl-3 [@media(max-height:820px)_and_(min-height:701px)]:h-[117px] [@media(max-height:700px)]:h-[84px] [@media(max-height:700px)]:justify-center">
            <p
              className={`font-light tracking-[3px] ${metrics.elapsedMs >= 3_600_000 ? 'text-[76px] leading-[96px] [@media(max-height:700px)]:text-[56px] [@media(max-height:700px)]:leading-[84px]' : 'text-[90px] leading-[132px] [@media(max-height:820px)_and_(min-height:701px)]:leading-[88px] [@media(max-height:700px)]:text-[64px] [@media(max-height:700px)]:leading-[84px]'}`}
            >
              {formatClock(metrics.elapsedMs)}
            </p>
          </div>
        ) : (
          <p className="flex h-[161px] items-baseline gap-[6px] pl-3 [@media(max-height:820px)_and_(min-height:701px)]:h-[117px] [@media(max-height:700px)]:h-[84px]">
            <span className="whitespace-nowrap text-[108px] font-light leading-[132px] tracking-[3px] [@media(max-height:820px)_and_(min-height:701px)]:leading-[88px] [@media(max-height:700px)]:text-[64px] [@media(max-height:700px)]:leading-[84px]">{formatDistanceKm2(metrics.distanceM ?? 0)}</span>
            <span className="h-[52px] w-[60px] text-[38px] font-light leading-[59px] [@media(max-height:700px)]:text-[24px] [@media(max-height:700px)]:leading-[40px]">km</span>
          </p>
        )}
        <div className="h-[2px]" />

        <div className={`flex h-[78px] flex-col px-[10px] ${isTime ? 'gap-px pt-[7px]' : 'gap-2'}`}>
          {isTime ? (
            <>
              <p className="text-[20px] font-medium leading-[28px]">GPS 없이 시간만 기록</p>
              <p className="text-[16px] leading-[25px] text-[#50563b]">거리와 페이스는 기록하지 않아요.</p>
            </>
          ) : (
            progress !== null && (
              <>
                <div className="flex h-[28px] items-baseline">
                  <p className="w-[150px] text-[20px] font-medium leading-[28px]">목표 {formatDistanceKm(progress.targetM / 1000)} km</p>
                  <span className="flex-1" />
                  <p className="w-[52px] text-right text-[21px] font-medium leading-[28px]">{progress.percent}%</p>
                </div>
                <div
                  role="progressbar"
                  aria-label="목표 진행률"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                  className="relative h-[9px] w-full shrink-0"
                >
                  <div className="absolute inset-0 rounded-full bg-[#8fc431]/60" />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${progress.percent}%` }} />
                  <div className="absolute -top-[2.5px] size-[14px] rounded-full bg-ink" style={{ left: `calc(${progress.percent}% - 7px)` }} />
                </div>
                <p className="w-[180px] text-[16px] leading-[25px] text-[#50563b]">{formatRemainingKm2(progress.remainingM)} km 남았어요.</p>
              </>
            )
          )}
        </div>
        <div className="h-6 [@media(max-height:700px)]:h-2" />

        <div className="flex h-[78px] px-[10px]">
          <div className="relative flex h-[78px] w-full max-w-[342px] gap-[29px]">
            <div className="flex min-w-0 flex-[162_1_0%] flex-col">
              <p className="text-[14px] font-medium leading-5">{isTime ? 'GPS 상태' : '경과 시간'}</p>
              {isTime ? (
                <p className="h-[58px] text-[24px] leading-[58px] tracking-[0.5px]">사용 안 함</p>
              ) : (
                <p className="h-[58px] text-[42px] leading-[58px] tracking-[0.5px]">{formatClock(metrics.elapsedMs)}</p>
              )}
            </div>
            <div className="flex min-w-0 flex-[151_1_0%] flex-col whitespace-nowrap">
              <p className="text-[14px] font-medium leading-5">{isTime ? '거리 · 페이스' : '현재 페이스'}</p>
              <p className="flex h-[58px] items-baseline gap-[5px]">
                <span className="text-[42px] leading-[58px] tracking-[0.5px]">{isTime ? '—' : formatPaceOrDash(effectivePaceSec)}</span>
                {!isTime && effectivePaceSec !== null && <span className="text-[20px] leading-[28px]">/km</span>}
              </p>
            </div>
            <span aria-hidden="true" className="absolute left-[calc((100%-29px)*0.5176+1px)] top-[5px] h-[60px] w-[0.8px] bg-ink" />
          </div>
        </div>

        {/* 실시간 핸드폰 센서(GPS + 모션 가속도계) 속도 · 케이던스(BPM) 및 3구간 안내 배지 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[20px] bg-white/45 px-3.5 py-2 text-[13px] leading-[19px] text-ink">
          <div className="flex items-center gap-3">
            <span>
              속도{' '}
              <strong className="font-semibold">
                {sensor?.speedKmh !== null && sensor?.speedKmh !== undefined ? `${sensor.speedKmh.toFixed(1)} km/h` : '—'}
              </strong>
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-ink/30" />
            <span>
              리듬{' '}
              <strong className="font-semibold">
                {sensor?.cadenceBpm !== null && sensor?.cadenceBpm !== undefined
                  ? `${sensor.cadenceBpm} BPM`
                  : coaching.targetBpm !== null
                    ? `목표 ${coaching.targetBpm} BPM`
                    : '—'}
              </strong>
            </span>
          </div>
          {!isTime && stageGuidance !== null && (
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-medium text-app-bg">
              {stageGuidance.section === 'warmup'
                ? `1구간 몸풀기 · ${formatPaceOrDash(stageGuidance.displayPaceSecPerKm)}/km`
                : stageGuidance.section === 'rhythm'
                  ? `2구간 리듬 유지 · ${formatPaceOrDash(stageGuidance.displayPaceSecPerKm)}/km`
                  : stageGuidance.isCompletionFirst
                    ? '3구간 완주 우선 모드'
                    : `3구간 실시간 · ${formatPaceOrDash(stageGuidance.displayPaceSecPerKm)}/km`}
            </span>
          )}
        </div>
        {/* Figma의 지표와 조작 사이 28px 여백 */}
        <div className="h-[28px] [@media(max-height:700px)]:h-5" />
      </div>
      {/* 일시정지·종료는 작은 화면에서도 스크롤 없이 누를 수 있도록 고정 영역에 둔다. */}
      <div className="flex shrink-0 justify-center pb-6 [@media(max-height:700px)]:pb-2">
        <div className="flex h-[114px] w-[307px] rounded-[57px] border-[0.7px] border-white/[0.96] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.34),rgba(255,255,255,0.27)_50%,rgba(255,255,255,0.34))] px-[30.5px] pb-[6px] pt-[13px]">
          <div className="relative flex w-full">
            <button
              type="button"
              onClick={() => runLive.pause()}
              className="flex h-[95px] w-[123px] cursor-pointer flex-col items-center gap-[3px] active:opacity-70"
            >
              <span className="flex size-[70px] items-center justify-center rounded-full bg-app-bg text-ink">
                <PauseIcon />
              </span>
              <span className="text-[16px] font-medium leading-[22px]">일시정지</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(RUN_PATHS.end)}
              className="flex h-[95px] w-[123px] cursor-pointer flex-col items-center gap-[3px] active:opacity-70"
            >
              <span className="flex size-[70px] items-center justify-center rounded-full bg-ink text-app-bg">
                <StopIcon />
              </span>
              <span className="text-[16px] font-medium leading-[22px]">종료</span>
            </button>
            <span aria-hidden="true" className="absolute left-[121.6px] top-[17.6px] h-[55px] w-[0.8px] bg-ink" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ActivePage
