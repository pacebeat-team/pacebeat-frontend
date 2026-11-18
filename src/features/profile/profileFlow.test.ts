import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import {
  finishProfile,
  getProfileResumePath,
  getStepFromPath,
  hasRequiredConsent,
  hasValidNickname,
  isProfileComplete,
  isStepAccessible,
} from './profileFlow.ts'
import type { ProfileStep } from './profileFlow.ts'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'
import { PROFILE_ROUTES } from './routes.ts'
import { REQUIRED_CONSENT_KEYS } from './types.ts'

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

function createStore() {
  return createProfileStore(createFakeStorage().storage)
}

// 필수 동의 4개와 동의 시각을 저장한다.
function agree(store: ReturnType<typeof createStore>) {
  store.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
  store.getState().recordConsent(null, 1000)
}

// 동의와 유효한 닉네임까지 마친 Store (아직 완료하지 않음)
function createReadyStore() {
  const store = createStore()
  agree(store)
  store.getState().setProfile({ nickname: '희규' })
  return store
}

describe('hasRequiredConsent', () => {
  test('최초 상태는 false다', () => {
    assert.equal(hasRequiredConsent(createStore().getState()), false)
  })

  test('필수 4개와 동의 시각이 모두 있으면 true다 (마케팅은 보지 않는다)', () => {
    const store = createStore()
    agree(store)
    assert.equal(store.getState().consent.marketing, false)
    assert.equal(hasRequiredConsent(store.getState()), true)
  })

  test('필수 항목이 하나라도 빠지면 false다', () => {
    for (const missing of REQUIRED_CONSENT_KEYS) {
      const store = createStore()
      agree(store)
      store.getState().setConsent({ [missing]: false })
      assert.equal(hasRequiredConsent(store.getState()), false, missing)
    }
  })

  test('동의 시각이 없으면 항목이 모두 true여도 false다', () => {
    const store = createStore()
    store.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
    assert.equal(hasRequiredConsent(store.getState()), false)
  })
})

describe('hasValidNickname', () => {
  test('빈 값, 공백, 1자, 11자는 유효하지 않다', () => {
    for (const nickname of ['', '   ', '가', '가나다라마바사아자차카']) {
      const store = createStore()
      store.getState().setProfile({ nickname })
      assert.equal(hasValidNickname(store.getState()), false, JSON.stringify(nickname))
    }
  })

  test('2자와 10자는 유효하다', () => {
    for (const nickname of ['가나', '가나다라마바사아자차']) {
      const store = createStore()
      store.getState().setProfile({ nickname })
      assert.equal(hasValidNickname(store.getState()), true, nickname)
    }
  })
})

describe('isProfileComplete', () => {
  test('최초 상태는 완료가 아니다', () => {
    assert.equal(isProfileComplete(createStore().getState()), false)
  })

  test('필수 동의와 닉네임만 있고 completedAt이 없으면 완료가 아니다', () => {
    assert.equal(isProfileComplete(createReadyStore().getState()), false)
  })

  test('선택 항목이 모두 null이어도 completedAt이 있으면 완료다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(5)
    const { profile } = store.getState()
    assert.deepEqual([profile.birthYear, profile.gender, profile.heightCm, profile.weightKg], [null, null, null, null])
    assert.equal(isProfileComplete(store.getState()), true)
  })

  test('completedAt이 0이어도 완료로 본다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(0)
    assert.equal(isProfileComplete(store.getState()), true)
  })

  test('필수 동의가 빠지면 completedAt이 있어도 완료가 아니다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(5)
    store.getState().setConsent({ privacyPolicy: false })
    assert.equal(isProfileComplete(store.getState()), false)
  })

  test('동의 시각이 없으면 완료가 아니다', () => {
    const store = createStore()
    store.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
    store.getState().setProfile({ nickname: '희규' })
    store.getState().completeProfile(5)
    assert.equal(isProfileComplete(store.getState()), false)
  })

  test('닉네임이 유효하지 않으면 completedAt이 있어도 완료가 아니다', () => {
    for (const nickname of ['', ' ', '가', '가나다라마바사아자차카']) {
      const store = createReadyStore()
      store.getState().setProfile({ nickname })
      store.getState().completeProfile(5)
      assert.equal(isProfileComplete(store.getState()), false, JSON.stringify(nickname))
    }
  })
})

