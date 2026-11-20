import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { profileStore } from '../features/profile/profileStore.ts'
import { REQUIRED_CONSENT_KEYS } from '../features/profile/types.ts'
import { startSession, stopSession } from '../features/measurement/session.ts'
import type { ProfileFlowState } from '../features/profile/profileFlow.ts'
import { measurementStore } from '../stores/measurementStore.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { createMockAwareMeasurementReader, createRouteRedirectResolver, resolveEntryPath, resolvePostProfilePath, resolveRouteRedirect } from './entryFlow.ts'
import { guideBackSession, guideSkipSession } from './guideSkip.ts'

const MAIN_TABS = ['/home', '/running', '/records', '/growth', '/my']

const COMPLETE_PROFILE: ProfileFlowState = {
  profile: { nickname: '러너킴', birthYear: null, gender: null, heightCm: null, weightKg: null },
  consent: {
    ageOver14: true,
    termsOfService: true,
    privacyPolicy: true,
    locationTerms: true,
    marketing: false,
    policyVersion: null,
    consentedAt: 1,
  },
  completedAt: 5,
}
const EMPTY_PROFILE: ProfileFlowState = {
  profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null },
  consent: { ...COMPLETE_PROFILE.consent, ageOver14: false, termsOfService: false, privacyPolicy: false, locationTerms: false, consentedAt: null },
  completedAt: null,
}

type Status = 'running' | 'paused' | 'finished'
interface Fakes {
  onboardingCompleted?: boolean
  baseline?: boolean
  profile?: ProfileFlowState
  left?: boolean
  session?: Status | null
}

function fakeResolver(fakes: Fakes = {}) {
  return createRouteRedirectResolver(
    () => ({ onboardingCompleted: fakes.onboardingCompleted ?? true, baselineMeasurementCompleted: fakes.baseline ?? false }),
    () => fakes.profile ?? COMPLETE_PROFILE,
    () => fakes.left ?? false,
    () => ({ session: fakes.session == null ? null : { status: fakes.session } }),
  )
}

describe('createRouteRedirectResolver (가짜 Store)', () => {
  test('온보딩 미완료 → Intro', () => {
    assert.equal(fakeResolver({ onboardingCompleted: false })('/home'), '/onboarding/intro')
    assert.equal(fakeResolver({ onboardingCompleted: false })('/measurement/active'), '/onboarding/intro')
  })

  test('온보딩 완료, 프로필 미완료 → 프로필 재개 경로', () => {
    assert.equal(fakeResolver({ profile: EMPTY_PROFILE })('/home'), '/profile/consent')
    const noNickname = { ...EMPTY_PROFILE, consent: COMPLETE_PROFILE.consent }
    assert.equal(fakeResolver({ profile: noNickname })('/measurement/guide'), '/profile/nickname')
    const noCompletedAt = { ...COMPLETE_PROFILE, completedAt: null }
    assert.equal(fakeResolver({ profile: noCompletedAt })('/measurement/active'), '/profile/demographics')
  })

  test('프로필 완료 + baseline 미완료 + 기록 없음 → 메인 탭은 Guide', () => {
    for (const path of MAIN_TABS) assert.equal(fakeResolver()(path), '/measurement/guide', path)
  })

  test('Guide 건너뛰기 또는 뒤로 가기 기록(둘 중 하나) → 메인 탭 허용, baseline은 그대로 미완료로 전달', () => {
    for (const path of MAIN_TABS) assert.equal(fakeResolver({ left: true })(path), null, path)
    // 기록이 있어도 Result는 종료된 세션이 있어야 하고, 기록을 완료로 보지 않아 Guide로 간다.
    assert.equal(fakeResolver({ left: true })('/measurement/result'), '/measurement/guide')
  })

  test('baseline 완료 → 메인 탭 허용', () => {
    for (const path of MAIN_TABS) assert.equal(fakeResolver({ baseline: true })(path), null, path)
  })

  test('측정 세션 없음 → Result 제한 (미완료는 Guide, 완료는 Home)', () => {
    assert.equal(fakeResolver()('/measurement/result'), '/measurement/guide')
    assert.equal(fakeResolver({ baseline: true })('/measurement/result'), '/home')
  })

  test('진행 중(running)이거나 일시정지된 세션은 Result를 열지 못하고, 종료된 세션만 연다', () => {
    assert.equal(fakeResolver({ session: 'running' })('/measurement/result'), '/measurement/guide')
    assert.equal(fakeResolver({ session: 'paused' })('/measurement/result'), '/measurement/guide')
    assert.equal(fakeResolver({ session: 'finished' })('/measurement/result'), null)
  })

  test('종료된 세션이 있어도 메인 탭은 baseline 완료로 취급하지 않는다', () => {
    assert.equal(fakeResolver({ session: 'finished' })('/home'), '/measurement/guide')
  })

  test('진행 중인 세션이든 아니든 Active는 선행 단계만 통과하면 허용한다 (baseline 미완료가 정상)', () => {
    for (const session of ['running', 'paused', 'finished', null] as const) {
      assert.equal(fakeResolver({ session })('/measurement/active'), null, String(session))
    }
  })

  test('호출할 때마다 그 시점의 상태를 읽는다', () => {
    const fakes: Fakes = { left: false }
    const resolve = fakeResolver(fakes)
    assert.equal(resolve('/home'), '/measurement/guide')
    fakes.left = true
    assert.equal(resolve('/home'), null)
  })
})

