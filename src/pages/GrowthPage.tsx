import { useState } from 'react'
import mascot from '../assets/images/mascot-p.png'
import {
  buildFirstRecord,
  buildMonthlyGrowth,
  buildPaceCompare,
  buildWeeklyGrowth,
  getGrowthState,
  isPaceUnchanged,
} from '../features/growth/growthView'
import { readGrowthRecordsFromBrowser, type GrowthRecordsResult } from '../features/growth/growthRecords'
import { RUN_PATHS } from '../features/running/runFlow'
import type { RunRecord } from '../features/running/types'
import { BarChart, LinkRow, Metric, StateCard } from './growth/GrowthParts'

type Period = 'month' | 'week'

function PaceBlock({ records, now }: { records: readonly RunRecord[]; now: Date }) {
  const pace = buildPaceCompare(records, now)
  if (pace === null) return null
  return (
    <>
      <div className="mt-5 h-px w-full bg-line" />
      <section aria-label="최근 3 km 완주 페이스" className="mt-5 flex flex-col gap-1">
        <h2 className="text-[13px] leading-[18px] text-muted">최근 3 km 완주 페이스</h2>
        <p className="flex items-baseline gap-2 whitespace-nowrap text-[28px] font-light leading-8">
          {pace.previousText !== null && !isPaceUnchanged(pace) && <span>{pace.previousText} →</span>}
          <span>{pace.latestText}</span>
          <span className="text-[13px] leading-[18px]">/km</span>
        </p>
        {pace.previousText !== null && pace.savedText !== null && (
          <p className="text-[13px] leading-[18px] text-muted">이전 → 최근 3 km 완주 · {pace.savedText}</p>
        )}
        {isPaceUnchanged(pace) && <p className="text-[13px] leading-[18px] text-muted">이전 3 km 완주와 같은 페이스예요</p>}
      </section>
    </>
  )
}

