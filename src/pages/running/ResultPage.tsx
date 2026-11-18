import { Navigate, useNavigate } from 'react-router-dom'
import mascotFinish from '../../assets/images/mascot-finish.png'
import goalGlow from '../../assets/icons/result-goal-glow.svg'
import reflectionIcon from '../../assets/icons/result-reflection.svg'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { formatClock, formatDistanceKm2, formatDuration, formatRemainingKm2, formatPaceOrDash } from '../../features/running/format'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runResultStore } from '../../features/running/runResultStore'
import type { RunSummary } from '../../features/running/runResult'
import {
  AchievementCard,
  DifficultyChips,
  ReflectionSheet,
  SaveFooter,
  SplitRows,
  Stat,
} from './ResultShared'
import { useFinishedRun } from './resultHooks'

const CONFETTI: readonly { left: number; top: number; w: number; h: number; rotate: number; color: string }[] = [
  { left: 35, top: 214, w: 16.4, h: 6.8, rotate: 35, color: '#c2f51f' },
  { left: 107, top: 246, w: 13.6, h: 6.8, rotate: -25, color: '#ff59a6' },
  { left: 332, top: 179, w: 16.4, h: 6.8, rotate: -45, color: '#c2f51f' },
  { left: 351, top: 252, w: 13.6, h: 6.8, rotate: 25, color: '#c2f51f' },
  { left: 77, top: 289, w: 10.9, h: 6.8, rotate: -40, color: '#ff59a6' },
  { left: 300, top: 305, w: 12.3, h: 6.8, rotate: -20, color: '#c2f51f' },
]

// Figma `GOAL / Arrival`: 마스코트가 시트 뒤에 낮게 있고 색종이는 모여 있다(상태 바 44px를 뺀 좌표).
// 완주 화면의 색종이와 같은 순서(confetti 1~6)로 짝지어, 도착 → 완주 전환(스마트 애니메이트 0.4초)에서 제자리로 움직인다.
const ARRIVAL_CONFETTI: typeof CONFETTI = [
  { left: 41.5, top: 292.1, w: 16.4, h: 6.8, rotate: 55.55, color: '#c2f51f' },
  { left: 105.8, top: 337.6, w: 13.6, h: 6.8, rotate: -62.57, color: '#ff59a6' },
  { left: 323, top: 241.8, w: 16.4, h: 6.8, rotate: -45, color: '#c2f51f' },
  { left: 345.2, top: 349.6, w: 13.6, h: 6.8, rotate: 25, color: '#c2f51f' },
  { left: 84.1, top: 365.6, w: 10.9, h: 6.8, rotate: -40, color: '#ff59a6' },
  { left: 294.8, top: 402, w: 12.3, h: 6.8, rotate: -20, color: '#c2f51f' },
]

// 도착 → 완주 전환: Figma SMART_ANIMATE 0.4초 ease-in-out. 움직임을 줄이도록 설정한 기기에서는 바로 바꾼다.
export const ARRIVAL_SETTLE_MS = 400
const SETTLE = 'transition-[left,top,transform,opacity,box-shadow] duration-[400ms] ease-in-out motion-reduce:transition-none'

