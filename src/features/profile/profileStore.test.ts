import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'
import { OPTIONAL_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from './types.ts'

// 테스트용 가짜 저장소 (Map 기반)
function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
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

function savedState(map: Map<string, string>) {
  const raw = map.get(PROFILE_STORAGE_KEY)
  if (raw === undefined) throw new Error('저장된 값이 없다')
  return JSON.parse(raw).state
}

describe('초기 상태', () => {
  test('프로필은 빈 문자열 또는 null이고 동의는 모두 false다', () => {
    const { storage } = createFakeStorage()
    const { profile, consent } = createProfileStore(storage).getState()
    assert.deepEqual(profile, { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null })
    assert.deepEqual(consent, {
      ageOver14: false,
      termsOfService: false,
      privacyPolicy: false,
      locationTerms: false,
      marketing: false,
      policyVersion: null,
      consentedAt: null,
    })
  })

  test('필수 동의 4개와 선택 동의 1개가 상수로 구분된다', () => {
    assert.deepEqual([...REQUIRED_CONSENT_KEYS], ['ageOver14', 'termsOfService', 'privacyPolicy', 'locationTerms'])
    assert.deepEqual([...OPTIONAL_CONSENT_KEYS], ['marketing'])
  })
})

describe('setProfile', () => {
  test('일부 필드만 바꾸고 나머지는 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규', gender: 'female' })
    store.getState().setProfile({ birthYear: 2003 })
    assert.deepEqual(store.getState().profile, {
      nickname: '희규',
      birthYear: 2003,
      gender: 'female',
      heightCm: null,
      weightKg: null,
    })
  })

  test('닉네임은 앞뒤 공백을 제거해 저장한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '  희규  ' })
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('닉네임을 넘기지 않으면 기존 닉네임을 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규' })
    store.getState().setProfile({ heightCm: 165 })
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('null과 0을 구분해서 저장한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ heightCm: 0, weightKg: null })
    assert.equal(store.getState().profile.heightCm, 0)
    assert.equal(store.getState().profile.weightKg, null)
    store.getState().setProfile({ heightCm: null, gender: 'male' })
    store.getState().setProfile({ gender: null })
    assert.equal(store.getState().profile.heightCm, null)
    assert.equal(store.getState().profile.gender, null)
  })
})

describe('동의', () => {
  test('setConsent는 지정한 항목만 바꾸고 버전과 시각은 건드리지 않는다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setConsent({ ageOver14: true, marketing: true })
    const { consent } = store.getState()
    assert.equal(consent.ageOver14, true)
    assert.equal(consent.marketing, true)
    assert.equal(consent.termsOfService, false)
    assert.equal(consent.policyVersion, null)
    assert.equal(consent.consentedAt, null)
  })

  test('recordConsent는 약관 버전과 동의 시각(epoch ms)을 기록한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setConsent({ ageOver14: true })
    store.getState().recordConsent('v1', 1_700_000_000_000)
    const { consent } = store.getState()
    assert.equal(consent.policyVersion, 'v1')
    assert.equal(consent.consentedAt, 1_700_000_000_000)
    assert.equal(consent.ageOver14, true)
  })

  test('recordConsent는 약관 버전이 null이어도 동의 시각을 기록한다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().setConsent({ ageOver14: true, privacyPolicy: true })
    store.getState().recordConsent(null, 1_700_000_000_000)
    const { consent } = store.getState()
    assert.equal(consent.policyVersion, null)
    assert.equal(consent.consentedAt, 1_700_000_000_000)
    assert.equal(consent.ageOver14, true)
    assert.equal(consent.privacyPolicy, true)
    // 저장과 복원도 정상이다
    assert.equal(savedState(map).consent.consentedAt, 1_700_000_000_000)
    assert.equal(createProfileStore(storage).getState().consent.consentedAt, 1_700_000_000_000)
  })

  test('recordConsent는 이전에 기록된 버전을 null로 덮어쓸 수 있다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().recordConsent('v1', 1)
    store.getState().recordConsent(null, 2)
    assert.equal(store.getState().consent.policyVersion, null)
    assert.equal(store.getState().consent.consentedAt, 2)
  })

  test('recordConsent의 시각 기본값은 현재 시각이다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    const before = Date.now()
    store.getState().recordConsent('v1')
    const after = Date.now()
    const at = store.getState().consent.consentedAt
    assert.ok(at !== null && at >= before && at <= after)
  })
})

