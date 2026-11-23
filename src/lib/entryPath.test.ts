import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { getEntryPath } from './entryPath.ts'

interface Case {
  onboarding: boolean
  profile: string | null
  baseline: boolean
  expected: string
}

function entry(onboarding: boolean, baseline: boolean, profile: string | null): string {
  return getEntryPath({ onboardingCompleted: onboarding, baselineMeasurementCompleted: baseline }, profile)
}

describe('getEntryPath', () => {
  test('온보딩 미완료, 프로필 완료(null), 기초 측정 미완료 → Intro', () => {
    assert.equal(entry(false, false, null), '/onboarding/intro')
  })

  test('온보딩 미완료면 프로필 이어하기 경로가 있어도 Intro', () => {
    assert.equal(entry(false, false, '/profile/consent'), '/onboarding/intro')
  })

  test('온보딩 미완료면 기초 측정이 완료로 기록돼 있어도 Intro', () => {
    assert.equal(entry(false, true, null), '/onboarding/intro')
    assert.equal(entry(false, true, '/profile/nickname'), '/onboarding/intro')
  })

  test('온보딩 완료, 프로필 미완료 → 프로필 이어하기 경로 (동의·닉네임·출생연도 성별)', () => {
    assert.equal(entry(true, false, '/profile/consent'), '/profile/consent')
    assert.equal(entry(true, false, '/profile/nickname'), '/profile/nickname')
    assert.equal(entry(true, false, '/profile/demographics'), '/profile/demographics')
  })

  test('프로필 이어하기 경로는 기초 측정 상태보다 우선한다', () => {
    assert.equal(entry(true, true, '/profile/consent'), '/profile/consent')
    assert.equal(entry(true, true, '/profile/demographics'), '/profile/demographics')
  })

  test('온보딩 완료, 프로필 완료(null), 기초 측정 미완료 → 측정 Guide', () => {
    assert.equal(entry(true, false, null), '/measurement/guide')
  })

  test('온보딩 완료, 프로필 완료(null), 기초 측정 완료 → Home', () => {
    assert.equal(entry(true, true, null), '/home')
  })

  test('모든 조합이 우선순위 표와 같다', () => {
    const resumes: Array<string | null> = [null, '/profile/consent', '/profile/nickname', '/profile/demographics']
    const cases: Case[] = []
    for (const onboarding of [false, true]) {
      for (const baseline of [false, true]) {
        for (const profile of resumes) {
          const expected = !onboarding
            ? '/onboarding/intro'
            : profile !== null
              ? profile
              : baseline
                ? '/home'
                : '/measurement/guide'
          cases.push({ onboarding, profile, baseline, expected })
        }
      }
    }
    assert.equal(cases.length, 16)
    for (const c of cases) {
      assert.equal(entry(c.onboarding, c.baseline, c.profile), c.expected, JSON.stringify(c))
    }
  })

  test('프로필을 완료하지 않은 어떤 경우에도 Guide나 Home으로 가지 않는다', () => {
    for (const baseline of [false, true]) {
      const path = entry(true, baseline, '/profile/consent')
      assert.notEqual(path, '/measurement/guide')
      assert.notEqual(path, '/home')
    }
  })

  test('입력을 바꾸지 않는다', () => {
    const state = { onboardingCompleted: true, baselineMeasurementCompleted: false }
    const snapshot = { ...state }
    getEntryPath(state, '/profile/consent')
    assert.deepEqual(state, snapshot)
  })
})