describe('createMockAwareMeasurementReader (개발 전용 Mock 모드)', () => {
  const fakeReader = (status: Status | null) => () => ({ session: status === null ? null : { status } })

  test('Mock 모드가 아니면 Store의 세션을 그대로 읽는다', () => {
    assert.equal(createMockAwareMeasurementReader(false, fakeReader(null))().session, null)
    assert.equal(createMockAwareMeasurementReader(false, fakeReader('running'))().session?.status, 'running')
  })

  test('Mock 모드이면 세션이 없어도 종료된 세션이 있는 것으로 알려 준다 (결과 화면만 열린다)', () => {
    const reader = createMockAwareMeasurementReader(true, fakeReader(null))
    assert.equal(reader().session?.status, 'finished')
    const resolve = createRouteRedirectResolver(
      () => ({ onboardingCompleted: true, baselineMeasurementCompleted: false }),
      () => COMPLETE_PROFILE,
      () => false,
      reader,
    )
    assert.equal(resolve('/measurement/result'), null)
    assert.equal(resolve('/home'), '/measurement/guide') // 메인 탭 정책은 그대로다
  })

  test('Mock 모드여도 온보딩·프로필 선행 단계는 우회하지 못한다', () => {
    const reader = createMockAwareMeasurementReader(true, fakeReader(null))
    const noOnboarding = createRouteRedirectResolver(
      () => ({ onboardingCompleted: false, baselineMeasurementCompleted: false }),
      () => COMPLETE_PROFILE,
      () => false,
      reader,
    )
    assert.equal(noOnboarding('/measurement/result'), '/onboarding/intro')
    const noProfile = createRouteRedirectResolver(
      () => ({ onboardingCompleted: true, baselineMeasurementCompleted: false }),
      () => EMPTY_PROFILE,
      () => false,
      reader,
    )
    assert.equal(noProfile('/measurement/result'), '/profile/consent')
  })

  test('실제 resolveRouteRedirect는 테스트 환경(window 없음)에서 Mock 모드가 켜지지 않는다', () => {
    assert.equal(typeof window, 'undefined')
  })
})

