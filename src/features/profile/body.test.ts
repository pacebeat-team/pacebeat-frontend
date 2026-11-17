import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import {
  HEIGHT_DEFAULT_CM,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  HEIGHT_OPTIONS,
  WEIGHT_DEFAULT_KG,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  WEIGHT_OPTIONS,
  createBodyDraft,
  isHeightInRange,
  isWeightInRange,
  submitBody,
} from './body.ts'
import type { BodyWriter } from './body.ts'
import { formatValue, resolveInitialValue } from './pickerOptions.ts'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'

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
  const writer: BodyWriter = {
    setProfile: (...args) => {
      calls.push(args)
    },
  }
  return { writer, calls }
}

function assertOneStepAscending(values: readonly number[]) {
  for (let i = 1; i < values.length; i++) assert.equal(values[i] - values[i - 1], 1)
}

describe('키·몸무게 선택지', () => {
  test('키는 100~220cm를 1cm 단위로 빠짐없이 담는다', () => {
    assert.equal(HEIGHT_OPTIONS[0], 100)
    assert.equal(HEIGHT_OPTIONS[HEIGHT_OPTIONS.length - 1], 220)
    assert.equal(HEIGHT_OPTIONS.length, 121)
    assertOneStepAscending(HEIGHT_OPTIONS)
  })

  test('몸무게는 20~200kg를 1kg 단위로 빠짐없이 담는다', () => {
    assert.equal(WEIGHT_OPTIONS[0], 20)
    assert.equal(WEIGHT_OPTIONS[WEIGHT_OPTIONS.length - 1], 200)
    assert.equal(WEIGHT_OPTIONS.length, 181)
    assertOneStepAscending(WEIGHT_OPTIONS)
  })

  test('임시 기본값 165cm, 60kg은 선택지 안에 있다', () => {
    assert.equal(HEIGHT_DEFAULT_CM, 165)
    assert.equal(WEIGHT_DEFAULT_KG, 60)
    assert.ok(HEIGHT_OPTIONS.includes(HEIGHT_DEFAULT_CM))
    assert.ok(WEIGHT_OPTIONS.includes(WEIGHT_DEFAULT_KG))
  })

  test('경계값은 범위 안이고 그 바깥과 소수는 범위 밖이다', () => {
    assert.equal(isHeightInRange(HEIGHT_MIN_CM), true)
    assert.equal(isHeightInRange(HEIGHT_MAX_CM), true)
    assert.equal(isHeightInRange(99), false)
    assert.equal(isHeightInRange(221), false)
    assert.equal(isHeightInRange(165.5), false)
    assert.equal(isWeightInRange(WEIGHT_MIN_KG), true)
    assert.equal(isWeightInRange(WEIGHT_MAX_KG), true)
    assert.equal(isWeightInRange(19), false)
    assert.equal(isWeightInRange(201), false)
    assert.equal(isWeightInRange(60.5), false)
  })
})

describe('시트 초기 선택값', () => {
  test('저장된 값이 없으면 165cm, 60kg을 임시 선택값으로 쓴다', () => {
    assert.equal(resolveInitialValue(null, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM), 165)
    assert.equal(resolveInitialValue(null, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG), 60)
  })

  test('저장된 값이 있으면 그 값에서 시작한다 (경계 포함)', () => {
    assert.equal(resolveInitialValue(170, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM), 170)
    assert.equal(resolveInitialValue(100, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM), 100)
    assert.equal(resolveInitialValue(220, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM), 220)
    assert.equal(resolveInitialValue(65, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG), 65)
    assert.equal(resolveInitialValue(20, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG), 20)
    assert.equal(resolveInitialValue(200, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG), 200)
  })
})

describe('시트 초기 선택값 (범위 밖)', () => {
  test('선택지에 없는 저장값은 임시 기본값으로 대신한다', () => {
    assert.equal(resolveInitialValue(250, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM), 165)
    assert.equal(resolveInitialValue(Number.POSITIVE_INFINITY, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG), 60)
  })
})

describe('값 표기', () => {
  test('값이 있으면 숫자만, 없으면 줄표다 (단위는 따로 붙는다)', () => {
    assert.equal(formatValue(165), '165')
    assert.equal(formatValue(null), '—')
  })
})

