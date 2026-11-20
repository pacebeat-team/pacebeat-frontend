import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canContinueFromExperience, recordPermissionStep, skipPermissionStep } from './onboardingFlow.ts'
import type { LocationPermission, MotionFitnessSupport } from '../types/onboarding.ts'

function fakeWriter() {
  const calls: string[] = []
  return {
    calls,
    writer: {
      setLocationPermission: (value: LocationPermission) => calls.push(`location:${value}`),
      setMotionFitnessSupport: (value: MotionFitnessSupport) => calls.push(`motion:${value}`),
      completeOnboarding: () => calls.push('complete'),
    },
  }
}

describe('canContinueFromExperience', () => {
  it('러닝 경험을 고르지 않으면 다음으로 갈 수 없다', () => {
    assert.equal(canContinueFromExperience(null), false)
  })
  it('경험 수준 세 가지 중 어느 것이든 고르면 다음으로 갈 수 있다', () => {
    for (const level of ['beginner', 'occasional', 'regular'] as const) {
      assert.equal(canContinueFromExperience(level), true)
    }
  })
})

describe('recordPermissionStep', () => {
  it('허용: 위치 권한과 지원 여부를 저장하고 온보딩을 완료한다', () => {
    const { calls, writer } = fakeWriter()
    recordPermissionStep(writer, 'granted', null)
    assert.deepEqual(calls, ['location:granted', 'motion:null', 'complete'])
  })
  it('거부여도 저장하고 온보딩을 완료한다', () => {
    const { calls, writer } = fakeWriter()
    recordPermissionStep(writer, 'denied', 'unsupported')
    assert.deepEqual(calls, ['location:denied', 'motion:unsupported', 'complete'])
  })
  it('위치 권한을 판단할 수 없으면(null) 기존 값을 덮어쓰지 않지만 온보딩은 완료한다', () => {
    const { calls, writer } = fakeWriter()
    recordPermissionStep(writer, null, 'unsupported')
    assert.deepEqual(calls, ['motion:unsupported', 'complete'])
  })
})

describe('skipPermissionStep', () => {
  it('"나중에 할게요"는 권한·지원 여부를 건드리지 않고 온보딩만 완료한다', () => {
    const { calls, writer } = fakeWriter()
    skipPermissionStep(writer)
    assert.deepEqual(calls, ['complete'])
  })
})