describe('resolveRouteRedirect (실제 Store)', () => {
  function resetAll(): void {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    measurementStore.setState({ session: null, runSource: null })
  }

  function completeProfile(): void {
    profileStore.getState().setConsent(Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true])))
    profileStore.getState().recordConsent(null, 1)
    profileStore.getState().setProfile({ nickname: '러너킴' })
    profileStore.getState().completeProfile(5)
  }

  test('실제 Store 상태에 따라 경로가 정해지고, 호출은 어떤 Store 값도 바꾸지 않는다', () => {
    resetAll()
    try {
      assert.equal(resolveRouteRedirect('/home'), '/onboarding/intro')

      useOnboardingStore.getState().completeOnboarding()
      assert.equal(resolveRouteRedirect('/home'), '/profile/consent')

      completeProfile()
      assert.equal(resolveRouteRedirect('/home'), '/measurement/guide')
      assert.equal(resolveRouteRedirect('/measurement/result'), '/measurement/guide')
      assert.equal(resolveRouteRedirect('/measurement/active'), null)

      const finished = stopSession(startSession(null, 1000), 2000, 'user')
      measurementStore.setState({ session: finished })
      assert.equal(resolveRouteRedirect('/measurement/result'), null)

      // 호출 전후로 값이 같다. (읽기만 한다)
      const before = {
        onboarding: JSON.stringify(useOnboardingStore.getState()),
        profile: JSON.stringify(profileStore.getState()),
        session: measurementStore.getState().session,
        baseline: useOnboardingStore.getState().baselineMeasurementCompleted,
      }
      for (const path of ['/home', '/running', '/records', '/growth', '/my', '/measurement/guide', '/measurement/active', '/measurement/result']) {
        resolveRouteRedirect(path)
      }
      assert.equal(JSON.stringify(useOnboardingStore.getState()), before.onboarding)
      assert.equal(JSON.stringify(profileStore.getState()), before.profile)
      assert.equal(measurementStore.getState().session, before.session)
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, before.baseline)
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
    } finally {
      resetAll()
    }
  })

  test('기존 resolveEntryPath와 resolvePostProfilePath의 결과에 영향이 없다', () => {
    resetAll()
    try {
      useOnboardingStore.getState().completeOnboarding()
      completeProfile()
      const entryBefore = resolveEntryPath()
      const postBefore = resolvePostProfilePath()
      for (const path of ['/home', '/measurement/result', '/measurement/guide']) resolveRouteRedirect(path)
      assert.equal(resolveEntryPath(), entryBefore)
      assert.equal(resolvePostProfilePath(), postBefore)
      assert.equal(entryBefore, '/measurement/guide')
      assert.equal(postBefore, '/measurement/guide')
      // 이 가드는 기록을 남기지 않는다.
      assert.equal(guideSkipSession.wasSkipped(), false)
      assert.equal(guideBackSession.wasLeft(), false)
    } finally {
      resetAll()
    }
  })
})

// 마지막: 이 파일의 모듈 상태(Guide 기록)를 바꾸는 테스트. (파일마다 별도 프로세스이므로 다른 파일에는 영향이 없다.)
describe('Guide 기록과 실제 연결', () => {
  test('뒤로 가기 기록이 메인 탭을 열고, Splash 진입 경로와 baseline은 그대로다 (건너뛰기 기록은 별도 파일에서 확인한다)', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      useOnboardingStore.getState().completeOnboarding()
      profileStore.getState().setConsent(Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true])))
      profileStore.getState().recordConsent(null, 1)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      profileStore.getState().completeProfile(5)

      assert.equal(resolveRouteRedirect('/home'), '/measurement/guide')

      guideBackSession.markLeft()
      assert.equal(resolveRouteRedirect('/home'), null)
      assert.equal(resolveRouteRedirect('/my'), null)
      assert.equal(guideSkipSession.wasSkipped(), false)
      assert.equal(resolveEntryPath(), '/measurement/guide')
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
      assert.equal(resolveRouteRedirect('/measurement/result'), '/measurement/guide')
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})