describe('getProfileResumePath', () => {
  test('아무것도 하지 않았으면 동의 화면이다', () => {
    assert.equal(getProfileResumePath(createStore().getState()), PROFILE_ROUTES.consent)
  })

  test('동의 항목이 일부만 있거나 동의 시각이 없으면 동의 화면이다', () => {
    const partial = createStore()
    partial.getState().setConsent({ ageOver14: true })
    partial.getState().recordConsent(null, 1)
    assert.equal(getProfileResumePath(partial.getState()), PROFILE_ROUTES.consent)

    const noTime = createStore()
    noTime.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
    assert.equal(getProfileResumePath(noTime.getState()), PROFILE_ROUTES.consent)
  })

  test('동의를 마치고 닉네임이 없거나 유효하지 않으면 닉네임 화면이다', () => {
    for (const nickname of ['', '가']) {
      const store = createStore()
      agree(store)
      store.getState().setProfile({ nickname })
      assert.equal(getProfileResumePath(store.getState()), PROFILE_ROUTES.nickname, JSON.stringify(nickname))
    }
  })

  test('동의와 닉네임을 마치고 완료 전이면 출생연도·성별 화면이다', () => {
    assert.equal(getProfileResumePath(createReadyStore().getState()), PROFILE_ROUTES.demographics)
  })

  test('가입을 완료했으면 null이다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(5)
    assert.equal(getProfileResumePath(store.getState()), null)
  })

  test('완료 시각이 있어도 필수 동의가 없으면 동의 화면이다 (완료 조건과 모순되지 않는다)', () => {
    const store = createReadyStore()
    store.getState().completeProfile(5)
    store.getState().setConsent({ termsOfService: false })
    assert.equal(isProfileComplete(store.getState()), false)
    assert.equal(getProfileResumePath(store.getState()), PROFILE_ROUTES.consent)
  })

  test('완료가 아니면 항상 경로를, 완료이면 항상 null을 돌려준다', () => {
    const stores = [createStore(), createReadyStore()]
    const done = createReadyStore()
    done.getState().completeProfile(5)
    stores.push(done)
    for (const store of stores) {
      const state = store.getState()
      assert.equal(getProfileResumePath(state) === null, isProfileComplete(state))
    }
  })
})

describe('isStepAccessible', () => {
  const steps: ProfileStep[] = ['consent', 'nickname', 'demographics', 'body']

  test('재개 경로가 가리키는 단계는 언제나 열 수 있다 (가드가 되돌려 보내는 순환이 없다)', () => {
    const nickOnly = createStore()
    agree(nickOnly)
    const done = createReadyStore()
    done.getState().completeProfile(5)
    for (const store of [createStore(), nickOnly, createReadyStore(), done]) {
      const state = store.getState()
      const path = getProfileResumePath(state)
      if (path === null) continue
      const step = getStepFromPath(path)
      assert.notEqual(step, null)
      assert.equal(isStepAccessible(step as ProfileStep, state), true, path)
    }
  })

  function access(store: ReturnType<typeof createStore>) {
    return steps.map((step) => isStepAccessible(step, store.getState()))
  }

  test('아무것도 하지 않은 상태에서는 동의 화면만 열 수 있다', () => {
    assert.deepEqual(access(createStore()), [true, false, false, false])
  })

  test('동의만 마치면 동의와 닉네임 화면을 열 수 있다 (가입 중 동의 화면 복귀 허용)', () => {
    const store = createStore()
    agree(store)
    assert.deepEqual(access(store), [true, true, false, false])
  })

  test('동의와 닉네임을 마치면 완료 전에도 모든 단계를 열 수 있다', () => {
    assert.deepEqual(access(createReadyStore()), [true, true, true, true])
  })

  test('가입을 완료한 사용자는 동의 화면만 열 수 없다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(5)
    assert.deepEqual(access(store), [false, true, true, true])
  })

  test('닉네임이 유효하지 않으면 출생연도·성별과 키·몸무게 화면을 열 수 없다', () => {
    const store = createStore()
    agree(store)
    store.getState().setProfile({ nickname: '가' })
    assert.deepEqual(access(store), [true, true, false, false])
  })

  test('동의 시각만 없어도 닉네임 이후 화면은 열 수 없다', () => {
    const store = createStore()
    store.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
    store.getState().setProfile({ nickname: '희규' })
    assert.deepEqual(access(store), [true, false, false, false])
  })
})

