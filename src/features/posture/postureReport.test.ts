import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildOneSide, buildPostureReport, COMPARE_DAYS, DAY_MS, postureOneSidePath, REPORT_WINDOW_DAYS } from './postureReport.ts'
import type { PostureRecordInput } from './postureReport.ts'
import type { PosturePressure, PostureSummary } from '../running/postureSummary.ts'

// 이 테스트의 숫자는 모두 이 파일 안의 가짜 입력이다(앱 어디에도 쓰이지 않는다).
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const daysAgo = (days: number) => NOW - days * DAY_MS

const both = (left: number, pressure: PosturePressure | null = null): PostureSummary => ({
  measuredSide: 'both',
  balance: { left, right: 100 - left },
  pressure,
})
const oneSide = (side: 'left' | 'right', pressure: PosturePressure | null = null): PostureSummary => ({ measuredSide: side, balance: null, pressure })
const run = (recordId: string, startedAt: number, posture: PostureSummary | null): PostureRecordInput => ({ recordId, startedAt, posture })

describe('데이터 없음', () => {
  test('기록이 없거나 자세 요약이 없으면 null이다', () => {
    assert.equal(buildPostureReport([], NOW), null)
    assert.equal(buildPostureReport([run('a', daysAgo(1), null)], NOW), null)
  })
  test('기간 밖(28일 초과)·미래 기록만 있으면 null이다', () => {
    assert.equal(buildPostureReport([run('old', daysAgo(REPORT_WINDOW_DAYS) - 1, both(50))], NOW), null)
    assert.equal(buildPostureReport([run('future', NOW + 1, both(50))], NOW), null)
  })
  test('시작 시각이 NaN인 기록은 무시한다', () => {
    assert.equal(buildPostureReport([run('nan', Number.NaN, both(50))], NOW), null)
  })
})

describe('집계 기간과 날짜 경계', () => {
  test('정확히 28일 전·지금 시각은 포함하고, 1ms 더 이르면 제외한다', () => {
    const report = buildPostureReport([run('edge', daysAgo(REPORT_WINDOW_DAYS), both(40)), run('now', NOW, both(60)), run('out', daysAgo(REPORT_WINDOW_DAYS) - 1, both(0))], NOW)
    assert.equal(report?.measuredRuns, 2)
    assert.deepEqual(report?.balance, { left: 50, right: 50 })
  })
  test('범위 표기는 4주이다', () => {
    assert.equal(buildPostureReport([run('a', daysAgo(1), both(50))], NOW)?.windowWeeks, 4)
  })
})

describe('좌우 균형', () => {
  test('양쪽 측정 기록의 평균이고 합은 항상 100이다', () => {
    const report = buildPostureReport([run('a', daysAgo(1), both(47)), run('b', daysAgo(2), both(46))], NOW)
    assert.deepEqual(report?.balance, { left: 47, right: 53 }) // 46.5 → 47
    assert.equal(report?.rightAboveEven, 3)
  })
  test('오른쪽이 50% 이하이면 rightAboveEven은 null이다', () => {
    assert.equal(buildPostureReport([run('a', daysAgo(1), both(50))], NOW)?.rightAboveEven, null)
    assert.equal(buildPostureReport([run('a', daysAgo(1), both(60))], NOW)?.rightAboveEven, null)
  })
  test('한쪽만 측정된 기록은 균형 평균에서 제외하고, 균형이 없으면 balance는 null이다', () => {
    const mixed = buildPostureReport([run('a', daysAgo(1), both(40)), run('b', daysAgo(2), oneSide('left'))], NOW)
    assert.deepEqual(mixed?.balance, { left: 40, right: 60 })
    assert.equal(mixed?.measuredRuns, 2)
    const onlyOne = buildPostureReport([run('b', daysAgo(2), oneSide('right'))], NOW)
    assert.equal(onlyOne?.balance, null)
    assert.equal(onlyOne?.comparison, null)
  })
})

