import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { profileStore } from '../features/profile/profileStore.ts'
import { REQUIRED_CONSENT_KEYS } from '../features/profile/types.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { resolveEntryPath, resolveRouteRedirect } from './entryFlow.ts'
import { guideBackSession, guideSkipSession } from './guideSkip.ts'

// guideSkipSession은 모듈 상태를 가지므로 이 파일(별도 프로세스)에서만 기록한다. 뒤로 가기 기록은 entryFlow.routeRedirect.test.ts에서 확인한다.
describe('Guide 건너뛰기 기록과 실제 연결', () => {
  test('건너뛰기 기록만 있어도 메인 탭이 열리고, 뒤로 가기 기록과 Splash 진입 경로, baseline은 그대로다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      useOnboardingStore.getState().completeOnboarding()
      profileStore.getState().setConsent(Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true])))
      profileStore.getState().recordConsent(null, 1)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      profileStore.getState().completeProfile(5)

      assert.equal(resolveRouteRedirect('/home'), '/measurement/guide')

      guideSkipSession.markSkipped()

      for (const path of ['/home', '/running', '/records', '/growth', '/my']) assert.equal(resolveRouteRedirect(path), null, path)
      assert.equal(guideBackSession.wasLeft(), false)
      assert.equal(resolveEntryPath(), '/measurement/guide')
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
      assert.equal(resolveRouteRedirect('/measurement/result'), '/measurement/guide')
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})