describe('reset', () => {
  test('프로필, 동의, 완료 시각을 모두 초기값으로 되돌리고 저장값도 갱신한다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    const initial = structuredClone({
      profile: store.getState().profile,
      consent: store.getState().consent,
      completedAt: store.getState().completedAt,
    })
    store.getState().setProfile({ nickname: '희규', birthYear: 2003, gender: 'female', heightCm: 165, weightKg: 52 })
    store.getState().setConsent({ ageOver14: true })
    store.getState().recordConsent('v1', 1)
    store.getState().completeProfile(2)
    store.getState().reset()
    assert.deepEqual(
      {
        profile: store.getState().profile,
        consent: store.getState().consent,
        completedAt: store.getState().completedAt,
      },
      initial,
    )
    assert.equal(store.getState().completedAt, null)
    assert.deepEqual(savedState(map), initial)
  })
})

describe('저장과 복원', () => {
  test('변경한 값이 pacebeat-profile 키에 데이터만 저장된다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().setProfile({ nickname: '희규', heightCm: 165 })
    store.getState().recordConsent('v1', 5)
    const state = savedState(map)
    assert.deepEqual(Object.keys(state).sort(), ['completedAt', 'consent', 'profile']) // 함수(액션)는 저장하지 않는다
    assert.equal(state.profile.nickname, '희규')
    assert.equal(state.profile.heightCm, 165)
    assert.equal(state.profile.weightKg, null)
    assert.equal(state.consent.consentedAt, 5)
    assert.equal(JSON.parse(map.get(PROFILE_STORAGE_KEY)!).version, 0)
  })

  test('같은 저장소로 새 Store를 만들면 값이 복원된다', () => {
    const { storage } = createFakeStorage()
    const first = createProfileStore(storage)
    first.getState().setProfile({ nickname: '희규', birthYear: 2003, gender: 'male', heightCm: 0 })
    first.getState().setConsent({ privacyPolicy: true })
    first.getState().recordConsent('v1', 7)

    const second = createProfileStore(storage)
    assert.deepEqual(second.getState().profile, first.getState().profile)
    assert.deepEqual(second.getState().consent, first.getState().consent)
    assert.equal(second.getState().profile.heightCm, 0) // 0은 0으로, null은 null로 복원
    assert.equal(second.getState().profile.weightKg, null)
  })

  test('일부 필드가 빠진 저장값은 빠진 필드만 기본값으로 채운다', () => {
    const { storage } = createFakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        state: { profile: { nickname: '희규' }, consent: { ageOver14: true } },
        version: 0,
      }),
    })
    const { profile, consent } = createProfileStore(storage).getState()
    assert.deepEqual(profile, { nickname: '희규', birthYear: null, gender: null, heightCm: null, weightKg: null })
    assert.equal(consent.ageOver14, true)
    assert.equal(consent.termsOfService, false)
    assert.equal(consent.marketing, false)
    assert.equal(consent.policyVersion, null)
    assert.equal(consent.consentedAt, null)
  })

  test('profile이나 consent가 통째로 없어도 기본값으로 복원한다', () => {
    const { storage } = createFakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({ state: { profile: { nickname: '희규' } }, version: 0 }),
    })
    const { profile, consent } = createProfileStore(storage).getState()
    assert.equal(profile.nickname, '희규')
    assert.equal(consent.ageOver14, false)
  })

  test('손상된 JSON은 무시하고 초기 상태로 시작하며 이후 저장도 정상 동작한다', () => {
    const { storage, map } = createFakeStorage({ [PROFILE_STORAGE_KEY]: '{not json' })
    const store = createProfileStore(storage)
    assert.equal(store.getState().profile.nickname, '')
    assert.equal(store.getState().consent.ageOver14, false)
    store.getState().setProfile({ nickname: '희규' })
    assert.equal(savedState(map).profile.nickname, '희규')
  })

  test('형태가 잘못된 저장값(배열, 문자열, null)은 기본값으로 시작한다', () => {
    for (const bad of ['[]', '"abc"', 'null', '{"state":"abc","version":0}', '{"state":{"profile":"abc","consent":[1]},"version":0}']) {
      const store = createProfileStore(createFakeStorage({ [PROFILE_STORAGE_KEY]: bad }).storage)
      assert.equal(store.getState().profile.nickname, '', bad)
      assert.equal(store.getState().consent.ageOver14, false, bad)
    }
  })

  test('다른 storage key를 읽거나 바꾸지 않는다', () => {
    const { storage, map } = createFakeStorage({
      'pacebeat-onboarding': '{"state":{"onboardingCompleted":true},"version":0}',
      'pacebeat-measurement': 'raw',
    })
    const store = createProfileStore(storage)
    store.getState().setProfile({ nickname: '희규' })
    store.getState().reset()
    assert.equal(map.get('pacebeat-onboarding'), '{"state":{"onboardingCompleted":true},"version":0}')
    assert.equal(map.get('pacebeat-measurement'), 'raw')
    assert.deepEqual([...map.keys()].sort(), ['pacebeat-measurement', 'pacebeat-onboarding', PROFILE_STORAGE_KEY])
  })
})