function DarkCard({ title, distanceText, children }: { title: string; distanceText: string | null; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-[32px] border border-solid border-[rgba(219,224,209,0.32)] bg-[linear-gradient(147deg,#000_22%,#1a1a1a_103%)] p-6 text-app-bg shadow-[inset_0_-5px_8px_rgba(0,0,0,0.65),inset_0_2px_3px_rgba(255,255,242,0.22)]">
      <h2 className="text-[18px] font-medium leading-[25px]">{title}</h2>
      <p className="flex h-[83px] items-baseline gap-[6px] whitespace-nowrap">
        <span className="text-[72px] font-light leading-[83px] tracking-[-2.16px]">{distanceText ?? '–'}</span>
        {distanceText !== null && <span className="text-[24px] leading-[29px]">km</span>}
      </p>
      {children}
    </section>
  )
}

function FirstRecord({ records, now }: { records: readonly RunRecord[]; now: Date }) {
  const first = buildFirstRecord(records, now)
  if (first === null) return null
  return (
    <>
      <section className="flex flex-col rounded-[32px] bg-soft p-6">
        <h2 className="text-[26px] font-light leading-[34px]">
          기록이 쌓이면,
          <br />
          변화가 보여요.
        </h2>
        <p className="mt-2 text-[14px] leading-5 text-muted">아직 비교할 기록이 부족해요</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-[16px] leading-6">
            첫 러닝을 마쳤어요.
            <br />
            다음 기록도 함께 쌓아요.
          </p>
          <img src={mascot} alt="" aria-hidden="true" className="h-[110px] w-[82px] object-contain" />
        </div>
      </section>
      <div className="mt-6 flex gap-4">
        <Metric value="1" unit="회" label="러닝" />
        {first.distanceText !== null && <Metric value={first.distanceText} unit="km" label="누적 거리" />}
      </div>
      <p className="mt-2 text-[13px] leading-[18px] text-muted">첫 기록 · {first.dateText}</p>
      <div className="mt-6">
        <StateCard title="다음 러닝" body="다음 러닝도 기록해 변화를 확인해요." to={RUN_PATHS.goal} actionLabel="다음 러닝 시작하기" />
      </div>
    </>
  )
}

// Figma `GROWTH`(07). 저장된 러닝 기록으로 월간·주간 성장을 보여 준다. 연속 기록은 만들지 않는다.
export function GrowthPage() {
  const [now, setNow] = useState(() => new Date())
  const [result, setResult] = useState<GrowthRecordsResult>(readGrowthRecordsFromBrowser)
  const [period, setPeriod] = useState<Period>('month')

  let body
  if (!result.ok) {
    body = (
      <section className="flex flex-col gap-3 rounded-[24px] bg-soft p-6">
        <h2 className="text-[20px] font-semibold leading-7">기록을 불러오지 못했어요</h2>
        <p className="text-[14px] leading-5 text-muted">저장된 기록을 읽지 못했어요. 저장된 원본은 지우지 않고 그대로 두었어요. 잠시 후 다시 시도해 주세요.</p>
        <button
          type="button"
          onClick={() => (setNow(new Date()), setResult(readGrowthRecordsFromBrowser()))}
          className="mt-3 h-12 cursor-pointer rounded-full bg-ink text-[16px] font-medium text-app-bg"
        >
          다시 시도
        </button>
      </section>
    )
  } else {
    const records = result.records
    const state = getGrowthState(records, now)
    if (state === 'empty') {
      body = (
        <StateCard
          title="아직 러닝 기록이 없어요"
          body="첫 러닝을 마치면 여기에 성장이 보여요."
          to={RUN_PATHS.goal}
          actionLabel="러닝 시작하기"
        />
      )
    } else if (state === 'first') {
      body = <FirstRecord records={records} now={now} />
    } else {
      const monthly = buildMonthlyGrowth(records, now)
      const weekly = buildWeeklyGrowth(records, now)
      body = (
        <>
          <div role="group" aria-label="기간" className="flex h-[44px] gap-3 rounded-[24px] bg-soft">
            {(
              [
                ['month', '월간'],
                ['week', '주간'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={`flex h-[44px] flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-5 ${period === value ? 'bg-ink text-app-bg' : 'text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {period === 'month' ? (
            monthly === null ? (
              <div className="mt-4">
                <StateCard title="이번 달 기록이 없어요" body="이번 달에 달리면 여기에 쌓여요." to={RUN_PATHS.goal} actionLabel="러닝 시작하기" />
              </div>
            ) : (
              <>
                <p className="mt-4 text-[14px] leading-5 text-muted">{monthly.titleText}</p>
                <div className="mt-2">
                  <DarkCard title="누적 러닝 거리" distanceText={monthly.distanceText}>
                    <BarChart chart={monthly.chart} label="주별 러닝 거리(km)" />
                  </DarkCard>
                </div>
                <div className="mt-5 flex gap-4">
                  <Metric value={String(monthly.runCount)} unit="회" label="러닝" />
                  <Metric value={String(monthly.achievementPercent)} unit="%" label="목표 달성률" />
                </div>
              </>
            )
          ) : weekly === null ? (
            <div className="mt-4">
              <StateCard title="이번 주 기록이 없어요" body="이번 주에 달리면 여기에 쌓여요." to={RUN_PATHS.goal} actionLabel="러닝 시작하기" />
            </div>
          ) : (
            <div className="mt-4">
              <DarkCard title="이번 주 러닝 거리" distanceText={weekly.distanceText}>
                <BarChart chart={weekly.chart} label="러닝별 거리(km)" />
              </DarkCard>
              <div className="mt-5 flex gap-4">
                <Metric value={String(weekly.runCount)} unit="회" label="이번 주 러닝" />
              </div>
            </div>
          )}
          <PaceBlock records={records} now={now} />
        </>
      )
    }
    if (state !== 'empty') {
      body = (
        <>
          {body}
          <div className="mt-5 h-px w-full bg-line" />
          {period === 'week' && state === 'ready' && <LinkRow to="/records" label="러닝 기록 보기" />}
          <LinkRow to="/growth/posture" label="자세 리포트" />
        </>
      )
    }
  }

  return (
    <div className="flex flex-col bg-app-bg px-6 pb-6 pt-3 font-pace text-ink [&>*]:shrink-0">
      <header className="flex flex-col">
        <p className="text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <h1 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.44px]">성장</h1>
      </header>
      <div className="mt-4">{body}</div>
      {result.ok && result.skipped > 0 && (
        <p role="status" className="mt-5 text-[13px] leading-[18px] text-muted">
          저장된 기록 중 {result.skipped}개를 읽지 못해 제외했어요. 저장된 원본은 그대로 남아 있어요.
        </p>
      )}
    </div>
  )
}

export default GrowthPage
