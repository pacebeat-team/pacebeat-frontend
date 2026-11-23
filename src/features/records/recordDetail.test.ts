import assert from 'node:assert/strict'
import test from 'node:test'
import type { RunRecord, RunReflection } from '../running/types.ts'
import {
  buildRecordDetail,
  buildReportText,
  EMPTY_DRAFT,
  setDraftDifficulty,
  setDraftMemo,
  startReportDraft,
  toggleDraftReason,
  withReflection,
} from './recordDetail.ts'

function rec(over: Partial<Omit<RunRecord, 'result'>> & { result?: Partial<RunRecord['result']> } = {}): RunRecord {
  const { result, ...rest } = over
  return {
    recordId: 'r1',
    sessionId: 's1',
    mode: 'gps',
    startedAt: new Date(2026, 9, 1, 7).getTime(), // 2026-10-01 목
    endedAt: new Date(2026, 9, 1, 7, 8).getTime(),
    goal: { targetDistanceKm: 1, targetDurationSec: 460 },
    musicTrackId: null,
    result: {
      elapsedMs: 460_000,
      distanceM: 1000,
      avgPaceSecPerKm: 460,
      splits: [{ index: 1, distanceM: 1000, durationMs: 460_000, paceSecPerKm: 460 }],
      completion: 'goal',
      gpsGaps: [],
      ...result,
    },
    reflection: null,
    sensorReport: null,
    ...rest,
  }
}

test('상세(거리 완주): 제목·요약·구간·합계', () => {
  const view = buildRecordDetail(rec())
  assert.equal(view.title, '10월 1일, 목요일')
  assert.equal(view.kind, 'goal')
  assert.equal(view.heading, '거리 목표 완주')
  assert.equal(view.mainText, '1.00')
  assert.equal(view.mainUnit, 'km')
  assert.equal(view.elapsedText, '7:40')
  assert.equal(view.paceText, '평균 7:40 /km')
  assert.deepEqual(view.helperLines, ['목표 1.00 km를 완주했어요.'])
  assert.deepEqual(view.splitRows, [{ key: 1, label: '1 km', timeText: '7:40', paceText: '7:40' }])
  assert.deepEqual(view.total, { label: '합계 1.00 km', timeText: '7:40' })
  assert.equal(view.sheetSubtitle, '10.01 · 1.00 km')
})

test('상세(일부): 목표 전 종료 문구와 남은 거리 올림, 마지막 구간 라벨', () => {
  const view = buildRecordDetail(
    rec({
      goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
      result: {
        elapsedMs: 940_000,
        distanceM: 2100,
        avgPaceSecPerKm: 448,
        completion: 'partial',
        splits: [
          { index: 1, distanceM: 1000, durationMs: 440_000, paceSecPerKm: 440 },
          { index: 2, distanceM: 1000, durationMs: 455_000, paceSecPerKm: 455 },
          { index: 3, distanceM: 100, durationMs: 45_000, paceSecPerKm: 450 },
        ],
      },
    }),
  )
  assert.equal(view.kind, 'partial')
  assert.equal(view.heading, '달린 만큼, 다음 한 걸음')
  assert.deepEqual(view.helperLines, ['목표 3.0 km · 0.90 km 남았어요.'])
  assert.equal(view.splitRows[2].label, '마지막 0.10 km')
  assert.equal(view.splitRows[2].timeText, '0:45')
})

test('상세(일부): 목표가 없거나 이미 넘었으면 남은 거리 문구를 만들지 않는다', () => {
  const noGoal = buildRecordDetail(rec({ goal: { targetDistanceKm: null, targetDurationSec: null }, result: { completion: 'partial' } }))
  assert.deepEqual(noGoal.helperLines, [])
  const over = buildRecordDetail(rec({ goal: { targetDistanceKm: 1, targetDurationSec: 460 }, result: { completion: 'partial', distanceM: 1000 } }))
  assert.deepEqual(over.helperLines, [])
})

