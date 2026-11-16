import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { getEntryPath } from './entryPath.ts'

describe('getEntryPath', () => {
  test('온보딩 미완료, 기초 측정 미완료 → Intro', () => {
    assert.equal(
      getEntryPath({ onboardingCompleted: false, baselineMeasurementCompleted: false }),
      '/onboarding/intro',
    )
  })

  test('온보딩 미완료면 기초 측정이 완료로 기록돼 있어도 Intro', () => {
    assert.equal(
      getEntryPath({ onboardingCompleted: false, baselineMeasurementCompleted: true }),
      '/onboarding/intro',
    )
  })

  test('온보딩 완료, 기초 측정 미완료 → 측정 Guide', () => {
    assert.equal(
      getEntryPath({ onboardingCompleted: true, baselineMeasurementCompleted: false }),
      '/measurement/guide',
    )
  })

  test('온보딩 완료, 기초 측정 완료 → Home', () => {
    assert.equal(
      getEntryPath({ onboardingCompleted: true, baselineMeasurementCompleted: true }),
      '/home',
    )
  })
})
