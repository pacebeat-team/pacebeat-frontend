import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import {
  BIRTH_YEAR_DEFAULT,
  BIRTH_YEAR_MIN,
  GENDER_OPTIONS,
  createDemographicsDraft,
  getBirthYearOptions,
  isBirthYearInRange,
  submitDemographics,
} from './demographics.ts'
import type { DemographicsWriter } from './demographics.ts'
import { resolveInitialValue } from './pickerOptions.ts'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'

const THIS_YEAR = 2026

function createFakeStorage() {
  const map = new Map<string, string>()
  const storage: StateStorage = {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value)
    },
    removeItem: (name) => {
      map.delete(name)
    },
  }
  return { storage, map }
}

function createRecordingWriter() {
  const calls: unknown[][] = []
  const writer: DemographicsWriter = {
    setProfile: (...args) => {
      calls.push(args)
    },
  }
  return { writer, calls }
}

describe('출생연도 선택지', () => {
  test('1900년부터 현재 연도까지이고 최신 연도부터 내림차순이다', () => {
    const options = getBirthYearOptions(THIS_YEAR)
    assert.equal(options[0], THIS_YEAR)
    assert.equal(options[options.length - 1], BIRTH_YEAR_MIN)
    assert.equal(options.length, THIS_YEAR - BIRTH_YEAR_MIN + 1)
    for (let i = 1; i < options.length; i++) assert.equal(options[i - 1] - options[i], 1)
  })

  test('상한은 현재 연도 기준으로 바뀐다', () => {
    assert.equal(getBirthYearOptions(2027)[0], 2027)
    assert.equal(getBirthYearOptions(2030)[0], 2030)
    assert.equal(getBirthYearOptions(2030).length, getBirthYearOptions(2026).length + 4)
  })

  test('연도를 넘기지 않으면 실제 현재 연도를 쓴다', () => {
    assert.equal(getBirthYearOptions()[0], new Date().getFullYear())
  })

  test('1900년과 현재 연도는 범위 안이고 그 바깥은 범위 밖이다', () => {
    assert.equal(isBirthYearInRange(1900, THIS_YEAR), true)
    assert.equal(isBirthYearInRange(THIS_YEAR, THIS_YEAR), true)
    assert.equal(isBirthYearInRange(1899, THIS_YEAR), false)
    assert.equal(isBirthYearInRange(THIS_YEAR + 1, THIS_YEAR), false)
    assert.equal(isBirthYearInRange(2000.5, THIS_YEAR), false)
  })

  test('임시 기본값 2000년은 선택지 안에 있다', () => {
    assert.equal(BIRTH_YEAR_DEFAULT, 2000)
    assert.ok(getBirthYearOptions(THIS_YEAR).includes(BIRTH_YEAR_DEFAULT))
  })
})

describe('시트 초기 선택값', () => {
  const options = getBirthYearOptions(THIS_YEAR)

  test('저장된 값이 없으면 2000년을 임시 선택값으로 쓴다', () => {
    assert.equal(resolveInitialValue(null, options, BIRTH_YEAR_DEFAULT), 2000)
  })

  test('저장된 값이 있으면 그 값에서 시작한다', () => {
    assert.equal(resolveInitialValue(1995, options, BIRTH_YEAR_DEFAULT), 1995)
    assert.equal(resolveInitialValue(1900, options, BIRTH_YEAR_DEFAULT), 1900)
    assert.equal(resolveInitialValue(THIS_YEAR, options, BIRTH_YEAR_DEFAULT), THIS_YEAR)
  })
})

describe('성별 선택지', () => {
  test('여성, 남성, 선택 안 함 순서이고 선택 안 함은 null이다', () => {
    assert.deepEqual(
      GENDER_OPTIONS.map((option) => [option.label, option.value]),
      [
        ['여성', 'female'],
        ['남성', 'male'],
        ['선택 안 함', null],
      ],
    )
  })
})

