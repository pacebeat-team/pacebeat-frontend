import { WEEKDAY_LABELS } from '../home/homeView.ts'
import { formatClock, formatDistanceKm, formatDistanceKm2, formatDuration, formatPaceOrDash, formatRemainingKm2 } from '../running/format.ts'
import { REFLECTION_MEMO_MAX } from '../running/reflection.ts'
import { normalizeReflection } from '../running/runSave.ts'
import type { ReflectionDifficulty, ReflectionReason, RunRecord, RunReflection, RunSplit } from '../running/types.ts'
import { buildRecordRow } from './recordsView.ts'

// 기록 상세 표시값 (순수 함수). 저장된 값만 보여 주고, 없는 값은 만들거나 추정하지 않는다.

const DIFFICULTY_TEXT: Record<ReflectionDifficulty, string> = {
  easy: '쉬웠어요',
  moderate: '적당했어요',
  hard: '힘들었어요',
}

// Figma 기록 상세의 문장형 표기. 지루함은 Figma 예시가 없어 같은 어미 규칙으로 맞췄다.
const REASON_TEXT: Record<ReflectionReason, string> = {
  breath: '숨이 찼어요',
  legs: '다리가 무거웠어요',
  boredom: '지루했어요',
  time: '시간이 부족했어요',
}

export const EMPTY_REPORT_PRIMARY = '오늘의 러닝 리포트'
export const EMPTY_REPORT_SECONDARY = '리포트 수정에서 내용을 확인해요.'

export interface ReportText {
  readonly primary: string
  readonly secondary: string | null
}

// "적당했어요 · 숨이 찼어요" / 메모. 리포트가 없으면 Figma의 안내 문구.
export function buildReportText(reflection: RunReflection | null): ReportText {
  if (reflection === null) return { primary: EMPTY_REPORT_PRIMARY, secondary: EMPTY_REPORT_SECONDARY }
  const parts = [
    ...(reflection.difficulty === null ? [] : [DIFFICULTY_TEXT[reflection.difficulty]]),
    ...reflection.reasons.map((reason) => REASON_TEXT[reason]),
  ]
  const memo = reflection.memo === '' ? null : reflection.memo
  if (parts.length === 0) return memo === null ? { primary: EMPTY_REPORT_PRIMARY, secondary: EMPTY_REPORT_SECONDARY } : { primary: memo, secondary: null }
  return { primary: parts.join(' · '), secondary: memo }
}

export interface SplitRowView {
  readonly key: number
  readonly label: string
  readonly timeText: string
  readonly paceText: string
}

function buildSplitRow(split: RunSplit): SplitRowView {
  return {
    key: split.index,
    label: split.distanceM >= 1000 ? `${split.index} km` : `마지막 ${(split.distanceM / 1000).toFixed(2)} km`,
    timeText: formatDuration(split.durationMs / 1000),
    paceText: formatPaceOrDash(split.paceSecPerKm),
  }
}

export interface RecordDetailView {
  // "10월 1일, 목요일"
  readonly title: string
  readonly kind: 'goal' | 'partial' | 'time'
  // 요약 카드 상단 문구
  readonly heading: string
  // 큰 값: 거리 "1.00"(단위 km) 또는 TIME 시계 "09:51"
  readonly mainText: string
  readonly mainUnit: 'km' | null
  // GPS 기록의 러닝 시간. TIME은 큰 값이 시간이므로 null
  readonly elapsedText: string | null
  // "평균 7:40 /km". TIME은 null
  readonly paceText: string | null
  // 요약 카드 보조 문구(라임). 근거가 없으면 비어 있다.
  readonly helperLines: readonly string[]
  readonly splitRows: readonly SplitRowView[]
  // GPS 합계 "합계 1.00 km" / 시간
  readonly total: { readonly label: string; readonly timeText: string } | null
  // TIME 기록은 표 대신 한 줄
  readonly timeOnly: { readonly label: string; readonly value: string } | null
  readonly report: ReportText
  // 리포트 시트 보조줄 "10.01 · 1.00 km"
  readonly sheetSubtitle: string
}

export function buildRecordDetail(record: RunRecord): RecordDetailView {
  const date = new Date(record.startedAt)
  const { completion, distanceM, elapsedMs, avgPaceSecPerKm, splits } = record.result
  const row = buildRecordRow(record)
  const title = `${date.getMonth() + 1}월 ${date.getDate()}일, ${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}요일`
  const report = buildReportText(record.reflection)
  const sheetSubtitle = `${row.dateText} · ${row.mainText}`

  if (completion === 'time' || distanceM === null) {
    return {
      title,
      kind: 'time',
      heading: '시간 기록',
      mainText: formatClock(elapsedMs),
      mainUnit: null,
      elapsedText: null,
      paceText: null,
      helperLines: ['GPS 없이 시간만 기록', '거리와 페이스는 측정하지 않았어요.'],
      splitRows: [],
      total: null,
      timeOnly: { label: '시간 기록', value: formatClock(elapsedMs) },
      report,
      sheetSubtitle,
    }
  }

  const targetKm = record.goal.targetDistanceKm
  const remainingM = targetKm === null ? null : targetKm * 1000 - distanceM
  let helper: string | null = null
  if (completion === 'goal') {
    if (targetKm !== null) helper = `목표 ${targetKm.toFixed(2)} km를 완주했어요.`
  } else if (targetKm !== null && remainingM !== null && remainingM > 0) {
    helper = `목표 ${formatDistanceKm(targetKm)} km · ${formatRemainingKm2(remainingM)} km 남았어요.`
  }

  return {
    title,
    kind: completion === 'goal' ? 'goal' : 'partial',
    heading: completion === 'goal' ? '거리 목표 완주' : '달린 만큼, 다음 한 걸음',
    mainText: formatDistanceKm2(distanceM),
    mainUnit: 'km',
    elapsedText: formatDuration(elapsedMs / 1000),
    paceText: `평균 ${formatPaceOrDash(avgPaceSecPerKm)} /km`,
    helperLines: helper === null ? [] : [helper],
    splitRows: splits.map(buildSplitRow),
    total: splits.length === 0 ? null : { label: `합계 ${formatDistanceKm2(distanceM)} km`, timeText: formatDuration(elapsedMs / 1000) },
    timeOnly: null,
    report,
    sheetSubtitle,
  }
}

// ---------------------------------------------------------------------------
// 리포트 수정 (시트의 편집본). 저장해야만 기록에 반영한다.
// ---------------------------------------------------------------------------

export const EMPTY_DRAFT: RunReflection = Object.freeze({ difficulty: null, reasons: [], memo: '' })

export function startReportDraft(record: RunRecord): RunReflection {
  return record.reflection ?? EMPTY_DRAFT
}

export function setDraftDifficulty(draft: RunReflection, difficulty: ReflectionDifficulty): RunReflection {
  return { ...draft, difficulty }
}

export function toggleDraftReason(draft: RunReflection, reason: ReflectionReason): RunReflection {
  const reasons = draft.reasons.includes(reason) ? draft.reasons.filter((item) => item !== reason) : [...draft.reasons, reason]
  return { ...draft, reasons }
}

export function setDraftMemo(draft: RunReflection, memo: string): RunReflection {
  return { ...draft, memo: memo.slice(0, REFLECTION_MEMO_MAX) }
}

// 기록에 리포트를 반영한 새 기록. 아무것도 입력하지 않았으면 null로 저장한다(결과 화면과 같은 규칙). recordId·그 밖의 값은 그대로다.
export function withReflection(record: RunRecord, draft: RunReflection): RunRecord {
  return { ...record, reflection: normalizeReflection(draft) }
}
