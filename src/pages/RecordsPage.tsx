import { useState } from 'react'
import { Link } from 'react-router-dom'
import heroArrow from '../assets/home/hero-arrow.svg'
import chevronRight from '../assets/icons/chevron-right.svg'
import {
  buildCalendar,
  buildRecordRows,
  buildRecordsSummary,
  type CalendarDay,
  type RecordRowView,
} from '../features/records/recordsView'
import { RUN_PATHS } from '../features/running/runFlow'
import { createRunStorage, type RecordsReadResult } from '../features/running/runStorage'
import type { RunRecord } from '../features/running/types'

type RecordsTab = 'calendar' | 'list'

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

function readRecords(): RecordsReadResult {
  try {
    return createRunStorage().readRecords()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

// Empty·Error 공통 카드 (Figma RECORDS Empty/Error)
function StateCard({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { label: string; to?: string; onClick?: () => void }
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-[16px] font-medium leading-[24px] text-app-bg">{action.label}</span>
      <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-lime">
        <img src={heroArrow} alt="" aria-hidden="true" className="size-[24px] brightness-0" />
      </span>
    </>
  )
  const className =
    'mt-4 flex h-[64px] w-full cursor-pointer items-center rounded-full bg-ink pl-[28px] pr-[12px] text-left transition-opacity active:opacity-[0.78]'
  return (
    <section className="flex w-full flex-col gap-2 rounded-[24px] bg-soft p-6">
      <h2 className="text-[20px] font-semibold leading-[30px] text-ink">{title}</h2>
      <p className="text-[14px] leading-[21px] text-muted">{body}</p>
      {action.to !== undefined ? (
        <Link to={action.to} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={className}>
          {content}
        </button>
      )}
    </section>
  )
}

function SummaryItem({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="flex w-[103px] flex-col gap-1">
      <p className="flex h-[32px] items-baseline gap-[6px] whitespace-nowrap text-ink">
        <span className="text-[28px] font-light leading-[32px]">{value}</span>
        <span className="text-[13px] leading-[18px]">{unit}</span>
      </p>
      <p className="text-[13px] leading-[18px] text-muted">{label}</p>
    </div>
  )
}

function markerClass(day: CalendarDay): string {
  if (day.marker === 'full') return 'bg-lime text-ink'
  if (day.marker === 'partial') return 'border-[1.5px] border-solid border-lime text-app-bg'
  // 시간 기록만 있는 날: 숫자만 라임색으로 구분한다.
  if (day.marker === 'time') return 'text-lime'
  return 'text-app-bg'
}

const MARKER_LABEL = { full: '거리 완주', partial: '일부 러닝', time: '시간 기록' } as const

function DayCell({ day }: { day: CalendarDay }) {
  const label = `${day.day}일${day.marker === null ? '' : `, ${MARKER_LABEL[day.marker]}`}${day.isToday ? ', 오늘' : ''}`
  const marker = (
    <span
      className={`relative flex size-[28px] items-center justify-center rounded-full text-[13px] leading-[18px] ${markerClass(day)} ${day.isToday ? 'outline outline-[1.5px] -outline-offset-[1.5px] outline-app-bg' : ''}`}
    >
      {day.day}
      {day.isToday && <span aria-hidden="true" className="absolute left-[13px] top-[22px] size-[2px] rounded-full bg-app-bg" />}
    </span>
  )
  const cell = 'flex h-[32px] w-[calc(100%/7)] items-center justify-center'
  return day.recordId !== null ? (
    <Link to={`/records/${day.recordId}`} aria-label={label} className={cell}>
      {marker}
    </Link>
  ) : (
    <div role="img" aria-label={label} className={cell}>
      {marker}
    </div>
  )
}

function CalendarCard({ now, records }: { now: Date; records: readonly RunRecord[] }) {
  const calendar = buildCalendar(records, now)
  return (
    <>
      <section
        aria-label={calendar.title}
        className="mt-4 flex flex-col gap-2 rounded-[28px] border border-solid border-[rgba(219,224,209,0.32)] bg-[linear-gradient(144deg,#000_22%,#1a1a1a_103%)] p-[18px]"
      >
        <h2 className="flex h-[32px] items-center text-[19px] font-medium leading-[27px] text-app-bg">{calendar.title}</h2>
        <div aria-hidden="true" className="flex h-[22px] text-center text-[13px] leading-[18px] text-[#c4c5bf]">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="w-[calc(100%/7)]">
              {weekday}
            </span>
          ))}
        </div>
        {calendar.weeks.map((week, index) => (
          <div key={index} className="flex h-[32px]">
            {week.map((day, dayIndex) =>
              day === null ? <div key={dayIndex} className="h-[32px] w-[calc(100%/7)]" /> : <DayCell key={dayIndex} day={day} />,
            )}
          </div>
        ))}
      </section>
      <ul className="mt-[10px] flex h-[22px] gap-3 text-[13px] leading-[18px] text-muted" aria-label="달력 범례">
        <li className="flex w-[106px] items-center gap-[6px]">
          <span aria-hidden="true" className="size-[9px] rounded-full bg-lime" />
          거리 완주
        </li>
        <li className="flex w-[106px] items-center gap-[6px]">
          <span aria-hidden="true" className="size-[9px] rounded-full border-[1.5px] border-solid border-lime" />
          일부 러닝
        </li>
        <li className="flex w-[106px] items-center gap-[6px]">
          <span aria-hidden="true" className="relative size-[9px] rounded-full border border-solid border-ink">
            <span className="absolute left-[2.5px] top-[2.5px] size-[3px] rounded-full bg-ink" />
          </span>
          오늘
        </li>
      </ul>
    </>
  )
}