// 어두운 축하 영역(도착·완주 화면 공통). 위 354px.
export function CelebrationTop({ arrival = false }: { arrival?: boolean }) {
  return (
    <>
      {/* 키가 작은 화면(예: 375x667)에서는 시트가 한 화면에 들어오도록 위 영역을 줄인다. */}
      <div className="flex h-[354px] shrink-0 flex-col gap-5 px-6 pt-3 text-app-bg [@media(max-height:700px)]:h-[236px]">
        <p className="text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <p className="text-[38px] font-bold leading-[51px]">완주했어요!</p>
        <p className="text-[18px] font-medium leading-[26px]">지금처럼만 하면 돼요.</p>
      </div>
      {/* 장식은 390px 기준 좌표를 쓰고 가운데를 맞춰 둔다. 더 좁은 화면에서는 양옆이 조금 잘릴 뿐 레이아웃을 넓히지 않는다. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-[390px] -translate-x-1/2 overflow-hidden">
        <img src={goalGlow} alt="" aria-hidden="true" className={`pointer-events-none absolute left-[203px] top-[316px] h-[43px] w-[56px] max-w-none scale-[2.2] ${SETTLE} ${arrival ? 'opacity-0' : 'opacity-100'}`} />
        <img
          src={mascotFinish}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute h-[223px] w-[169px] object-contain ${SETTLE}`}
          style={arrival
            ? { left: 166, top: 256.6, transform: 'rotate(8.77deg)', boxShadow: '0 4px 4px rgba(0,0,0,0.25)' }
            : { left: 158, top: 155, transform: 'rotate(0deg)', boxShadow: '0 0 0 rgba(0,0,0,0)' }}
        />
        {CONFETTI.map((settled, index) => {
          const piece = arrival ? ARRIVAL_CONFETTI[index] : settled
          return (
            <span
              key={index}
              aria-hidden="true"
              className={`pointer-events-none absolute rounded-[1.4px] ${SETTLE}`}
              style={{ left: piece.left, top: piece.top, width: piece.w, height: piece.h, background: piece.color, transform: `rotate(${piece.rotate}deg)` }}
            />
          )
        })}
      </div>
    </>
  )
}

// arrival: 도착 화면(0.8초). 같은 시트를 누를 수 없게 보여 준다.
export function GoalResult({ summary, arrival = false }: { summary: RunSummary; arrival?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="relative flex min-h-0 flex-1 flex-col font-pace">
      <CelebrationTop arrival={arrival} />
      <div inert={arrival} className="relative flex min-h-0 flex-1 flex-col rounded-t-[28px] bg-app-bg text-ink">
        <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-[30px] [&>*]:shrink-0">
          <div className="flex h-[70px] gap-3 text-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[32px] font-semibold leading-[43px]">{formatDistanceKm2(summary.distanceM ?? 0)}</p>
              <p className="text-[13px] leading-[18px] text-muted">거리 · km</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[32px] font-semibold leading-[43px]">{formatClock(summary.elapsedMs)}</p>
              <p className="text-[13px] leading-[18px] text-muted">러닝 시간</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[32px] font-semibold leading-[43px]">{formatPaceOrDash(summary.avgPaceSecPerKm)}</p>
              <p className="text-[13px] leading-[18px] text-muted">페이스 · /km</p>
            </div>
          </div>
          <div className="mt-[18px] h-[40px]">
            <div className="flex h-5 text-[14px] leading-[19px]">
              <p className="flex-1 font-medium">거리 목표 달성</p>
              <p className="font-medium">100%</p>
            </div>
            <div className="mt-[10px] h-[6px] rounded-[3px] bg-lime" role="progressbar" aria-label="거리 목표 달성" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100} />
          </div>
          <button
            type="button"
            onClick={() => navigate(RUN_PATHS.resultDetails)}
            className="mt-[14px] flex h-9 w-full cursor-pointer items-center text-left text-[14px] font-medium leading-[19px]"
          >
            <span className="flex-1">구간별 기록 보기</span>
            <img src={chevronRight} alt="" aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => runResultStore.getState().openSheet()}
            className="mt-3 flex h-16 w-full cursor-pointer items-center gap-4 text-left"
          >
            <span className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-lime">
              <img src={reflectionIcon} alt="" aria-hidden="true" className="size-[26px]" />
            </span>
            <span className="flex h-[54px] flex-col gap-[6px]">
              <span className="text-[18px] font-semibold leading-6">러닝 회고하기</span>
              <span className="text-[14px] leading-[19px] text-muted">오늘 러닝은 어떠셨나요?</span>
            </span>
          </button>
        </div>
        <SaveFooter inset />
      </div>
      {!arrival && <ReflectionSheet />}
    </div>
  )
}

function ResultHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <p className="text-[23.5px] font-bold leading-[29px]">P!PACE</p>
      <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">{title}</h1>
      <p className="mt-4 text-[15px] leading-6 text-muted">{subtitle}</p>
    </>
  )
}

function PartialResult({ summary }: { summary: RunSummary }) {
  const goal = summary.goal
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ResultHeading
          title="오늘의 한 걸음."
          subtitle={`목표까지 ${formatRemainingKm2(summary.remainingM ?? 0)} km를 남기고 마쳤어요.`}
        />
        <div className="mt-5">
          <AchievementCard>
            <p className="flex items-baseline gap-[6px]">
              <span className="text-[66px] font-light leading-[76px] tracking-[-1.98px]">{formatDistanceKm2(summary.distanceM ?? 0)}</span>
              <span className="text-[22px] leading-[31px]">km</span>
            </p>
            {goal.targetDistanceKm !== null && goal.targetDurationSec !== null && (
              <p className="text-[14px] leading-[22px]">
                목표 {goal.targetDistanceKm.toFixed(2)} km · {formatDuration(goal.targetDurationSec)}
              </p>
            )}
            <div className="mt-[18px] flex h-[62px] items-center gap-[18px]">
              <Stat label="러닝 시간" value={formatClock(summary.elapsedMs)} />
              <Stat label="평균 페이스" value={formatPaceOrDash(summary.avgPaceSecPerKm)} />
            </div>
          </AchievementCard>
        </div>
        {summary.splits.length > 0 && (
          <>
            <p className="mt-6 text-[17px] font-medium leading-6">구간별 페이스</p>
            <div className="mt-2">
              <SplitRows splits={summary.splits} />
            </div>
          </>
        )}
        <p className="mt-[18px] text-[19px] font-medium leading-[27px]">오늘 러닝은 어땠나요?</p>
        <div className="mt-3">
          <DifficultyChips />
        </div>
      </div>
      <SaveFooter />
    </div>
  )
}

function TimeResult({ summary }: { summary: RunSummary }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ResultHeading title="오늘의 한 걸음." subtitle="거리와 페이스는 측정하지 않았어요." />
        <div className="mt-5">
          <AchievementCard>
            <p className="text-[66px] font-light leading-[76px] tracking-[-1.98px]">
              {formatClock(summary.elapsedMs)}
            </p>
            <p className="text-[14px] leading-[22px]">GPS 없이 시간만 기록</p>
            <div className="mt-[18px] flex h-[62px] items-center gap-[18px]">
              <Stat label="러닝 시간" value={formatClock(summary.elapsedMs)} />
            </div>
          </AchievementCard>
        </div>
        {/* Figma: 숨겨진 구간별 페이스 자리의 간격(8·18px)이 남아 있어 제목이 24 + 26px 아래에 놓인다. */}
        <p className="mt-[50px] text-[19px] font-medium leading-[27px]">오늘 러닝은 어땠나요?</p>
        <div className="mt-3">
          <DifficultyChips />
        </div>
      </div>
      <SaveFooter />
    </div>
  )
}

// 결과 화면: 완주(goal)·일부 러닝(partial)·시간 기록(time)에 따라 다른 화면을 보인다.
export function ResultPage() {
  const finished = useFinishedRun()
  if (finished === null) return <Navigate to={RUN_PATHS.goal} replace />
  const { summary } = finished
  if (summary.completion === 'goal') return <GoalResult summary={summary} />
  if (summary.completion === 'time') return <TimeResult summary={summary} />
  return <PartialResult summary={summary} />
}

export default ResultPage