describe('프로필 가입 완료 시각', () => {
  test('최초 상태의 completedAt은 null이다', () => {
    const { storage } = createFakeStorage()
    assert.equal(createProfileStore(storage).getState().completedAt, null)
  })

  test('completeProfile은 지정한 시각을 기록한다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().completeProfile(1234)
    assert.equal(store.getState().completedAt, 1234)
  })

  test('completeProfile의 시각 기본값은 현재 시각이다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    const before = Date.now()
    store.getState().completeProfile()
    const after = Date.now()
    const value = store.getState().completedAt
    assert.ok(value !== null && value >= before && value <= after)
  })

  test('여러 번 불러도 처음 기록한 시각을 유지한다 (멱등)', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().completeProfile(100)
    store.getState().completeProfile(200)
    store.getState().completeProfile()
    assert.equal(store.getState().completedAt, 100)
    assert.equal(savedState(map).completedAt, 100)
  })

  test('올바르지 않은 시각(NaN, Infinity)은 기록하지 않고 이후 올바른 호출은 정상 기록된다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().completeProfile(Number.NaN)
    store.getState().completeProfile(Number.POSITIVE_INFINITY)
    assert.equal(store.getState().completedAt, null)
    store.getState().completeProfile(42)
    assert.equal(store.getState().completedAt, 42)
  })

  test('profile이나 consent를 바꿔도 completedAt은 그대로다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().completeProfile(100)
    store.getState().setProfile({ nickname: '희규' })
    store.getState().setConsent({ marketing: true })
    store.getState().recordConsent('v1', 5)
    assert.equal(store.getState().completedAt, 100)
  })

  test('completedAt은 새 Store를 만들어도 복원된다', () => {
    const { storage } = createFakeStorage()
    createProfileStore(storage).getState().completeProfile(555)
    assert.equal(createProfileStore(storage).getState().completedAt, 555)
  })

  test('completedAt이 없는 기존 저장값은 null로 복원하고 다른 값은 보존한다', () => {
    const { storage } = createFakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        state: { profile: { nickname: '희규', heightCm: 170 }, consent: { ageOver14: true, consentedAt: 3 } },
        version: 0,
      }),
    })
    const state = createProfileStore(storage).getState()
    assert.equal(state.completedAt, null)
    assert.equal(state.profile.nickname, '희규')
    assert.equal(state.profile.heightCm, 170)
    assert.equal(state.consent.consentedAt, 3)
  })

  test('숫자가 아닌 저장값은 null로 복원하고 유한한 숫자는 그대로 복원한다', () => {
    for (const bad of ['1700000000000', true, {}, [], null]) {
      const { storage } = createFakeStorage({
        [PROFILE_STORAGE_KEY]: JSON.stringify({ state: { completedAt: bad }, version: 0 }),
      })
      assert.equal(createProfileStore(storage).getState().completedAt, null, JSON.stringify(bad))
    }
    const { storage } = createFakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({ state: { completedAt: 0 }, version: 0 }),
    })
    assert.equal(createProfileStore(storage).getState().completedAt, 0)
  })

  test('잘못된 completedAt이 profile과 consent 복원에 영향을 주지 않는다', () => {
    const { storage } = createFakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        state: { profile: { nickname: '희규' }, consent: { termsOfService: true }, completedAt: 'x' },
        version: 0,
      }),
    })
    const state = createProfileStore(storage).getState()
    assert.equal(state.completedAt, null)
    assert.equal(state.profile.nickname, '희규')
    assert.equal(state.consent.termsOfService, true)
  })

  test('reset 뒤에 새 Store를 만들면 완료하지 않은 상태(null)로 복원된다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().completeProfile(9)
    store.getState().reset()
    assert.equal(createProfileStore(storage).getState().completedAt, null)
  })
})

