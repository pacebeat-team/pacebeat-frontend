import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import { createProfileStore, profileStore } from '../features/profile/profileStore.ts'
import { REQUIRED_CONSENT_KEYS } from '../features/profile/types.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { guideSkipSession } from './guideSkip.ts'
import {
  createEntryPathResolver,
  createPostProfilePathResolver,
  resolveEntryPath,
  resolvePostProfilePath,
} from './entryFlow.ts'
import type { EntryOnboardingState } from '../lib/entryPath.ts'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function setup() {
  const profile = createProfileStore(memoryStorage())
  const onboarding = { onboardingCompleted: true, baselineMeasurementCompleted: false }
  const resolve = createEntryPathResolver(
    (): EntryOnboardingState => onboarding,
    () => profile.getState(),
  )
  return { profile, onboarding, resolve }
}

function agree(store: ReturnType<typeof createProfileStore>) {
  const consent = Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true]))
  store.getState().setConsent(consent)
  store.getState().recordConsent(null, 1)
}

describe('createEntryPathResolver (실제 프로필 Store 사용)', () => {
  test('프로필을 시작하지 않았으면 동의 화면이다', () => {
    assert.equal(setup().resolve(), '/profile/consent')
  })

  test('프로필 단계가 진행될 때마다 그 시점의 경로를 돌려준다', () => {
    const { profile, resolve } = setup()
    agree(profile)
    assert.equal(resolve(), '/profile/nickname')
    profile.getState().setProfile({ nickname: '러너킴' })
    assert.equal(resolve(), '/profile/demographics')
    profile.getState().completeProfile(5)
    assert.equal(resolve(), '/measurement/guide')
  })

  test('필수 동의와 닉네임만으로는 완료로 보지 않는다 (completedAt이 필요하다)', () => {
    const { profile, resolve } = setup()
    agree(profile)
    profile.getState().setProfile({ nickname: '러너킴', birthYear: 2000, gender: 'female', heightCm: 170, weightKg: 60 })
    assert.equal(resolve(), '/profile/demographics')
  })

  test('선택 항목이 비어 있어도 완료 기록이 있으면 완료다', () => {
    const { profile, resolve } = setup()
    agree(profile)
    profile.getState().setProfile({ nickname: '러너킴' })
    profile.getState().completeProfile(5)
    assert.equal(profile.getState().profile.heightCm, null)
    assert.equal(resolve(), '/measurement/guide')
  })

  test('기초 측정 완료 상태가 바뀌면 Home이 된다', () => {
    const { profile, onboarding, resolve } = setup()
    agree(profile)
    profile.getState().setProfile({ nickname: '러너킴' })
    profile.getState().completeProfile(5)
    assert.equal(resolve(), '/measurement/guide')
    onboarding.baselineMeasurementCompleted = true
    assert.equal(resolve(), '/home')
  })

  test('온보딩 미완료가 프로필 상태보다 우선한다', () => {
    const { profile, onboarding, resolve } = setup()
    onboarding.onboardingCompleted = false
    assert.equal(resolve(), '/onboarding/intro')
    agree(profile)
    assert.equal(resolve(), '/onboarding/intro')
  })

  test('호출해도 두 Store의 값을 바꾸지 않는다', () => {
    const { profile, onboarding, resolve } = setup()
    agree(profile)
    const profileBefore = JSON.stringify(profile.getState())
    const onboardingBefore = JSON.stringify(onboarding)
    resolve()
    resolve()
    assert.equal(JSON.stringify(profile.getState()), profileBefore)
    assert.equal(JSON.stringify(onboarding), onboardingBefore)
  })

  test('완료 상태가 새로고침(새 Store 인스턴스) 뒤에도 같은 경로를 만든다', () => {
    const storage = memoryStorage()
    const first = createProfileStore(storage)
    agree(first)
    first.getState().setProfile({ nickname: '러너킴' })
    first.getState().completeProfile(5)
    const second = createProfileStore(storage)
    const resolve = createEntryPathResolver(
      () => ({ onboardingCompleted: true, baselineMeasurementCompleted: true }),
      () => second.getState(),
    )
    assert.equal(resolve(), '/home')
  })
})