describe('지난주 비교(최근 7일 vs 직전 7일)', () => {
  const week = (recordId: string, days: number, left: number) => run(recordId, daysAgo(days), both(left))
  test('최근 7일 평균과 직전 7일 평균의 오른쪽 비중을 비교한다', () => {
    const report = buildPostureReport([week('n1', 1, 47), week('n2', 3, 45), week('p1', 9, 45), week('p2', 12, 41)], NOW)
    // 최근 (47+45)/2=46 → R54, 직전 (45+41)/2=43 → R57
    assert.deepEqual(report?.comparison, { previousRight: 57, currentRight: 54 })
  })
  test('28일 전체 평균(balance)과 비교 값은 구분된다', () => {
    const report = buildPostureReport([week('n', 1, 47), week('p', 10, 45), week('old', 25, 30)], NOW)
    assert.equal(report?.balance?.right, 59) // (47+45+30)/3=40.67→41 → R59
    assert.deepEqual(report?.comparison, { previousRight: 55, currentRight: 53 })
  })
  test('한쪽 구간에 기록이 없으면 비교하지 않는다', () => {
    assert.equal(buildPostureReport([week('a', 1, 47)], NOW)?.comparison, null)
    assert.equal(buildPostureReport([week('p', 10, 45), week('old', 20, 45)], NOW)?.comparison, null)
  })
  test('이전 구간에 한쪽만 측정된 기록뿐이면 비교하지 않는다', () => {
    const report = buildPostureReport([week('a', 1, 47), run('b', daysAgo(10), oneSide('left'))], NOW)
    assert.equal(report?.comparison, null)
  })
  test('경계: 정확히 7일 전은 직전 7일, 그보다 1ms 최근이면 최근 7일에 속하고 두 구간은 겹치지 않는다', () => {
    const edge = COMPARE_DAYS * DAY_MS
    // now-7d 정각 = 직전 7일
    const r1 = buildPostureReport([run('a', NOW, both(47)), run('b', NOW - edge, both(45))], NOW)
    assert.deepEqual(r1?.comparison, { previousRight: 55, currentRight: 53 })
    // now-7d+1ms = 최근 7일 → 직전 구간이 비어 비교 없음
    const r2 = buildPostureReport([run('a', NOW, both(47)), run('b', NOW - edge + 1, both(45))], NOW)
    assert.equal(r2?.comparison, null)
    // 같은 기록이 두 구간에 동시에 들어가지 않는다: 한 기록만으로는 비교가 만들어지지 않는다
    assert.equal(buildPostureReport([run('only', NOW - edge, both(47))], NOW)?.comparison, null)
    // now-14d 정각은 직전 7일 밖(제외), 1ms 안쪽은 포함
    assert.equal(buildPostureReport([run('a', NOW, both(47)), run('b', NOW - 2 * edge, both(45))], NOW)?.comparison, null)
    assert.ok(buildPostureReport([run('a', NOW, both(47)), run('b', NOW - 2 * edge + 1, both(45))], NOW)?.comparison)
  })
  test('미래 기록은 어느 구간에도 쓰지 않는다', () => {
    assert.equal(buildPostureReport([week('a', 1, 47), run('f', NOW + 1, both(45))], NOW)?.comparison, null)
  })
})

describe('착지 압력 분포(최근 3회)', () => {
  const zones = (heel: number, mid: number, forefoot: number): PosturePressure => ({ heel, mid, forefoot })
  test('압력이 있는 최근 3회만 쓰고 합이 100이 되게 반올림한다', () => {
    const report = buildPostureReport(
      [
        run('r1', daysAgo(1), both(50, zones(60, 30, 10))),
        run('r2', daysAgo(2), both(50, zones(70, 20, 10))),
        run('r3', daysAgo(3), both(50, zones(50, 40, 10))),
        run('r4-old', daysAgo(4), both(50, zones(0, 0, 100))),
      ],
      NOW,
    )
    assert.deepEqual(report?.pressure, { heel: 60, mid: 30, forefoot: 10, runs: 3 })
    assert.equal(report?.heelDominant, true)
  })
  test('압력 없는 기록은 건너뛰고 그다음 기록을 쓴다', () => {
    const report = buildPostureReport([run('r1', daysAgo(1), both(50)), run('r2', daysAgo(2), both(50, zones(20, 30, 50)))], NOW)
    assert.deepEqual(report?.pressure, { heel: 20, mid: 30, forefoot: 50, runs: 1 })
    assert.equal(report?.heelDominant, false)
  })
  test('한쪽만 측정된 기록의 압력도 압력 분포에는 쓸 수 있다', () => {
    const report = buildPostureReport([run('r1', daysAgo(1), oneSide('left', zones(10, 20, 70)))], NOW)
    assert.equal(report?.pressure?.forefoot, 70)
  })
  test('평균이 소수일 때 합이 100이 된다', () => {
    const report = buildPostureReport([run('a', daysAgo(1), both(50, zones(33.4, 33.3, 33.3))), run('b', daysAgo(2), both(50, zones(33.3, 33.4, 33.3)))], NOW)
    const p = report?.pressure
    assert.equal((p?.heel ?? 0) + (p?.mid ?? 0) + (p?.forefoot ?? 0), 100)
  })
  test('압력 데이터가 하나도 없으면 pressure는 null이고 보이는 점도 없다', () => {
    const report = buildPostureReport([run('a', daysAgo(1), both(50))], NOW)
    assert.equal(report?.pressure, null)
    assert.equal(report?.heelDominant, false)
  })
  test('가장 큰 구역이 뒤꿈치가 아니거나 동점이면 heelDominant가 아니다', () => {
    assert.equal(buildPostureReport([run('a', daysAgo(1), both(50, zones(40, 40, 20)))], NOW)?.heelDominant, false)
  })
})

