import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRange, clampIndex, formatValue, resolveInitialValue } from './pickerOptions.ts'

describe('buildRange', () => {
  test('min과 max를 포함해 오름차순으로 만든다', () => {
    assert.deepEqual(buildRange(1, 5), [1, 2, 3, 4, 5])
  })

  test('min과 max가 같으면 값 하나다', () => {
    assert.deepEqual(buildRange(7, 7), [7])
  })

  test('min이 max보다 크면 빈 목록이다', () => {
    assert.deepEqual(buildRange(5, 1), [])
  })

  test('step 간격으로 만든다', () => {
    assert.deepEqual(buildRange(0, 10, 5), [0, 5, 10])
  })

  test('1단위로 빠짐없이 만든다 (100~220cm 규모)', () => {
    const range = buildRange(100, 220)
    assert.equal(range.length, 121)
    assert.equal(range[0], 100)
    assert.equal(range[range.length - 1], 220)
    for (let i = 1; i < range.length; i++) assert.equal(range[i] - range[i - 1], 1)
  })
})

describe('resolveInitialValue', () => {
  const options = [10, 20, 30]

  test('저장된 값이 선택지에 있으면 그 값을 쓴다', () => {
    assert.equal(resolveInitialValue(20, options, 30), 20)
  })

  test('저장된 값이 없으면(null) 기본값을 쓴다', () => {
    assert.equal(resolveInitialValue(null, options, 30), 30)
  })

  test('저장된 값이 선택지에 없으면 기본값을 쓴다', () => {
    assert.equal(resolveInitialValue(25, options, 30), 30)
    assert.equal(resolveInitialValue(0, options, 30), 30)
  })

  test('기본값도 선택지에 없으면 첫 번째 선택지를 쓴다', () => {
    assert.equal(resolveInitialValue(null, options, 99), 10)
  })

  test('선택지가 비어 있으면 기본값을 돌려준다', () => {
    assert.equal(resolveInitialValue(null, [], 99), 99)
  })
})

describe('clampIndex', () => {
  test('범위 안의 인덱스는 그대로 둔다', () => {
    assert.equal(clampIndex(0, 5), 0)
    assert.equal(clampIndex(4, 5), 4)
  })

  test('범위를 벗어나면 가장 가까운 끝으로 맞춘다', () => {
    assert.equal(clampIndex(-3, 5), 0)
    assert.equal(clampIndex(9, 5), 4)
  })

  test('선택지가 비어 있으면 0이다', () => {
    assert.equal(clampIndex(3, 0), 0)
  })
})

describe('formatValue', () => {
  test('값이 있으면 숫자 문자열이다 (단위는 붙이지 않는다)', () => {
    assert.equal(formatValue(165), '165')
    assert.equal(formatValue(2003), '2003')
  })

  test('값이 없으면 줄표다', () => {
    assert.equal(formatValue(null), '—')
  })
})