describe('저장소 쓰기 실패', () => {
  function createFailingStorage(initial: Record<string, string> = {}) {
    const { storage } = createFakeStorage(initial)
    const failing: StateStorage = {
      getItem: storage.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    return failing
  }

  test('setItem이 던져도 모든 액션이 예외 없이 끝나고 메모리 상태는 바뀐다', () => {
    const store = createProfileStore(createFailingStorage())
    assert.doesNotThrow(() => store.getState().setProfile({ nickname: '희규', heightCm: 165 }))
    assert.doesNotThrow(() => store.getState().completeProfile(77))
    assert.equal(store.getState().completedAt, 77) // 메모리 상태는 바뀐다. 저장이 됐다는 뜻은 아니다.
    assert.doesNotThrow(() => store.getState().setConsent({ ageOver14: true }))
    assert.doesNotThrow(() => store.getState().recordConsent(null, 5))
    assert.equal(store.getState().profile.nickname, '희규')
    assert.equal(store.getState().profile.heightCm, 165)
    assert.equal(store.getState().consent.ageOver14, true)
    assert.equal(store.getState().consent.consentedAt, 5)
    assert.doesNotThrow(() => store.getState().reset())
    assert.equal(store.getState().profile.nickname, '')
  })

  test('쓰기가 실패해도 저장된 값 복원은 정상이다', () => {
    const failing = createFailingStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({ state: { profile: { nickname: '희규' } }, version: 0 }),
    })
    const store = createProfileStore(failing)
    assert.equal(store.getState().profile.nickname, '희규')
    assert.doesNotThrow(() => store.getState().setProfile({ birthYear: 2003 }))
    assert.equal(store.getState().profile.birthYear, 2003)
  })

  test('비동기 setItem이 reject돼도 예외가 전파되지 않는다', async () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore({
      ...storage,
      setItem: () => Promise.reject(new Error('async fail')),
    })
    assert.doesNotThrow(() => store.getState().setProfile({ nickname: '희규' }))
    await new Promise((resolve) => setImmediate(resolve)) // 처리되지 않은 reject가 있으면 테스트가 실패한다
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('한 Store의 저장 실패가 다른 저장소를 쓰는 Store에 영향을 주지 않는다', () => {
    const failingStore = createProfileStore(createFailingStorage())
    const { storage, map } = createFakeStorage()
    const okStore = createProfileStore(storage)
    failingStore.getState().setProfile({ nickname: '실패' })
    okStore.getState().setProfile({ nickname: '정상' })
    assert.equal(savedState(map).profile.nickname, '정상')
  })
})

