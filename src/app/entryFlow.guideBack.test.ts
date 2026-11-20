import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { profileStore } from '../features/profile/profileStore.ts'
import { REQUIRED_CONSENT_KEYS } from '../features/profile/types.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { resolveEntryPath, resolvePostProfilePath } from './entryFlow.ts'
import { guideBackSession, guideSkipSession } from './guideSkip.ts'

// guideBackSession은 모듈 상태를 가지므로 이 파일(별도 프로세스)에서만 기록한다.
describe('Guide 뒤로 가기와 실제 연결', () => {
  test('뒤로 가기로 나오면 프로필 완료 후 경로만 Home이 되고, 건너뛰기와 진입 경로, 기초 측정 상태는 그대로다', () => {
    profileStore.getState().reset()
    useOnboardingStore.getState().reset()
    try {
      useOnboardingStore.getState().completeOnboarding()
      profileStore.getState().setConsent(Object.fromEntries(REQUIRED_CONSENT_KEYS.map((key) => [key, true])))
      profileStore.getState().recordConsent(null, 1)
      profileStore.getState().setProfile({ nickname: '러너킴' })
      profileStore.getState().completeProfile(5)
      assert.equal(resolvePostProfilePath(), '/measurement/guide')

      guideBackSession.markLeft()

      assert.equal(resolvePostProfilePath(), '/home')
      assert.equal(resolveEntryPath(), '/measurement/guide')
      assert.equal(guideSkipSession.wasSkipped(), false)
      assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
    } finally {
      profileStore.getState().reset()
      useOnboardingStore.getState().reset()
    }
  })
})