test('상세(TIME): 거리·페이스·구간 없이 시간만', () => {
  const view = buildRecordDetail(
    rec({
      mode: 'time',
      goal: { targetDistanceKm: null, targetDurationSec: null },
      result: { elapsedMs: 591_000, distanceM: null, avgPaceSecPerKm: null, splits: [], completion: 'time' },
    }),
  )
  assert.equal(view.kind, 'time')
  assert.equal(view.heading, '시간 기록')
  assert.equal(view.mainText, '09:51')
  assert.equal(view.mainUnit, null)
  assert.equal(view.paceText, null)
  assert.equal(view.elapsedText, null)
  assert.deepEqual(view.splitRows, [])
  assert.equal(view.total, null)
  assert.deepEqual(view.timeOnly, { label: '시간 기록', value: '09:51' })
  assert.deepEqual(view.helperLines, ['GPS 없이 시간만 기록', '거리와 페이스는 측정하지 않았어요.'])
})

test('상세: 평균 페이스가 없으면 —로 표시하고 값을 만들지 않는다', () => {
  assert.equal(buildRecordDetail(rec({ result: { avgPaceSecPerKm: null } })).paceText, '평균 — /km')
})

test('상세: 구간이 없는 GPS 기록은 합계 줄도 만들지 않는다', () => {
  const view = buildRecordDetail(rec({ result: { splits: [], distanceM: 5 } }))
  assert.deepEqual(view.splitRows, [])
  assert.equal(view.total, null)
})

test('리포트 문구: 난이도·이유·메모, 없음, 메모만', () => {
  assert.deepEqual(buildReportText({ difficulty: 'moderate', reasons: ['breath'], memo: '마지막 1 km 숨참' }), {
    primary: '적당했어요 · 숨이 찼어요',
    secondary: '마지막 1 km 숨참',
  })
  assert.deepEqual(buildReportText({ difficulty: 'easy', reasons: [], memo: '' }), { primary: '쉬웠어요', secondary: null })
  assert.deepEqual(buildReportText({ difficulty: null, reasons: [], memo: '메모만' }), { primary: '메모만', secondary: null })
  assert.deepEqual(buildReportText(null), { primary: '오늘의 러닝 리포트', secondary: '리포트 수정에서 내용을 확인해요.' })
  assert.deepEqual(buildReportText({ difficulty: null, reasons: [], memo: '' }), { primary: '오늘의 러닝 리포트', secondary: '리포트 수정에서 내용을 확인해요.' })
  assert.equal(buildReportText({ difficulty: 'hard', reasons: ['legs', 'time'], memo: '' }).primary, '힘들었어요 · 다리가 무거웠어요 · 시간이 부족했어요')
})

test('리포트 편집: 이유 토글·메모 100자 제한·시작값', () => {
  let draft: RunReflection = startReportDraft(rec())
  assert.deepEqual(draft, EMPTY_DRAFT)
  draft = setDraftDifficulty(draft, 'hard')
  draft = toggleDraftReason(draft, 'legs')
  draft = toggleDraftReason(draft, 'time')
  draft = toggleDraftReason(draft, 'legs')
  assert.deepEqual(draft.reasons, ['time'])
  assert.equal(setDraftMemo(draft, 'ㅇ'.repeat(150)).memo.length, 100)
  const saved: RunReflection = { difficulty: 'easy', reasons: [], memo: 'x' }
  assert.deepEqual(startReportDraft(rec({ reflection: saved })), saved)
})

test('withReflection: 다른 값은 그대로 두고 리포트만 바꾼다, 빈 리포트는 null', () => {
  const base = rec()
  const next = withReflection(base, { difficulty: 'easy', reasons: ['breath'], memo: '좋아요' })
  assert.deepEqual(next.reflection, { difficulty: 'easy', reasons: ['breath'], memo: '좋아요' })
  assert.deepEqual({ ...next, reflection: null }, base)
  assert.equal(withReflection(next, EMPTY_DRAFT).reflection, null)
})

test('마지막 구간 라벨은 총 거리와 같은 규칙(소수 둘째 자리 버림)이다', () => {
  const view = buildRecordDetail(
    rec({
      result: {
        elapsedMs: 36_000,
        distanceM: 105.6,
        avgPaceSecPerKm: 344,
        completion: 'partial',
        splits: [{ index: 1, distanceM: 105.6, durationMs: 36_000, paceSecPerKm: 341 }],
      },
    }),
  )
  assert.equal(view.splitRows[0].label, '마지막 0.10 km')
})
