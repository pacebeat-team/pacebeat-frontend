import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import avatarImage from '../assets/home/avatar.png'
import heroArrow from '../assets/home/hero-arrow.svg'
import speedIcon from '../assets/home/speed.svg'
import timerIcon from '../assets/home/timer.svg'
import todayDot from '../assets/home/today-dot.svg'
import trackLane1 from '../assets/home/track-lane-1.svg'
import trackLane2 from '../assets/home/track-lane-2.svg'
import trackLane3 from '../assets/home/track-lane-3.svg'
import chevronRight from '../assets/icons/chevron-right.svg'
import mascot from '../assets/images/mascot-p-home.png'
import { confirmGoalForHomeStart } from '../features/home/homeEntry'
import { buildHomeRecordsView, EMPTY_HOME_RECORDS } from '../features/home/homeRecords'
import { buildGoalRowValue, buildHeroView, buildWeekRow } from '../features/home/homeView'
import { useRecommended3KmGoal } from '../features/home/useRecommendedGoal'
import { formatPace } from '../features/running/format'
import { RUN_PATHS } from '../features/running/runFlow'
import { runSetupStore } from '../features/running/runSetupStore'
import { createRunStorage } from '../features/running/runStorage'
import { runStore, useRunStore } from '../features/running/runStore'

const MEASUREMENT_GUIDE_PATH = '/measurement/guide'
const MY_PATH = '/my'
const RECORDS_PATH = '/records'

function ActivityRow({ to, label, value }: { to: string; label: string; value?: string }) {
  return (
    <Link to={to} className="flex h-[64px] w-full items-center gap-3 text-left">
      <span className="min-w-0 flex-1 text-[16px] leading-[24px] text-ink">{label}</span>
      {value !== undefined && <span className="shrink-0 text-right text-[14px] leading-[22px] text-muted">{value}</span>}
      <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
    </Link>
  )
}

