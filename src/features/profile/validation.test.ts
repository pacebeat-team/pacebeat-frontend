import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countNicknameChars,
  isValidBirthYear,
  isValidHeightCm,
  isValidWeightKg,
  normalizeNickname,
  validateNickname,
} from './validation.ts'

describe('countNicknameChars', () => {
  test('코드포인트 기준으로 센다', () => {
    assert.equal(countNicknameChars(''), 0)
    assert.equal(countNicknameChars('희규'), 2)
    assert.equal(countNicknameChars('abc'), 3)
  })

  test('이모지 하나는 1자다', () => {
    assert.equal(countNicknameChars('🏃'), 1)
    assert.equal(countNicknameChars('🏃🏃'), 2)
    assert.equal('🏃'.length, 2) // length 기준이었다면 2자로 셌을 값
  })
})

describe('normalizeNickname', () => {
  test('앞뒤 공백만 제거하고 안쪽 공백은 둔다', () => {
    assert.equal(normalizeNickname('  희규  '), '희규')
    assert.equal(normalizeNickname('\t희 규\n'), '희 규')
  })
})

describe('validateNickname', () => {
  test('1자는 tooShort', () => {
    assert.deepEqual(validateNickname('희'), { valid: false, reason: 'tooShort', value: '희' })
  })

  test('2자는 유효', () => {
    assert.deepEqual(validateNickname('희규'), { valid: true, value: '희규' })
  })

  test('10자는 유효', () => {
    assert.deepEqual(validateNickname('가'.repeat(10)), { valid: true, value: '가'.repeat(10) })
  })

  test('11자는 tooLong', () => {
    const value = '가'.repeat(11)
    assert.deepEqual(validateNickname(value), { valid: false, reason: 'tooLong', value })
  })

  test('빈 문자열과 공백만 입력하면 empty', () => {
    assert.deepEqual(validateNickname(''), { valid: false, reason: 'empty', value: '' })
    assert.deepEqual(validateNickname('   '), { valid: false, reason: 'empty', value: '' })
  })

  test('공백을 제거한 길이로 판단한다', () => {
    assert.deepEqual(validateNickname('  희규  '), { valid: true, value: '희규' })
    assert.equal(validateNickname(' 희 ').valid, false) // 공백 제거 후 1자
    assert.equal(validateNickname(' ' + '가'.repeat(10) + ' ').valid, true) // 공백 제거 후 10자
  })

  test('이모지를 금지하지 않고 코드포인트로 센다', () => {
    assert.equal(validateNickname('🏃🏃').valid, true)
    assert.equal(validateNickname('🏃'.repeat(10)).valid, true)
    assert.deepEqual(validateNickname('🏃'.repeat(11)), {
      valid: false,
      reason: 'tooLong',
      value: '🏃'.repeat(11),
    })
  })
})

describe('isValidBirthYear', () => {
  test('null은 허용한다', () => {
    assert.equal(isValidBirthYear(null), true)
  })

  test('양의 정수는 허용한다', () => {
    assert.equal(isValidBirthYear(2003), true)
    assert.equal(isValidBirthYear(1), true)
  })

  test('0, 음수, 소수, NaN, Infinity는 허용하지 않는다', () => {
    for (const value of [0, -1, -2003, 2003.5, NaN, Infinity, -Infinity]) {
      assert.equal(isValidBirthYear(value), false, String(value))
    }
  })
})

describe('isValidHeightCm / isValidWeightKg', () => {
  const validators = [
    ['isValidHeightCm', isValidHeightCm],
    ['isValidWeightKg', isValidWeightKg],
  ] as const

  for (const [name, validate] of validators) {
    test(`${name}: null과 양의 유한 숫자는 허용한다 (소수 포함)`, () => {
      assert.equal(validate(null), true)
      assert.equal(validate(165), true)
      assert.equal(validate(60.5), true)
      assert.equal(validate(0.1), true)
    })

    test(`${name}: 0, 음수, NaN, Infinity는 허용하지 않는다`, () => {
      for (const value of [0, -0, -1, -165.5, NaN, Infinity, -Infinity]) {
        assert.equal(validate(value), false, String(value))
      }
    })
  }
})
