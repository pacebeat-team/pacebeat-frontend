import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'

// persist는 Store를 만들 때 localStorage를 잡으므로, 가져오기 전에 메모리 저장소를 먼저 둔다.
const backing = new Map<string, string>()
const fakeLocalStorage = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => void backing.set(key, value),
  removeItem: (key: string) => void backing.delete(key),
}
// zustand 기본 저장소는 window.localStorage를 읽는다.
;(globalThis as Record<string, unknown>).window = { localStorage: fakeLocalStorage }

const { useOnboardingStore } = await import('./onboardingStore.ts')
const KEY = 'pacebeat-onboarding'

beforeEach(() => {
  backing.clear()
  useOnboardingStore.getState().reset()
})

describe('onboardingStore', () => {
  it('처음에는 모두 비어 있고 완료 표시는 false다', () => {
    const s = useOnboardingStore.getState()
    assert.equal(s.experienceLevel, null)
    assert.equal(s.weeklyRuns, null)
    assert.equal(s.locationPermission, null)
    assert.equal(s.motionFitnessSupport, null)
    assert.equal(s.timeOnlyMode, null)
    assert.equal(s.onboardingCompleted, false)
    assert.equal(s.baselineMeasurementCompleted, false)
  })

  it('위치 권한에 따라 시간 전용 후보(timeOnlyMode)가 정해진다', () => {
    const { setLocationPermission } = useOnboardingStore.getState()
    setLocationPermission('granted')
    assert.equal(useOnboardingStore.getState().timeOnlyMode, false)
    setLocationPermission('denied')
    assert.equal(useOnboardingStore.getState().timeOnlyMode, true)
    setLocationPermission(null)
    assert.equal(useOnboardingStore.getState().timeOnlyMode, null)
  })

  it('완료 표시는 여러 번 불러도 상태를 다시 바꾸지 않는다', () => {
    let notified = 0
    const unsubscribe = useOnboardingStore.subscribe(() => { notified += 1 })
    useOnboardingStore.getState().completeOnboarding()
    useOnboardingStore.getState().completeOnboarding()
    useOnboardingStore.getState().completeBaselineMeasurement()
    useOnboardingStore.getState().completeBaselineMeasurement()
    unsubscribe()
    assert.equal(notified, 2)
    assert.equal(useOnboardingStore.getState().onboardingCompleted, true)
    assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, true)
  })

  it('reset은 모든 값을 처음으로 되돌린다', () => {
    const s = useOnboardingStore.getState()
    s.setExperienceLevel('regular')
    s.setWeeklyRuns('3+')
    s.setLocationPermission('denied')
    s.completeOnboarding()
    s.reset()
    const after = useOnboardingStore.getState()
    assert.equal(after.experienceLevel, null)
    assert.equal(after.weeklyRuns, null)
    assert.equal(after.timeOnlyMode, null)
    assert.equal(after.onboardingCompleted, false)
  })

  it('저장은 데이터 값만 pacebeat-onboarding 키에 담고 함수는 담지 않는다', () => {
    useOnboardingStore.getState().setExperienceLevel('occasional')
    useOnboardingStore.getState().completeOnboarding()
    const saved = JSON.parse(backing.get(KEY) ?? '{}').state
    assert.equal(saved.experienceLevel, 'occasional')
    assert.equal(saved.onboardingCompleted, true)
    assert.deepEqual(Object.keys(saved).sort(), [
      'baselineMeasurementCompleted', 'experienceLevel', 'locationPermission',
      'motionFitnessSupport', 'onboardingCompleted', 'timeOnlyMode', 'weeklyRuns',
    ])
  })

  it('새로고침처럼 다시 불러오면 저장된 값이 복원된다', async () => {
    backing.set(KEY, JSON.stringify({
      state: { experienceLevel: 'regular', weeklyRuns: '2', locationPermission: 'granted', motionFitnessSupport: null, timeOnlyMode: false, onboardingCompleted: true, baselineMeasurementCompleted: false },
      version: 0,
    }))
    await useOnboardingStore.persist.rehydrate()
    const s = useOnboardingStore.getState()
    assert.equal(s.experienceLevel, 'regular')
    assert.equal(s.weeklyRuns, '2')
    assert.equal(s.locationPermission, 'granted')
    assert.equal(s.onboardingCompleted, true)
    assert.equal(s.baselineMeasurementCompleted, false)
  })

  it('완료 표시가 없던 옛 저장 데이터는 미완료(false)로 읽는다', async () => {
    backing.set(KEY, JSON.stringify({ state: { experienceLevel: 'beginner' }, version: 0 }))
    await useOnboardingStore.persist.rehydrate()
    const s = useOnboardingStore.getState()
    assert.equal(s.experienceLevel, 'beginner')
    assert.notEqual(s.onboardingCompleted, true)
    assert.notEqual(s.baselineMeasurementCompleted, true)
  })

  it('저장 데이터가 깨져 있어도 예외 없이 처음 상태로 시작한다', async () => {
    backing.set(KEY, '{깨진 JSON')
    await assert.doesNotReject(async () => { await useOnboardingStore.persist.rehydrate() })
    assert.notEqual(useOnboardingStore.getState().onboardingCompleted, true)
  })
})

describe('Store 독립 정책', () => {
  it('온보딩 Store와 프로필 Store는 서로를 가져오지 않는다', () => {
    const onboarding = readFileSync(new URL('./onboardingStore.ts', import.meta.url), 'utf8')
    const profile = readFileSync(new URL('../features/profile/profileStore.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(onboarding, /profileStore/)
    assert.doesNotMatch(profile, /onboardingStore/)
  })
})