describe('getStepFromPath', () => {
  test('인코딩된 경로도 같은 단계로 본다', () => {
    assert.equal(getStepFromPath('/profile/%63onsent'), 'consent')
    assert.equal(getStepFromPath('/profile/%4Eickname'), 'nickname')
  })

  test('라우터가 연결하지 않는 인코딩은 단계로 보지 않는다', () => {
    assert.equal(getStepFromPath('/profile/%2563onsent'), null)
  })

  test('잘못된 인코딩은 예외 없이 null이다', () => {
    assert.equal(getStepFromPath('/profile/%E0%A4%A'), null)
  })

  test('프로필 단계 경로를 단계로 바꾼다', () => {
    assert.equal(getStepFromPath(PROFILE_ROUTES.consent), 'consent')
    assert.equal(getStepFromPath(PROFILE_ROUTES.nickname), 'nickname')
    assert.equal(getStepFromPath(PROFILE_ROUTES.demographics), 'demographics')
    assert.equal(getStepFromPath(PROFILE_ROUTES.body), 'body')
  })

  test('끝의 슬래시는 무시한다', () => {
    assert.equal(getStepFromPath('/profile/nickname/'), 'nickname')
  })

  test('대소문자와 겹친 슬래시도 같은 단계로 본다 (라우터는 대소문자를 구분하지 않는다)', () => {
    assert.equal(getStepFromPath('/Profile/Consent'), 'consent')
    assert.equal(getStepFromPath('/PROFILE/BODY'), 'body')
    assert.equal(getStepFromPath('/profile//consent'), 'consent')
    assert.equal(getStepFromPath('/profile/consent//'), 'consent')
  })

  test('프로필 단계가 아닌 경로는 null이다', () => {
    for (const path of ['/', '/home', '/profile', '/profile/', '/profile/other', '/profiles/consent', '/profile/consent/x']) {
      assert.equal(getStepFromPath(path), null, path)
    }
  })
})

describe('완료한 뒤 조건이 깨졌다가 다시 채워지는 경우', () => {
  test('깨진 동안은 완료가 아니고 해당 단계로 돌려보내며, 다시 채우면 이미 기록된 완료를 그대로 쓴다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(100)
    store.getState().setProfile({ nickname: '' })
    assert.equal(isProfileComplete(store.getState()), false)
    assert.equal(getProfileResumePath(store.getState()), PROFILE_ROUTES.nickname)
    assert.deepEqual(
      (['consent', 'nickname', 'demographics', 'body'] as ProfileStep[]).map((step) => isStepAccessible(step, store.getState())),
      [true, true, false, false],
    )
    store.getState().setProfile({ nickname: '희규' })
    assert.equal(isProfileComplete(store.getState()), true)
    assert.equal(store.getState().completedAt, 100)
  })
})

