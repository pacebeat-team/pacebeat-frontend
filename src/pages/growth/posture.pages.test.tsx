import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRunStorage, RUN_STORAGE_KEYS } from '../../features/running/runStorage'
import type { RunRecord } from '../../features/running/types'
import type { PostureSummary } from '../../features/running/postureSummary'
import { PostureOneSidePage } from './PostureOneSidePage'
import { PosturePage } from './PosturePage'

// 이 파일의 기록·수치는 모두 테스트 전용 가상 입력이다(앱에는 쓰이지 않는다).
const DAY = 24 * 60 * 60 * 1000

function rec(id: string, daysAgo: number, sensorReport: PostureSummary | null): RunRecord {
  const startedAt = Date.now() - daysAgo * DAY
  return {
    recordId: id,
    sessionId: `s-${id}`,
    mode: 'gps',
    startedAt,
    endedAt: startedAt + 1_800_000,
    goal: { targetDistanceKm: null, targetDurationSec: null },
    musicTrackId: null,
    result: { elapsedMs: 1_800_000, distanceM: 3000, avgPaceSecPerKm: 424, splits: [], completion: 'partial', gpsGaps: [] },
    reflection: null,
    sensorReport,
  }
}
const both = (left: number): PostureSummary => ({ measuredSide: 'both', balance: { left, right: 100 - left }, pressure: { heel: 50, mid: 30, forefoot: 20 } })
const leftOnly: PostureSummary = { measuredSide: 'left', balance: null, pressure: { heel: 40, mid: 40, forefoot: 20 } }

function seed(records: RunRecord[]) {
  const storage = createRunStorage()
  for (const record of records) storage.saveRecord(record)
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/growth/posture" element={<PosturePage />} />
        <Route path="/growth/posture/:recordId" element={<PostureOneSidePage />} />
        <Route path="/growth" element={<div>growth-home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('자세 리포트 화면', () => {
  it('기록이 없으면 No data이고 예시 표시도 없다', () => {
    renderAt('/growth/posture')
    expect(screen.getByText('인솔 연결 확인')).toBeTruthy()
    expect(screen.queryByText(/측정 예시|예시/)).toBeNull()
  })
  it('자세 요약이 없는 기록뿐이면 No data이다', () => {
    seed([rec('a', 1, null)])
    renderAt('/growth/posture')
    expect(screen.getByText('인솔 연결 확인')).toBeTruthy()
  })
  it('양쪽·한쪽 측정 기록이 있으면 Report이고 한쪽 측정은 좌우 비교에서 제외한다고 알리며 One side 링크가 있다', () => {
    seed([rec('both1', 1, both(46)), rec('one', 2, leftOnly)])
    renderAt('/growth/posture')
    expect(screen.queryByText('인솔 연결 확인')).toBeNull()
    expect(screen.getByText(/왼쪽만 측정되어 좌우 비교에서 제외했어요/)).toBeTruthy()
    const link = screen.getByText('한쪽만 측정된 상태 보기').closest('a')
    expect(link?.getAttribute('href')).toBe('/growth/posture/one')
    expect(screen.queryByText(/품질|측정 예시/)).toBeNull()
  })
  it('지난주 비교는 최근 7일과 직전 7일 기록이 모두 있을 때만 보인다', () => {
    seed([rec('n', 1, both(46))])
    const first = renderAt('/growth/posture')
    expect(screen.queryByText('지난주와 비교')).toBeNull()
    first.unmount()
    seed([rec('p', 9, both(44))])
    renderAt('/growth/posture')
    expect(screen.getByText('지난주와 비교')).toBeTruthy()
    expect(screen.getByText(/오른쪽 비중 56% → 54%/)).toBeTruthy()
  })
  it('손상된 자세 요약은 기록만 보존하고 리포트에는 쓰지 않는다(No data)', () => {
    seed([rec('bad', 1, null)])
    const raw = JSON.parse(localStorage.getItem(RUN_STORAGE_KEYS.records) as string)
    const list = raw.data ?? raw
    ;(Array.isArray(list) ? list : list.records)[0].sensorReport = { measuredSide: 'both', balance: { left: 999, right: 1 }, pressure: null }
    localStorage.setItem(RUN_STORAGE_KEYS.records, JSON.stringify(raw))
    expect(localStorage.getItem(RUN_STORAGE_KEYS.records)).toContain('999')
    const read = createRunStorage().readRecords()
    expect(read.ok && read.records.length).toBe(1) // 러닝 기록은 보존
    expect(read.ok && read.records[0].sensorReport).toBeNull() // 손상된 요약만 폐기
    renderAt('/growth/posture')
    expect(screen.getByText('인솔 연결 확인')).toBeTruthy()
  })
})

describe('One side 화면', () => {
  it('한쪽만 측정된 기록은 One side를 보여 준다', () => {
    seed([rec('one', 2, leftOnly)])
    renderAt('/growth/posture/one')
    expect(screen.getByText('왼쪽 측정 기록')).toBeTruthy()
    expect(screen.getByText(/좌우 비교 통계에서 제외돼요/)).toBeTruthy()
  })
  it('없는 recordId·양쪽 측정 기록·잘못된 id는 자세 리포트로 보낸다', () => {
    seed([rec('both1', 1, both(46))])
    const a = renderAt('/growth/posture/nope')
    expect(screen.queryByText('왼쪽 측정 기록')).toBeNull()
    expect(screen.getAllByText('자세 리포트').length).toBeGreaterThan(0)
    a.unmount()
    renderAt('/growth/posture/both1')
    expect(screen.queryByText(/측정 기록$/)).toBeNull()
    expect(screen.getAllByText('자세 리포트').length).toBeGreaterThan(0)
  })
})