// Figma `HOME`(03). 저장된 러닝 기록으로 요일 표시와 지난 러닝 행을 채운다.
// 좁은 화면에서는 마스코트의 왼쪽 위치(189px)를 유지하도록 폭을 줄여 목표 문구와 겹치지 않게 한다.
// 마운트되면 마스코트가 Low → High → Low를 반복한다(`HOME / Arrival` 진입 연출).
export function HomePage() {
  const navigate = useNavigate()
  const draft = useRunStore((state) => state.draft)
  const [now] = useState(() => new Date())
  const recommended = useRecommended3KmGoal(now.getTime())
  // 사용자가 아직 직접 목표를 수정한 적이 없으면(recentGoals 비어 있음) P!PACE 4단계 추천 목표를 기본으로 보여준다.
  const hasCustomGoal = draft.recentGoals.length > 0 || draft.distanceKm !== 3 || draft.targetDurationSec !== 1350
  const effectiveDistanceKm = hasCustomGoal ? draft.distanceKm : recommended.distanceKm
  const effectiveDurationSec = hasCustomGoal ? draft.targetDurationSec : recommended.targetDurationSec
  const hero = buildHeroView(effectiveDistanceKm, effectiveDurationSec)
  const week = buildWeekRow(now)
  // 마운트할 때마다 저장된 기록을 다시 읽는다. 읽을 수 없으면 기록이 없는 것처럼 보인다(오류를 보이지 않는다).
  const [records] = useState(() => {
    try {
      return buildHomeRecordsView(createRunStorage().loadRecords(), now)
    } catch {
      return EMPTY_HOME_RECORDS
    }
  })

  const startRun = () => {
    if (!hasCustomGoal) {
      runStore.getState().setDistance(recommended.distanceKm)
      runStore.getState().setTargetDuration(recommended.targetDurationSec)
    }
    // 목표 화면을 건너뛰므로 가드가 되돌리지 않게 목표 단계를 확정한다.
    confirmGoalForHomeStart(runSetupStore)
    navigate(RUN_PATHS.music)
  }

  return (
    // 상태바 영역(44px)과 하단 내비 영역은 AppLayout의 프레임 여백이 비운다.
    <div className="flex flex-col bg-app-bg px-[14px] pb-5 pt-[18px] font-pace text-ink [&>*]:shrink-0">
      <header className="relative flex h-[51px] items-start px-[7px]">
        <p className="text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <Link
          to={MY_PATH}
          aria-label="마이"
          className="absolute -top-[11px] right-[19px] block size-[51px] overflow-hidden rounded-full border border-lime"
        >
          <img src={avatarImage} alt="" className="size-full object-cover" />
        </Link>
      </header>

      <h1 className="mt-1 text-[48px] font-normal leading-[52px] tracking-[-1.44px]">
        오늘도,
        <br />
        내 페이스로.
      </h1>

      <ol aria-label="이번 주" className="mt-1 flex h-[45px] w-full pt-3">
        {week.map((day, index) => (
          <li key={day.label} className="flex flex-1 flex-col items-center gap-[2px]" aria-current={day.isToday ? 'date' : undefined}>
            <span
              className={`flex size-[28px] items-center justify-center rounded-full text-[14px] leading-[20px] ${
                records.runDays[index] ? 'bg-lime' : ''
              } ${day.isToday ? 'text-ink' : 'text-muted'}`}
            >
              {day.label}
              {records.runDays[index] && <span className="sr-only"> 달린 날</span>}
            </span>
            {day.isToday && <img src={todayDot} alt="" aria-hidden="true" className="size-[3px]" />}
          </li>
        ))}
      </ol>

      <div className="mt-1 h-5" aria-hidden="true" />

      <section
        aria-label="오늘의 러닝"
        className="relative mx-auto mt-1 h-[378px] w-full [container-type:inline-size] max-w-[362px] overflow-hidden rounded-[38px] bg-[linear-gradient(137.6deg,#c7fb29_1.09%,#d8ff7f_98.91%)] shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_224px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[
            { src: trackLane1, box: { left: '-3.17%', right: '24.74%', top: 0, bottom: '-5.82%' } },
            { src: trackLane2, box: { left: '10.8%', right: '12.5%', top: 0, bottom: '-5.82%' } },
            { src: trackLane3, box: { left: '26.61%', right: '2.56%', top: 0, bottom: '10.58%' } },
          ].map(({ src, box }) => (
            <div key={src} className="absolute" style={box}>
              <img src={src} alt="" className="block size-full max-w-none" />
            </div>
          ))}
        </div>

        <p className="absolute left-[22px] top-[28px] text-[21px] leading-[29px]">오늘의 러닝</p>
        <p className="absolute left-[22px] top-[65px] flex h-[92px] items-baseline gap-[6px]">
          <span className="text-[80px] font-light leading-[92px] tracking-[-2.4px]">{hero.distanceText}</span>
          <span className="text-[27px] leading-[32px]">km</span>
        </p>
        <p className="absolute left-[22px] top-[165px] flex items-center gap-[11.5px] text-[14px] leading-[21px] tracking-[-0.07px] text-[#56631b]">
          <span className="flex items-center gap-[3.5px]">
            <img src={timerIcon} alt="" aria-hidden="true" className="size-[14px]" />
            {hero.goalText}
          </span>
          {/* Figma `divider`: 길이 10.6px의 세로 선(색 #56631B). 가로 선 이미지를 회전하면 0.88px 선이 흐릿하게 그려져 거의 보이지 않아, 1px 실선으로 그린다. */}
          <span aria-hidden="true" className="h-[10.6px] w-px shrink-0 rounded-full bg-[#56631b]" />
          <span className="flex items-end gap-[3.5px]">
            <img src={speedIcon} alt="" aria-hidden="true" className="h-[20.3px] w-[19.3px]" />
            {hero.paceText}
          </span>
        </p>

        <div className="home-mascot pointer-events-none absolute right-0 top-[67px] aspect-[173/220] w-[clamp(140px,calc(100cqw-189px),173px)]" aria-hidden="true">
          <img src={mascot} alt="" decoding="async" className="size-full object-contain" />
        </div>

        <button
          type="button"
          onClick={startRun}
          className="absolute inset-x-[11px] top-[285px] flex h-[80px] cursor-pointer items-center gap-3 rounded-full border-[1.5px] border-solid border-white bg-[linear-gradient(180deg,#fffffa_0%,#f5fae0_25%,#ebf5c9_50%,#f5fae0_75%,#fffffa_100%)] pl-[30px] pr-[10px] text-left transition-opacity active:opacity-[0.78]"
        >
          <span className="min-w-0 flex-1 text-[25px] font-medium leading-[30px]">러닝 시작하기</span>
          <span className="flex size-[64px] shrink-0 items-center justify-center rounded-full bg-ink">
            <img src={heroArrow} alt="" aria-hidden="true" className="size-[32px]" />
          </span>
        </button>
      </section>

      {/* Figma `layout / content`의 항목 간격 4px: hero(y 298~676) 다음 `details / activity`는 y 680에서 시작한다. */}
      <div className="mt-1 flex w-full flex-col px-[10px]">
        {records.lastRunText !== null && (
          // Figma `row / 지난 러닝`처럼 chevron을 보이고, 가장 최근 기록의 상세(06)로 연결한다.
          <>
            <Link
              to={records.lastRunRecordId === null ? RECORDS_PATH : `${RECORDS_PATH}/${records.lastRunRecordId}`}
              className="flex h-[64px] w-full items-center gap-3"
            >
              <span className="min-w-0 flex-1 text-[16px] leading-[24px] text-ink">지난 러닝</span>
              <span className="shrink-0 text-right text-[14px] leading-[22px] text-muted">{records.lastRunText}</span>
              <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
            </Link>
            <div className="h-px bg-line" aria-hidden="true" />
          </>
        )}
        <nav aria-label="홈 바로가기" className="flex flex-col">
          <ActivityRow
            to={RUN_PATHS.goal}
            label="추천 목표 수정"
            value={`${buildGoalRowValue(effectiveDistanceKm, effectiveDurationSec)} (${formatPace(recommended.displayPaceSecPerKm)}/km)`}
          />
          <div className="h-px bg-line" aria-hidden="true" />
          <ActivityRow to={MEASUREMENT_GUIDE_PATH} label="기초 측정 다시 하기" />
        </nav>
      </div>
    </div>
  )
}

export default HomePage