describe('한쪽 측정 기록 제외와 One side', () => {
  test('가장 최근 한쪽 측정 기록을 제외 안내로 남기고 기록은 그대로 둔다', () => {
    const inputs = [run('a', daysAgo(1), both(47)), run('old-one', daysAgo(9), oneSide('right')), run('new-one', daysAgo(3), oneSide('left'))]
    const report = buildPostureReport(inputs, NOW)
    assert.deepEqual(report?.excluded, { recordId: 'new-one', startedAt: daysAgo(3), side: 'left' })
    assert.equal(inputs.length, 3)
  })
  test('한쪽 측정 기록이 없으면 excluded는 null이다', () => {
    assert.equal(buildPostureReport([run('a', daysAgo(1), both(47))], NOW)?.excluded, null)
  })
  test('One side 모델은 한쪽만 측정된 기록에만 만들고 기간 제한이 없다', () => {
    const inputs = [run('one', daysAgo(100), oneSide('right')), run('both', daysAgo(1), both(50)), run('none', daysAgo(1), null)]
    assert.deepEqual(buildOneSide(inputs, 'one'), { recordId: 'one', startedAt: daysAgo(100), side: 'right' })
    assert.equal(buildOneSide(inputs, 'both'), null)
    assert.equal(buildOneSide(inputs, 'none'), null)
    assert.equal(buildOneSide(inputs, 'missing'), null)
  })
  test('One side 경로는 기록 id를 인코딩한다', () => {
    assert.equal(postureOneSidePath('rec a/1'), '/growth/posture/rec%20a%2F1')
  })
})

describe('집계는 입력을 바꾸지 않고 결과를 저장하지 않는다', () => {
  test('입력 배열과 요소가 그대로이고 같은 입력은 같은 결과이다', () => {
    const inputs = [run('a', daysAgo(1), both(47)), run('b', daysAgo(2), oneSide('left'))]
    const snapshot = JSON.stringify(inputs)
    const first = buildPostureReport(inputs, NOW)
    assert.equal(JSON.stringify(inputs), snapshot)
    assert.deepEqual(buildPostureReport(inputs, NOW), first)
  })
})

describe('확정 정책 B·C: 한쪽 측정 압력, 동일 가중, 제외 대상', () => {
  const z = (heel: number, mid: number, forefoot: number): PosturePressure => ({ heel, mid, forefoot })
  test('같은 날 여러 번 측정해도 기록마다 같은 비중이다(날짜 가중 없음)', () => {
    // 같은 날 3건(좌 40) + 다른 날 1건(좌 60): 기록 평균 (40*3+60)/4=45 → R55 (날짜 평균이면 50)
    const report = buildPostureReport([run('a', daysAgo(2), both(40)), run('b', daysAgo(2) + 1, both(40)), run('c', daysAgo(2) + 2, both(40)), run('d', daysAgo(9), both(60))], NOW)
    assert.equal(report?.balance?.right, 55)
  })
  test('한쪽 측정 기록의 압력은 최근 3회에 들어가고 균형에는 들어가지 않는다', () => {
    const report = buildPostureReport(
      [run('one', daysAgo(1), oneSide('left', z(100, 0, 0))), run('b1', daysAgo(2), both(50, z(0, 100, 0))), run('b2', daysAgo(3), both(50, z(0, 0, 100)))],
      NOW,
    )
    assert.equal(report?.pressure?.runs, 3)
    assert.deepEqual([report?.pressure?.heel, report?.pressure?.mid, report?.pressure?.forefoot], [34, 33, 33])
    assert.equal(report?.balance?.left, 50) // 한쪽 측정은 반영되지 않는다
  })
  test('한쪽 측정값으로 반대쪽 값을 만들지 않는다(균형은 양쪽 측정 기록만 있을 때)', () => {
    const report = buildPostureReport([run('one', daysAgo(1), oneSide('right', z(50, 30, 20)))], NOW)
    assert.equal(report?.balance, null)
    assert.equal(report?.comparison, null)
    assert.equal(report?.excluded?.side, 'right')
  })
  test('손상된 요약(null로 정규화된 것)은 집계에서 빠진다', () => {
    const report = buildPostureReport([run('bad', daysAgo(1), null), run('ok', daysAgo(2), both(40))], NOW)
    assert.equal(report?.measuredRuns, 1)
  })
})