describe('createDemographicsDraft', () => {
  test('저장된 값이 없으면 출생연도와 성별 모두 null이다', () => {
    assert.deepEqual(createDemographicsDraft({ birthYear: null, gender: null }, THIS_YEAR), {
      birthYear: null,
      gender: null,
    })
  })

  test('저장된 값에서 시작한다', () => {
    assert.deepEqual(createDemographicsDraft({ birthYear: 1995, gender: 'male' }, THIS_YEAR), {
      birthYear: 1995,
      gender: 'male',
    })
  })

  test('선택 범위를 벗어난 저장 출생연도는 미선택(null)으로 시작한다', () => {
    assert.equal(createDemographicsDraft({ birthYear: 1800, gender: null }, THIS_YEAR).birthYear, null)
    assert.equal(createDemographicsDraft({ birthYear: THIS_YEAR + 5, gender: null }, THIS_YEAR).birthYear, null)
  })
})

describe('submitDemographics', () => {
  test('출생연도와 성별을 저장하고 true를 돌려준다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitDemographics(store.getState(), { birthYear: 1995, gender: 'female' }, THIS_YEAR), true)
    assert.equal(store.getState().profile.birthYear, 1995)
    assert.equal(store.getState().profile.gender, 'female')
  })

  test('둘 다 선택하지 않아도(null) 저장할 수 있다', () => {
    const { writer, calls } = createRecordingWriter()
    assert.equal(submitDemographics(writer, { birthYear: null, gender: null }, THIS_YEAR), true)
    assert.deepEqual(calls, [[{ birthYear: null, gender: null }]])
  })

  test('"선택 안 함"(null)을 저장하면 기존 성별이 null이 된다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ gender: 'male' })
    submitDemographics(store.getState(), { birthYear: null, gender: null }, THIS_YEAR)
    assert.equal(store.getState().profile.gender, null)
  })

  test('경계 연도 1900과 현재 연도는 저장된다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitDemographics(store.getState(), { birthYear: 1900, gender: null }, THIS_YEAR), true)
    assert.equal(store.getState().profile.birthYear, 1900)
    assert.equal(submitDemographics(store.getState(), { birthYear: THIS_YEAR, gender: null }, THIS_YEAR), true)
    assert.equal(store.getState().profile.birthYear, THIS_YEAR)
  })

  test('선택 범위 밖 출생연도는 저장하지 않고 false를 돌려준다', () => {
    for (const birthYear of [1899, THIS_YEAR + 1, 0, -5, 2000.5, Number.NaN]) {
      const { writer, calls } = createRecordingWriter()
      assert.equal(submitDemographics(writer, { birthYear, gender: 'female' }, THIS_YEAR), false, String(birthYear))
      assert.equal(calls.length, 0)
    }
  })

  test('닉네임, 키, 몸무게는 건드리지 않는다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규', heightCm: 170, weightKg: 65 })
    submitDemographics(store.getState(), { birthYear: 1995, gender: 'male' }, THIS_YEAR)
    assert.deepEqual(store.getState().profile, {
      nickname: '희규',
      birthYear: 1995,
      gender: 'male',
      heightCm: 170,
      weightKg: 65,
    })
  })

  test('저장한 값은 새로고침 뒤에도 복원된다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    submitDemographics(store.getState(), { birthYear: 1990, gender: 'female' }, THIS_YEAR)
    assert.ok(map.has(PROFILE_STORAGE_KEY))
    const restored = createProfileStore(storage)
    assert.equal(restored.getState().profile.birthYear, 1990)
    assert.equal(restored.getState().profile.gender, 'female')
    assert.deepEqual(createDemographicsDraft(restored.getState().profile, THIS_YEAR), {
      birthYear: 1990,
      gender: 'female',
    })
  })

  test('범위 밖 출생연도로 제출이 거부돼도 기존 저장값은 그대로다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ birthYear: 1990, gender: 'female' })
    assert.equal(submitDemographics(store.getState(), { birthYear: 1899, gender: 'male' }, THIS_YEAR), false)
    assert.equal(store.getState().profile.birthYear, 1990)
    assert.equal(store.getState().profile.gender, 'female')
  })
})
