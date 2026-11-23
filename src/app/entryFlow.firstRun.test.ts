import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import { submitConsent } from '../features/profile/consent.ts'
import { submitNickname } from '../features/profile/nickname.ts'
import { finishProfile, isStepAccessible } from '../features/profile/profileFlow.ts'
import { createProfileStore } from '../features/profile/profileStore.ts'
import { PROFILE_ROUTES } from '../features/profile/routes.ts'
import { REQUIRED_CONSENT_KEYS, OPTIONAL_CONSENT_KEYS } from '../features/profile/types.ts'
import type { ConsentDraft } from '../features/profile/consent.ts'
import { recordPermissionStep, skipPermissionStep } from '../lib/onboardingFlow.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { createEntryPathResolver } from './entryFlow.ts'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

// 실제 온보딩 Store + 실제 프로필 Store로 첫 사용 흐름을 따라간다. 서로의 Store는 모른 채 app/entryFlow.ts에서만 만난다.
function firstRun() {
  useOnboardingStore.getState().reset()
  const profile = createProfileStore(memoryStorage())
  const resolve = createEntryPathResolver(() => useOnboardingStore.getState(), () => profile.getState())
  return { profile, resolve }
}

function consentDraft(required: boolean): ConsentDraft {
  return Object.fromEntries([
    ...REQUIRED_CONSENT_KEYS.map((key) => [key, required]),
    ...OPTIONAL_CONSENT_KEYS.map((key) => [key, false]),
  ]) as ConsentDraft
}

describe('첫 사용 흐름 (온보딩 Store ↔ 프로필 Store)', () => {
  test('온보딩 전에는 Intro, 권한 단계를 마치면 프로필 동의로 간다', () => {
    try {
      const { resolve } = firstRun()
      assert.equal(resolve(), '/onboarding/intro')
      useOnboardingStore.getState().setExperienceLevel('beginner')
      assert.equal(resolve(), '/onboarding/intro', '경험 선택만으로는 온보딩 완료가 아니다')
      const s = useOnboardingStore.getState()
      recordPermissionStep(s, 'denied', null)
      assert.equal(resolve(), '/profile/consent')
      assert.equal(useOnboardingStore.getState().timeOnlyMode, true)
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('"나중에 할게요"로 건너뛰어도 온보딩은 완료이고 권한 값은 비어 있다', () => {
    try {
      const { resolve } = firstRun()
      skipPermissionStep(useOnboardingStore.getState())
      assert.equal(resolve(), '/profile/consent')
      assert.equal(useOnboardingStore.getState().locationPermission, null)
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('동의 → 닉네임 → 키·몸무게 "건너뛰기"로 프로필이 끝나면 기초 측정 안내(Guide)로 간다', () => {
    try {
      const { profile, resolve } = firstRun()
      recordPermissionStep(useOnboardingStore.getState(), 'granted', null)
      assert.equal(submitConsent(profile.getState(), consentDraft(false)), false)
      assert.equal(resolve(), '/profile/consent', '필수 동의가 없으면 저장되지 않는다')
      assert.equal(submitConsent(profile.getState(), consentDraft(true)), true)
      assert.equal(resolve(), '/profile/nickname')
      assert.equal(submitNickname(profile.getState(), '러너킴'), true)
      assert.equal(resolve(), '/profile/demographics')
      assert.equal(finishProfile(profile.getState(), null), true)
      assert.equal(resolve(), '/measurement/guide')
      assert.equal(profile.getState().profile.heightCm, null)
      assert.equal(profile.getState().profile.weightKg, null)
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('온보딩 Store를 비워도 프로필 Store는 그대로이고, 그 반대도 같다', () => {
    try {
      const { profile } = firstRun()
      recordPermissionStep(useOnboardingStore.getState(), 'granted', null)
      submitConsent(profile.getState(), consentDraft(true))
      useOnboardingStore.getState().reset()
      assert.notEqual(profile.getState().consent.consentedAt, null)
      recordPermissionStep(useOnboardingStore.getState(), 'granted', null)
      profile.getState().reset()
      assert.equal(useOnboardingStore.getState().onboardingCompleted, true)
      assert.equal(profile.getState().consent.consentedAt, null)
    } finally {
      useOnboardingStore.getState().reset()
    }
  })
})

describe('Intro "계정 만들기" (/profile/consent로 진입)', () => {
  test('온보딩을 마치기 전에도 가입 전 사용자는 동의 단계를 열 수 있다', () => {
    try {
      const { profile } = firstRun()
      assert.equal(useOnboardingStore.getState().onboardingCompleted, false)
      assert.equal(isStepAccessible('consent', profile.getState()), true)
      assert.equal(isStepAccessible('nickname', profile.getState()), false, '동의 없이 다음 단계는 열 수 없다')
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('가입을 완료한 사용자는 동의 단계도 열 수 없다 (접근 정책을 완화하지 않는다)', () => {
    try {
      const { profile } = firstRun()
      submitConsent(profile.getState(), consentDraft(true))
      submitNickname(profile.getState(), '러너킴')
      finishProfile(profile.getState(), null)
      assert.equal(isStepAccessible('consent', profile.getState()), false)
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('온보딩 전에 가입을 먼저 마치면 다음 진입 경로는 Intro이고, 온보딩을 마치면 기초 측정 안내로 간다', () => {
    try {
      const { profile, resolve } = firstRun()
      submitConsent(profile.getState(), consentDraft(true))
      submitNickname(profile.getState(), '러너킴')
      finishProfile(profile.getState(), null)
      assert.equal(resolve(), '/onboarding/intro')
      recordPermissionStep(useOnboardingStore.getState(), 'granted', null)
      assert.equal(resolve(), '/measurement/guide')
    } finally {
      useOnboardingStore.getState().reset()
    }
  })

  test('Intro의 "계정 만들기" 버튼은 동의 화면 경로로 이동한다 (빈 핸들러로 되돌아가지 않게 막는다)', () => {
    const source = readFileSync(new URL('../pages/onboarding/IntroPage.tsx', import.meta.url), 'utf8')
    assert.match(source, /navigate\(PROFILE_ROUTES\.consent\)/)
    assert.match(source, /onClick=\{handleCreateAccount\}/)
    assert.equal(PROFILE_ROUTES.consent, '/profile/consent')
  })
})