describe('finishProfile', () => {
  test('시작하기: 키·몸무게를 저장한 뒤 완료한다', () => {
    const store = createReadyStore()
    assert.equal(finishProfile(store.getState(), { heightCm: 175, weightKg: 70 }), true)
    const { profile, completedAt } = store.getState()
    assert.deepEqual([profile.heightCm, profile.weightKg], [175, 70])
    assert.notEqual(completedAt, null)
    assert.equal(isProfileComplete(store.getState()), true)
  })

  test('시작하기: 둘 다 선택하지 않아도(null) 완료할 수 있다', () => {
    const store = createReadyStore()
    assert.equal(finishProfile(store.getState(), { heightCm: null, weightKg: null }), true)
    assert.equal(isProfileComplete(store.getState()), true)
    assert.equal(store.getState().profile.heightCm, null)
  })

  test('건너뛰기: 기존에 저장된 170cm / 65kg을 그대로 두고 완료한다', () => {
    const store = createReadyStore()
    store.getState().setProfile({ heightCm: 170, weightKg: 65, birthYear: 1999, gender: 'female' })
    assert.equal(finishProfile(store.getState(), null), true)
    const { profile } = store.getState()
    assert.deepEqual([profile.heightCm, profile.weightKg, profile.birthYear, profile.gender], [170, 65, 1999, 'female'])
    assert.equal(isProfileComplete(store.getState()), true)
  })

  test('건너뛰기: 선택 항목이 모두 비어 있어도 완료한다', () => {
    const store = createReadyStore()
    assert.equal(finishProfile(store.getState(), null), true)
    assert.equal(isProfileComplete(store.getState()), true)
  })

  test('건너뛰기는 setProfile을 부르지 않는다', () => {
    const store = createReadyStore()
    const calls: unknown[] = []
    const spy = {
      ...store.getState(),
      setProfile: (patch: unknown) => {
        calls.push(patch)
      },
    }
    assert.equal(finishProfile(spy as typeof spy & ReturnType<typeof store.getState>, null), true)
    assert.equal(calls.length, 0)
  })

  test('범위를 벗어난 draft는 저장도 완료도 하지 않는다', () => {
    const invalid = [
      { heightCm: 99, weightKg: 60 },
      { heightCm: 221, weightKg: 60 },
      { heightCm: 165, weightKg: 19 },
      { heightCm: 165, weightKg: 201 },
      { heightCm: 165.5, weightKg: 60 },
      { heightCm: Number.NaN, weightKg: 60 },
    ]
    for (const draft of invalid) {
      const store = createReadyStore()
      store.getState().setProfile({ heightCm: 170, weightKg: 65 })
      assert.equal(finishProfile(store.getState(), draft), false, JSON.stringify(draft))
      assert.equal(store.getState().completedAt, null)
      assert.deepEqual([store.getState().profile.heightCm, store.getState().profile.weightKg], [170, 65])
    }
  })

  test('필수 동의가 없으면 시작하기와 건너뛰기 모두 완료하지 않고 저장도 하지 않는다', () => {
    for (const draft of [{ heightCm: 175, weightKg: 70 }, null]) {
      const store = createStore()
      store.getState().setProfile({ nickname: '희규' })
      assert.equal(finishProfile(store.getState(), draft), false)
      assert.equal(store.getState().completedAt, null)
      assert.equal(store.getState().profile.heightCm, null)
    }
  })

  test('동의 시각이 없으면 완료하지 않는다', () => {
    const store = createStore()
    store.getState().setConsent({ ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true })
    store.getState().setProfile({ nickname: '희규' })
    assert.equal(finishProfile(store.getState(), null), false)
    assert.equal(store.getState().completedAt, null)
  })

  test('닉네임이 없거나 유효하지 않으면 완료하지 않는다', () => {
    for (const nickname of ['', '   ', '가']) {
      const store = createReadyStore()
      store.getState().setProfile({ nickname })
      assert.equal(finishProfile(store.getState(), { heightCm: 175, weightKg: 70 }), false, JSON.stringify(nickname))
      assert.equal(store.getState().completedAt, null)
      assert.equal(store.getState().profile.heightCm, null) // 선행 조건이 없으면 키·몸무게도 저장하지 않는다
    }
  })

  test('여러 번 불러도 처음 완료 시각을 유지한다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(100)
    assert.equal(finishProfile(store.getState(), null), true)
    assert.equal(finishProfile(store.getState(), { heightCm: 175, weightKg: 70 }), true)
    assert.equal(store.getState().completedAt, 100)
  })

  test('완료한 사용자가 다시 시작하기를 누르면 값은 바뀌고 완료 시각은 그대로다', () => {
    const store = createReadyStore()
    store.getState().completeProfile(100)
    assert.equal(finishProfile(store.getState(), { heightCm: 180, weightKg: 75 }), true)
    assert.equal(store.getState().profile.heightCm, 180)
    assert.equal(store.getState().completedAt, 100)
  })

  test('완료 상태는 저장소에 기록되고 새 Store에서 복원된다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    agree(store)
    store.getState().setProfile({ nickname: '희규' })
    finishProfile(store.getState(), null)
    assert.ok(map.has(PROFILE_STORAGE_KEY))
    assert.equal(isProfileComplete(createProfileStore(storage).getState()), true)
  })

  test('저장소 쓰기가 실패해도 예외 없이 끝나고 메모리 상태는 완료가 된다 (영속성은 보장하지 않는다)', () => {
    const failing: StateStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    const store = createProfileStore(failing)
    agree(store)
    store.getState().setProfile({ nickname: '희규' })
    assert.doesNotThrow(() => finishProfile(store.getState(), { heightCm: 175, weightKg: 70 }))
    assert.equal(isProfileComplete(store.getState()), true)
    assert.equal(isProfileComplete(createProfileStore(failing).getState()), false) // 다시 만들면 저장된 것이 없다
  })
})