describe('resolveEntryPath (실제 Store 연결)', () => {
  test('두 실제 Store의 최신 상태를 호출 시점에 읽는다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      assert.equal(resolveEntryPath(), '/onboarding/intro')
      useOnboardingStore.getState().completeOnboarding()
      assert.equal(resolveEntryPath(), '/profile/consent')
      agree(profileStore)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      assert.equal(resolveEntryPath(), '/profile/demographics')
      profileStore.getState().completeProfile(5)
      assert.equal(resolveEntryPath(), '/measurement/guide')
      useOnboardingStore.getState().completeBaselineMeasurement()
      assert.equal(resolveEntryPath(), '/home')
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})

describe('createPostProfilePathResolver (프로필 완료 후 경로)', () => {
  function resolverFor(state: EntryOnboardingState) {
    return createPostProfilePathResolver(() => state)
  }

  test('기초 측정 전이면 측정 Guide, 끝났으면 Home이다', () => {
    assert.equal(resolverFor({ onboardingCompleted: true, baselineMeasurementCompleted: false })(), '/measurement/guide')
    assert.equal(resolverFor({ onboardingCompleted: true, baselineMeasurementCompleted: true })(), '/home')
  })

  test('온보딩을 마치지 않았으면 Intro다', () => {
    assert.equal(resolverFor({ onboardingCompleted: false, baselineMeasurementCompleted: false })(), '/onboarding/intro')
  })

  test('이번 실행에서 Guide를 건너뛰었으면 기초 측정 미완료여도 Home이다', () => {
    const state = { onboardingCompleted: true, baselineMeasurementCompleted: false }
    let skipped = false
    const resolve = createPostProfilePathResolver(() => state, () => skipped)
    assert.equal(resolve(), '/measurement/guide')
    skipped = true
    assert.equal(resolve(), '/home')
    assert.equal(state.baselineMeasurementCompleted, false)
  })

  test('건너뛰었어도 온보딩을 마치지 않았으면 Intro다', () => {
    const resolve = createPostProfilePathResolver(
      () => ({ onboardingCompleted: false, baselineMeasurementCompleted: false }),
      () => true,
    )
    assert.equal(resolve(), '/onboarding/intro')
  })

  test('건너뜀 여부와 관계없이 프로필 경로를 돌려주지 않는다', () => {
    for (const skipped of [false, true]) {
      for (const onboardingCompleted of [false, true]) {
        for (const baselineMeasurementCompleted of [false, true]) {
          const path = createPostProfilePathResolver(
            () => ({ onboardingCompleted, baselineMeasurementCompleted }),
            () => skipped,
          )()
          assert.equal(path.startsWith('/profile'), false, path)
        }
      }
    }
  })

  test('어떤 상태에서도 프로필 경로를 돌려주지 않는다 (/profile 순환 방지)', () => {
    for (const onboardingCompleted of [false, true]) {
      for (const baselineMeasurementCompleted of [false, true]) {
        const path = resolverFor({ onboardingCompleted, baselineMeasurementCompleted })()
        assert.equal(path.startsWith('/profile'), false, path)
      }
    }
  })

  test('호출할 때마다 최신 상태를 읽는다', () => {
    const state = { onboardingCompleted: true, baselineMeasurementCompleted: false }
    const resolve = resolverFor(state)
    assert.equal(resolve(), '/measurement/guide')
    state.baselineMeasurementCompleted = true
    assert.equal(resolve(), '/home')
  })
})

describe('첫 사용 흐름의 이동 경로 (실제 Store 연결)', () => {
  test('권한 안내 → 프로필 → 기초 측정 → Home 순서로 경로가 이어진다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      // 권한 안내 화면: 온보딩 완료를 기록한 뒤 진입 경로로 이동한다.
      useOnboardingStore.getState().completeOnboarding()
      assert.equal(resolveEntryPath(), '/profile/consent')

      // 프로필 진행. 마지막 화면에서 완료하면 가입 후 경로는 측정 Guide다.
      agree(profileStore)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      assert.equal(resolveEntryPath(), '/profile/demographics')
      profileStore.getState().completeProfile(5)
      assert.equal(resolvePostProfilePath(), '/measurement/guide')
      assert.equal(resolveEntryPath(), '/measurement/guide')

      // 기초 측정이 끝나면 Home이다.
      useOnboardingStore.getState().completeBaselineMeasurement()
      assert.equal(resolvePostProfilePath(), '/home')
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })

  test('프로필 완료 후 경로는 프로필이 미완료여도 프로필 경로가 아니다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      useOnboardingStore.getState().completeOnboarding()
      assert.equal(resolveEntryPath(), '/profile/consent')
      assert.equal(resolvePostProfilePath(), '/measurement/guide')
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})

// 이 파일의 마지막 테스트로 둔다. guideSkipSession은 모듈 상태를 가지므로 뒤에 다른 테스트가 오면 건너뜀이 이어진다.
describe('Guide 건너뛰기와 실제 연결', () => {
  test('건너뛰면 프로필 완료 후 경로만 Home이 되고, 진입 경로와 기초 측정 상태는 그대로다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      useOnboardingStore.getState().completeOnboarding()
      agree(profileStore)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      profileStore.getState().completeProfile(5)
      assert.equal(resolvePostProfilePath(), '/measurement/guide')

      guideSkipSession.markSkipped()

      assert.equal(resolvePostProfilePath(), '/home')
      assert.equal(resolveEntryPath(), '/measurement/guide')
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})
