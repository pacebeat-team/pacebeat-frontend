import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { KEYBOARD_MIN_INSET, computeKeyboardInset } from './keyboardInset.ts'

describe('computeKeyboardInset', () => {
  test('보이는 영역이 레이아웃 뷰포트와 같으면 0이다', () => {
    assert.equal(computeKeyboardInset(844, 844, 0), 0)
  })

  test('키보드가 올라와 보이는 영역이 줄면 그 차이를 돌려준다', () => {
    assert.equal(computeKeyboardInset(844, 510, 0), 334)
  })

  test('페이지가 위로 밀려 offsetTop이 있으면 그만큼 뺀다', () => {
    assert.equal(computeKeyboardInset(844, 500, 40), 304)
  })

  test('주소창 정도의 작은 차이는 키보드로 보지 않는다', () => {
    assert.equal(computeKeyboardInset(844, 844 - (KEYBOARD_MIN_INSET - 1), 0), 0)
    assert.equal(computeKeyboardInset(844, 844 - KEYBOARD_MIN_INSET, 0), KEYBOARD_MIN_INSET)
  })

  test('보이는 영역이 더 크거나 값이 올바르지 않으면 0이다', () => {
    assert.equal(computeKeyboardInset(800, 844, 0), 0)
    assert.equal(computeKeyboardInset(844, Number.NaN, 0), 0)
  })
})
