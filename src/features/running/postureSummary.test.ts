import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeSensorReport, parsePostureSummary } from './postureSummary.ts'

const both = { measuredSide: 'both', balance: { left: 47, right: 53 }, pressure: { heel: 60, mid: 30, forefoot: 10 } }

describe('자세 요약 검증', () => {
  test('양쪽 측정·한쪽 측정·압력 없음은 유효하다', () => {
    assert.deepEqual(parsePostureSummary(both), both)
    assert.deepEqual(parsePostureSummary({ measuredSide: 'left', balance: null, pressure: null }), { measuredSide: 'left', balance: null, pressure: null })
    assert.deepEqual(parsePostureSummary({ ...both, pressure: null })?.pressure, null)
  })
  test('양쪽 측정인데 좌우 비율이 없거나, 한쪽 측정인데 좌우 비율이 있으면 폐기한다', () => {
    assert.equal(parsePostureSummary({ ...both, balance: null }), null)
    assert.equal(parsePostureSummary({ ...both, measuredSide: 'right' }), null)
  })
  test('범위 밖·NaN·문자열·합이 100이 아닌 값은 폐기하고 0으로 바꾸지 않는다', () => {
    for (const balance of [{ left: -1, right: 101 }, { left: Number.NaN, right: 50 }, { left: '47', right: 53 }, { left: 40, right: 40 }, { left: 47 }]) {
      assert.equal(parsePostureSummary({ ...both, balance }), null)
    }
    assert.equal(parsePostureSummary({ ...both, pressure: { heel: 90, mid: 30, forefoot: 10 } }), null)
    assert.equal(parsePostureSummary({ ...both, pressure: { heel: 60, mid: 30 } }), null)
  })
  test('반올림 오차(합 99.5~100.5)는 허용한다', () => {
    assert.ok(parsePostureSummary({ ...both, balance: { left: 46.7, right: 53.2 } }))
  })
  test('알 수 없는 측정 방향·객체가 아닌 값은 폐기한다', () => {
    for (const value of ['x', 1, [], { ...both, measuredSide: 'center' }, { ...both, measuredSide: undefined }]) assert.equal(parsePostureSummary(value), null)
  })
  test('허용하지 않은 필드(원시 샘플 등)는 버리고 새 객체로 돌려준다', () => {
    const parsed = parsePostureSummary({ ...both, samples: [1, 2, 3], raw: { x: 1 } })
    assert.deepEqual(Object.keys(parsed ?? {}).sort(), ['balance', 'measuredSide', 'pressure'])
  })
  test('normalizeSensorReport: null·undefined는 null, 손상은 null, 유효하면 그대로', () => {
    assert.equal(normalizeSensorReport(null), null)
    assert.equal(normalizeSensorReport(undefined), null)
    assert.equal(normalizeSensorReport({ quality: 'good' }), null)
    assert.deepEqual(normalizeSensorReport(both), both)
  })
})