function RecordRow({ row }: { row: RecordRowView }) {
  return (
    <li className="border-b border-solid border-line last:border-b-0">
      <Link to={`/records/${row.recordId}`} className="flex h-[78px] w-full items-center gap-3 text-left">
        <span className="flex min-w-0 flex-1 flex-col gap-[3px] whitespace-nowrap">
          <span className="text-[13px] leading-[18px] text-muted">
            {row.dateText} {row.weekdayText}
          </span>
          <span className="text-[26px] leading-[34px] text-ink">{row.mainText}</span>
        </span>
        <span className="flex w-[152px] shrink-0 flex-col items-end gap-1 whitespace-nowrap text-[13px]">
          {row.detailText !== null && <span className="leading-[20px] text-muted">{row.detailText}</span>}
          <span className="font-medium leading-[19px] text-ink">{row.statusText}</span>
        </span>
        <img src={chevronRight} alt="" aria-hidden="true" className="size-[18px] shrink-0" />
      </Link>
    </li>
  )
}

// Figma `RECORDS`(06). 저장된 러닝 기록으로 요약·달력·목록을 보여 준다.
// 마운트할 때 저장된 기록을 한 번 읽는다(비동기 읽기가 없으므로 로딩 화면을 두지 않는다).
export function RecordsPage() {
  const [now] = useState(() => new Date())
  const [result, setResult] = useState(readRecords)
  const [tab, setTab] = useState<RecordsTab>('calendar')

  let body
  if (!result.ok) {
    body = (
      <StateCard
        title="기록을 불러오지 못했어요"
        body="연결을 확인한 뒤 다시 시도해 주세요."
        action={{ label: '다시 시도', onClick: () => setResult(readRecords()) }}
      />
    )
  } else if (result.records.length === 0) {
    body = (
      <StateCard
        title="아직 러닝 기록이 없어요"
        body="첫 러닝을 마치면 여기에 기록이 쌓여요."
        action={{ label: '러닝 시작하기', to: RUN_PATHS.goal }}
      />
    )
  } else {
    const records = result.records
    const summary = buildRecordsSummary(records, now)
    const rows = buildRecordRows(records, now, tab === 'calendar')
    body = (
      <>
        <div role="group" aria-label="보기 방식" className="flex h-[44px] gap-3">
          {(
            [
              ['calendar', '캘린더'],
              ['list', '목록'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={`flex h-[44px] flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-[20px] ${tab === value ? 'bg-ink text-app-bg' : 'bg-soft text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5 flex h-[68px] gap-4">
          <SummaryItem value={String(summary.monthCount)} unit="회" label="이번 달" />
          <SummaryItem value={summary.distanceText} unit="km" label="누적 거리" />
          <SummaryItem value={String(summary.completeCount)} unit="회" label="거리 완주" />
        </div>
        {tab === 'calendar' && <CalendarCard now={now} records={records} />}
        {rows.length > 0 && (
          <ul aria-label={tab === 'calendar' ? '이번 달 기록' : '전체 기록'} className={tab === 'calendar' ? 'mt-[18px]' : 'mt-4'}>
            {rows.map((row) => (
              <RecordRow key={row.recordId} row={row} />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col bg-app-bg px-6 pb-6 pt-3 font-pace text-ink [&>*]:shrink-0">
      <header className="flex flex-col">
        <p className="text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <h1 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.44px]">기록</h1>
      </header>
      <div className="mt-4">{body}</div>
    </div>
  )
}

export default RecordsPage