describe('저장값 필드 타입 검증', () => {
  function restore(state: unknown) {
    const { storage } = createFakeStorage({ [PROFILE_STORAGE_KEY]: JSON.stringify({ state, version: 0 }) })
    return createProfileStore(storage).getState()
  }

  test('타입이 틀린 profile 필드만 기본값으로 복원하고 정상 필드는 보존한다', () => {
    const { profile } = restore({
      profile: { nickname: null, birthYear: 2003, gender: 'x', heightCm: '165', weightKg: 52.5 },
    })
    assert.deepEqual(profile, { nickname: '', birthYear: 2003, gender: null, heightCm: null, weightKg: 52.5 })
  })

  test('타입이 틀린 consent 필드만 기본값으로 복원하고 정상 필드는 보존한다', () => {
    const { consent } = restore({
      consent: {
        ageOver14: true,
        termsOfService: 'yes',
        privacyPolicy: 1,
        locationTerms: true,
        marketing: null,
        policyVersion: 3,
        consentedAt: '2026-11-17',
      },
    })
    assert.equal(consent.ageOver14, true)
    assert.equal(consent.termsOfService, false)
    assert.equal(consent.privacyPolicy, false)
    assert.equal(consent.locationTerms, true)
    assert.equal(consent.marketing, false)
    assert.equal(consent.policyVersion, null)
    assert.equal(consent.consentedAt, null)
  })

  test('허용되는 값(null, 성별 두 값, 문자열 버전, 숫자 시각)은 그대로 복원한다', () => {
    const state = restore({
      profile: { nickname: '희규', birthYear: null, gender: 'male', heightCm: 0, weightKg: null },
      consent: { ageOver14: true, policyVersion: 'v1', consentedAt: 7 },
    })
    assert.deepEqual(state.profile, { nickname: '희규', birthYear: null, gender: 'male', heightCm: 0, weightKg: null })
    assert.equal(state.consent.policyVersion, 'v1')
    assert.equal(state.consent.consentedAt, 7)
    assert.equal(restore({ profile: { gender: 'female' } }).profile.gender, 'female')
  })

  test('profile과 consent의 오류가 서로 영향을 주지 않는다', () => {
    const state = restore({ profile: 'broken', consent: { marketing: true } })
    assert.equal(state.profile.nickname, '')
    assert.equal(state.consent.marketing, true)
  })

  test('복원된 닉네임은 항상 문자열이다', () => {
    for (const bad of [null, 123, true, {}, []]) {
      assert.equal(typeof restore({ profile: { nickname: bad } }).profile.nickname, 'string')
    }
  })
})

describe('undefined 패치', () => {
  test('setProfile의 undefined 필드는 무시하고 기존 값을 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규', birthYear: 2003, gender: 'female', heightCm: 165, weightKg: 52 })
    store.getState().setProfile({ heightCm: undefined, nickname: undefined, gender: undefined })
    assert.deepEqual(store.getState().profile, {
      nickname: '희규',
      birthYear: 2003,
      gender: 'female',
      heightCm: 165,
      weightKg: 52,
    })
  })

  test('setProfile은 정상 값과 null 업데이트를 기존대로 처리한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ heightCm: 165, nickname: ' 희규 ' })
    store.getState().setProfile({ heightCm: null, weightKg: 0, birthYear: undefined })
    assert.equal(store.getState().profile.heightCm, null)
    assert.equal(store.getState().profile.weightKg, 0)
    assert.equal(store.getState().profile.birthYear, null)
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('setProfile의 undefined가 저장값에도 영향을 주지 않는다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    store.getState().setProfile({ heightCm: 165 })
    store.getState().setProfile({ heightCm: undefined })
    assert.equal(savedState(map).profile.heightCm, 165)
    assert.equal(createProfileStore(storage).getState().profile.heightCm, 165)
  })

  test('setConsent의 undefined 항목은 무시하고 기존 값을 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setConsent({ marketing: true, ageOver14: true })
    store.getState().setConsent({ marketing: undefined, termsOfService: true })
    const { consent } = store.getState()
    assert.equal(consent.marketing, true)
    assert.equal(consent.ageOver14, true)
    assert.equal(consent.termsOfService, true)
  })

  test('setConsent는 false 업데이트를 기존대로 처리한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setConsent({ marketing: true })
    store.getState().setConsent({ marketing: false })
    assert.equal(store.getState().consent.marketing, false)
  })
})