describe('createBodyDraft', () => {
  test('저장된 값이 없으면 둘 다 null이다 (기본값으로 채우지 않는다)', () => {
    assert.deepEqual(createBodyDraft({ heightCm: null, weightKg: null }), { heightCm: null, weightKg: null })
  })

  test('저장된 값에서 시작한다', () => {
    assert.deepEqual(createBodyDraft({ heightCm: 170, weightKg: 65 }), { heightCm: 170, weightKg: 65 })
  })

  test('범위를 벗어난 값이나 소수는 미선택(null)으로 시작한다', () => {
    assert.deepEqual(createBodyDraft({ heightCm: 250, weightKg: 10 }), { heightCm: null, weightKg: null })
    assert.deepEqual(createBodyDraft({ heightCm: 165.5, weightKg: 60.5 }), { heightCm: null, weightKg: null })
  })

  test('draft를 바꿔도 submit 전에는 Store가 그대로다 (저장 170/65, draft 175 → 건너뛰기 상황)', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ heightCm: 170, weightKg: 65 })
    const draft = createBodyDraft(store.getState().profile)
    draft.heightCm = 175
    assert.equal(store.getState().profile.heightCm, 170)
    assert.equal(store.getState().profile.weightKg, 65)
  })

  test('한쪽만 저장돼 있으면 그쪽만 값을 가진다', () => {
    assert.deepEqual(createBodyDraft({ heightCm: 170, weightKg: null }), { heightCm: 170, weightKg: null })
  })
})

describe('submitBody', () => {
  test('키와 몸무게를 저장하고 true를 돌려준다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitBody(store.getState(), { heightCm: 175, weightKg: 70 }), true)
    assert.equal(store.getState().profile.heightCm, 175)
    assert.equal(store.getState().profile.weightKg, 70)
  })

  test('둘 다 선택하지 않아도(null) 저장할 수 있다', () => {
    const { writer, calls } = createRecordingWriter()
    assert.equal(submitBody(writer, { heightCm: null, weightKg: null }), true)
    assert.deepEqual(calls, [[{ heightCm: null, weightKg: null }]])
  })

  test('한쪽만 선택해도 저장된다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitBody(store.getState(), { heightCm: 180, weightKg: null }), true)
    assert.equal(store.getState().profile.heightCm, 180)
    assert.equal(store.getState().profile.weightKg, null)
  })

  test('경계값 100cm, 220cm, 20kg, 200kg은 저장된다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitBody(store.getState(), { heightCm: 100, weightKg: 20 }), true)
    assert.deepEqual([store.getState().profile.heightCm, store.getState().profile.weightKg], [100, 20])
    assert.equal(submitBody(store.getState(), { heightCm: 220, weightKg: 200 }), true)
    assert.deepEqual([store.getState().profile.heightCm, store.getState().profile.weightKg], [220, 200])
  })

  test('선택 범위 밖이면 아무것도 저장하지 않고 false를 돌려준다', () => {
    const invalid = [
      { heightCm: 99, weightKg: 60 },
      { heightCm: 221, weightKg: 60 },
      { heightCm: 165, weightKg: 19 },
      { heightCm: 165, weightKg: 201 },
      { heightCm: 165.5, weightKg: 60 },
      { heightCm: 165, weightKg: 60.5 },
      { heightCm: 0, weightKg: 60 },
      { heightCm: Number.NaN, weightKg: 60 },
      { heightCm: Number.POSITIVE_INFINITY, weightKg: 60 },
      { heightCm: 165, weightKg: -1 },
    ]
    for (const draft of invalid) {
      const { writer, calls } = createRecordingWriter()
      assert.equal(submitBody(writer, draft), false, JSON.stringify(draft))
      assert.equal(calls.length, 0)
    }
  })

  test('거부된 제출은 기존에 저장된 값을 바꾸지 않는다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ heightCm: 170, weightKg: 65 })
    assert.equal(submitBody(store.getState(), { heightCm: 300, weightKg: 70 }), false)
    assert.equal(store.getState().profile.heightCm, 170)
    assert.equal(store.getState().profile.weightKg, 65)
  })

  test('키와 몸무게만 바꾸고 닉네임, 출생연도, 성별은 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규', birthYear: 1995, gender: 'female' })
    submitBody(store.getState(), { heightCm: 170, weightKg: 65 })
    assert.deepEqual(store.getState().profile, {
      nickname: '희규',
      birthYear: 1995,
      gender: 'female',
      heightCm: 170,
      weightKg: 65,
    })
  })

  test('저장한 값은 새로고침 뒤에도 복원되고 draft도 그 값에서 시작한다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    submitBody(store.getState(), { heightCm: 170, weightKg: 65 })
    assert.ok(map.has(PROFILE_STORAGE_KEY))
    const restored = createProfileStore(storage)
    assert.deepEqual(createBodyDraft(restored.getState().profile), { heightCm: 170, weightKg: 65 })
  })
})
