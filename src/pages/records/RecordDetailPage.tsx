import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import {
  buildRecordDetail,
  EMPTY_DRAFT,
  setDraftDifficulty,
  setDraftMemo,
  startReportDraft,
  toggleDraftReason,
  withReflection,
  type RecordDetailView,
} from '../../features/records/recordDetail'
import { getVisibleRecords } from '../../features/records/recordsView'
import { findRecord } from '../../features/running/recordQueries'
import { createRunStorage, type RecordsReadResult } from '../../features/running/runStorage'
import type { RunRecord, RunReflection } from '../../features/running/types'
import { ReflectionSheetView } from '../running/ResultShared'
import { StateCard } from './StateCard'

const RECORDS_PATH = '/records'
const SAVE_ERROR = '저장하지 못했어요. 다시 시도해 주세요.'

function readRecords(): RecordsReadResult {
  try {
    return createRunStorage().readRecords()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

function SummaryCard({ view }: { view: RecordDetailView }) {
  const [first, ...rest] = view.helperLines
  return (
    <section
      aria-label="러닝 요약"
      className="relative flex w-full flex-col gap-2 rounded-[28px] border border-solid border-[rgba(219,224,209,0.32)] bg-[linear-gradient(147deg,#000_22%,#1a1a1a_103%)] p-6 text-app-bg shadow-[inset_0_-5px_8px_rgba(0,0,0,0.65),inset_0_2px_3px_rgba(255,255,242,0.22)]"
    >
      <p className="text-[18px] font-medium leading-[25px]">{view.heading}</p>
      <p className="flex h-[83px] items-baseline gap-[6px] whitespace-nowrap">
        <span className="text-[72px] font-light leading-[83px] tracking-[-2.16px]">{view.mainText}</span>
        {view.mainUnit !== null && <span className="text-[24px] leading-[29px]">{view.mainUnit}</span>}
      </p>
      {view.elapsedText !== null && <p className="text-[34px] font-light leading-[42px] tracking-[-1.02px]">{view.elapsedText}</p>}
      {view.paceText !== null && <p className="text-[16px] leading-6">{view.paceText}</p>}
      {view.kind === 'time' ? (
        <>
          {first !== undefined && <p className="text-[16px] leading-6">{first}</p>}
          {rest.map((line) => (
            <p key={line} className="text-[13px] leading-5 text-lime">
              {line}
            </p>
          ))}
        </>
      ) : (
        first !== undefined && <p className="text-[13px] leading-5 text-lime">{first}</p>
      )}
    </section>
  )
}

function SplitTable({ view }: { view: RecordDetailView }) {
  return (
    <>
      <h2 className="mt-6 text-[20px] font-medium leading-7">구간 기록</h2>
      {view.timeOnly !== null ? (
        <div className="mt-3 flex h-[44px] items-center gap-3">
          <p className="min-w-0 flex-1 text-[14px] leading-5 text-muted">{view.timeOnly.label}</p>
          <p className="text-[20px] leading-7">{view.timeOnly.value}</p>
        </div>
      ) : (
        view.splitRows.length > 0 && (
          <div className="mt-3 flex flex-col">
            <div aria-hidden="true" className="flex h-6 gap-3 text-[13px] leading-[18px] text-muted">
              <p className="w-[126px] shrink-0">구간</p>
              <p className="w-[90px] shrink-0 text-right">시간</p>
              <p className="w-[102px] shrink-0 text-right">페이스 /km</p>
            </div>
            <ul aria-label="구간 기록">
              {view.splitRows.map((row) => (
                <li key={row.key} className="flex h-[44px] items-center gap-3">
                  <p className="w-[126px] shrink-0 text-[14px] leading-5 text-muted">{row.label}</p>
                  <p className="w-[90px] shrink-0 text-right text-[20px] leading-7">{row.timeText}</p>
                  <p className="w-[102px] shrink-0 text-right text-[16px] leading-6 text-muted">{row.paceText}</p>
                </li>
              ))}
            </ul>
            {view.total !== null && (
              <div className="mt-[10px] flex h-7 items-center gap-3">
                <p className="w-[240px] shrink-0 text-[13px] font-medium leading-5 text-muted">{view.total.label}</p>
                <p className="w-[90px] shrink-0 text-right text-[16px] font-medium leading-6">{view.total.timeText}</p>
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}

// Figma `RECORD / Detail`. 저장된 기록의 요약·구간·리포트를 보여 주고, 리포트만 고칠 수 있다.
export function RecordDetailPage() {
  const { recordId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [result, setResult] = useState(readRecords)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<RunReflection>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  // 저장해 반영한 기록(저장소를 다시 읽지 않고 화면에 바로 보인다)
  const [now] = useState(() => new Date())
  const [updated, setUpdated] = useState<RunRecord | null>(null)

  // 목록·달력에서 왔으면 이전 화면으로, 직접 열었으면 기록 화면으로 돌아간다.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(RECORDS_PATH, { replace: true }))

  // 목록·달력과 같이 지금보다 늦게 시작한 기록은 직접 주소로 열어도 보이지 않는다.
  const found = result.ok ? findRecord(getVisibleRecords(result.records, now), recordId) : null
  const record = updated !== null && updated.recordId === found?.recordId ? updated : found

  if (!result.ok || record === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-app-bg px-6 pb-6 pt-3 font-pace text-ink">
        <ScreenHeader title="기록" onBack={goBack} />
        <div className="mt-4">
          {!result.ok ? (
            <StateCard
              title="기록을 불러오지 못했어요"
              body="연결을 확인한 뒤 다시 시도해 주세요."
              action={{ label: '다시 시도', onClick: () => setResult(readRecords()) }}
            />
          ) : (
            <StateCard
              title="기록을 찾을 수 없어요"
              body="기록 목록에서 다른 기록을 선택해 주세요."
              action={{ label: '기록으로 가기', to: RECORDS_PATH }}
            />
          )}
        </div>
      </div>
    )
  }

  const view = buildRecordDetail(record)

  const openSheet = () => {
    setDraft(startReportDraft(record))
    setError(null)
    setSheetOpen(true)
  }

  const saveReport = () => {
    try {
      const next = withReflection(record, draft)
      createRunStorage().saveRecord(next)
      setUpdated(next)
      setSheetOpen(false)
    } catch {
      // 저장에 실패하면 시트를 열어 둔 채 입력을 지키고 다시 시도하게 한다.
      setError(SAVE_ERROR)
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title={view.title} onBack={goBack} />
        <div className="mt-[18px]">
          <SummaryCard view={view} />
        </div>
        <SplitTable view={view} />
        <div className="mt-6 h-px w-full bg-line" />
        <button type="button" onClick={openSheet} className="flex h-16 w-full cursor-pointer items-center gap-3 text-left">
          <span className="min-w-0 flex-1 text-[16px] leading-6">나의 리포트</span>
          <span className="text-[14px] leading-[22px] text-muted">수정</span>
          <img src={chevronRight} alt="" aria-hidden="true" className="size-5" />
        </button>
        <p className="text-[16px] leading-6">{view.report.primary}</p>
        {view.report.secondary !== null && <p className="mt-2 text-[14px] leading-[22px] text-muted">{view.report.secondary}</p>}
        <div className="mt-5 h-px w-full bg-line" />
        <p className="mt-4 text-[13px] leading-5 text-muted">이 기록에는 자세 측정 데이터가 없어요.</p>
      </div>
      <ReflectionSheetView
        open={sheetOpen}
        draft={draft}
        subtitle={view.sheetSubtitle}
        error={error}
        onClose={() => setSheetOpen(false)}
        onDifficulty={(value) => (setError(null), setDraft((current) => setDraftDifficulty(current, value)))}
        onToggleReason={(value) => (setError(null), setDraft((current) => toggleDraftReason(current, value)))}
        onMemo={(value) => (setError(null), setDraft((current) => setDraftMemo(current, value)))}
        onSave={saveReport}
      />
    </div>
  )
}

export default RecordDetailPage
