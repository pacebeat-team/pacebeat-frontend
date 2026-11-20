import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { getEntryPath } from './entryPath.ts'
import { MAIN_TAB_PATHS, MEASUREMENT_PATHS, getProtectedRoute, getRouteRedirect } from './routeAccess.ts'
import type { RouteAccessState } from './routeAccess.ts'

const PROFILE_PATHS = ['/profile/consent', '/profile/nickname', '/profile/demographics']

// 모든 상태 조합. profileResumePath는 null(완료)과 프로필 이어하기 경로 세 가지다.
function allStates(): RouteAccessState[] {
  const states: RouteAccessState[] = []
  for (const onboardingCompleted of [false, true]) {
    for (const profileResumePath of [null, ...PROFILE_PATHS]) {
      for (const baselineMeasurementCompleted of [false, true]) {
        for (const guideLeftThisRun of [false, true]) {
          for (const hasFinishedSession of [false, true]) {
            states.push({
              onboardingCompleted,
              baselineMeasurementCompleted,
              profileResumePath,
              guideLeftThisRun,
              hasFinishedSession,
            })
          }
        }
      }
    }
  }
  return states
}

const DONE: RouteAccessState = {
  onboardingCompleted: true,
  baselineMeasurementCompleted: false,
  profileResumePath: null,
  guideLeftThisRun: false,
  hasFinishedSession: false,
}

function redirect(path: string, patch: Partial<RouteAccessState> = {}): string | null {
  return getRouteRedirect(path, { ...DONE, ...patch })
}

describe('공통 선행 단계', () => {
  test('온보딩 미완료면 모든 보호 경로가 Intro로 간다 (다른 상태와 무관)', () => {
    for (const path of [...MAIN_TAB_PATHS, ...MEASUREMENT_PATHS]) {
      for (const state of allStates().filter((s) => !s.onboardingCompleted)) {
        assert.equal(getRouteRedirect(path, state), '/onboarding/intro', path)
      }
    }
  })

  test('온보딩 완료, 프로필 미완료면 모든 보호 경로가 프로필 이어하기 경로로 간다', () => {
    for (const path of [...MAIN_TAB_PATHS, ...MEASUREMENT_PATHS]) {
      for (const resume of PROFILE_PATHS) {
        for (const state of allStates().filter((s) => s.onboardingCompleted && s.profileResumePath === resume)) {
          assert.equal(getRouteRedirect(path, state), resume, path)
        }
      }
    }
  })

  test('Guide 종료 기록과 완료한 기초 측정, 종료된 세션은 선행 단계를 건너뛰게 하지 못한다', () => {
    const rich = { guideLeftThisRun: true, baselineMeasurementCompleted: true, hasFinishedSession: true }
    assert.equal(redirect('/home', { ...rich, onboardingCompleted: false }), '/onboarding/intro')
    assert.equal(redirect('/measurement/result', { ...rich, profileResumePath: '/profile/consent' }), '/profile/consent')
  })
})

describe('메인 탭 (/home, /running, /records, /growth, /my)', () => {
  test('기초 측정을 완료했으면 연다', () => {
    for (const path of MAIN_TAB_PATHS) assert.equal(redirect(path, { baselineMeasurementCompleted: true }), null, path)
  })

  test('이번 실행에서 Guide를 건너뛰었거나 뒤로 가기로 나왔으면 연다 (완료는 false 그대로)', () => {
    for (const path of MAIN_TAB_PATHS) assert.equal(redirect(path, { guideLeftThisRun: true }), null, path)
  })

  test('기초 측정을 완료하지 않았고 기록도 없으면 Guide로 보낸다', () => {
    for (const path of MAIN_TAB_PATHS) assert.equal(redirect(path), '/measurement/guide', path)
  })

  test('종료된 세션이 있어도 기초 측정 완료로 인정하지 않는다', () => {
    for (const path of MAIN_TAB_PATHS) assert.equal(redirect(path, { hasFinishedSession: true }), '/measurement/guide', path)
  })
})

describe('/measurement/guide, /measurement/active', () => {
  test('선행 단계를 마쳤으면 기초 측정 상태와 기록에 관계없이 연다 (기초 측정 진행 중과 재측정)', () => {
    for (const path of ['/measurement/guide', '/measurement/active']) {
      for (const baseline of [false, true]) {
        for (const left of [false, true]) {
          for (const finished of [false, true]) {
            assert.equal(
              redirect(path, { baselineMeasurementCompleted: baseline, guideLeftThisRun: left, hasFinishedSession: finished }),
              null,
              `${path} baseline=${baseline} left=${left} finished=${finished}`,
            )
          }
        }
      }
    }
  })
})

describe('/measurement/result', () => {
  test('종료된 세션이 있으면 연다 (기초 측정 완료 여부와 무관)', () => {
    assert.equal(redirect('/measurement/result', { hasFinishedSession: true }), null)
    assert.equal(redirect('/measurement/result', { hasFinishedSession: true, baselineMeasurementCompleted: true }), null)
  })

  test('종료된 세션이 없고 기초 측정 미완료면 Guide로 보낸다 (Guide 종료 기록이 있어도 완료로 보지 않는다)', () => {
    assert.equal(redirect('/measurement/result'), '/measurement/guide')
    assert.equal(redirect('/measurement/result', { guideLeftThisRun: true }), '/measurement/guide')
  })

  test('종료된 세션이 없고 기초 측정을 완료했으면 Home으로 보낸다', () => {
    assert.equal(redirect('/measurement/result', { baselineMeasurementCompleted: true }), '/home')
  })
})

describe('보호 대상이 아닌 경로', () => {
  test('어떤 상태에서도 null이다', () => {
    const paths = ['/', '/profile', '/profile/consent', '/onboarding/intro', '/onboarding/permissions', '/measurement', '/unknown', '/home/x']
    for (const path of paths) {
      for (const state of allStates()) assert.equal(getRouteRedirect(path, state), null, path)
    }
  })
})

describe('경로 모양', () => {
  test('대소문자, 끝의 "/", 겹친 "/", 인코딩이 달라도 같은 경로로 판단한다', () => {
    for (const variant of ['/Home', '/home/', '//home', '/%68ome', '/HOME//']) {
      assert.equal(getProtectedRoute(variant), '/home', variant)
      assert.equal(redirect(variant), '/measurement/guide', variant)
    }
    assert.equal(getProtectedRoute('/Measurement/Result/'), '/measurement/result')
  })

  test('잘못된 인코딩은 보호 대상으로 보지 않는다 (라우터도 일치시키지 못한다)', () => {
    assert.equal(getProtectedRoute('/%E0%A4%A'), null)
  })
})

describe('불변식', () => {
  const protectedPaths = [...MAIN_TAB_PATHS, ...MEASUREMENT_PATHS]

  test('리다이렉트 목적지는 같은 상태에서 다시 리다이렉트되지 않는다 (순환 없음)', () => {
    for (const path of protectedPaths) {
      for (const state of allStates()) {
        const target = getRouteRedirect(path, state)
        if (target === null) continue
        assert.equal(getRouteRedirect(target, state), null, `${path} -> ${target}`)
      }
    }
  })

  test('리다이렉트는 한 번으로 끝난다 (보호 경로에서 보호 경로로, 다시 보호 경로로 가지 않는다)', () => {
    for (const path of protectedPaths) {
      for (const state of allStates()) {
        const first = getRouteRedirect(path, state)
        if (first === null || getProtectedRoute(first) === null) continue
        assert.equal(getRouteRedirect(first, state), null)
      }
    }
  })

  test('메인 탭 정책은 기존 진입 경로 계산과 모순되지 않는다', () => {
    // 기록이 없을 때 메인 탭이 열리는 상태는 Splash가 Home으로 보내는 상태와 같다.
    for (const path of MAIN_TAB_PATHS) {
      for (const state of allStates()) {
        const entry = getEntryPath(
          {
            onboardingCompleted: state.onboardingCompleted,
            baselineMeasurementCompleted: state.baselineMeasurementCompleted || state.guideLeftThisRun,
          },
          state.profileResumePath,
        )
        const target = getRouteRedirect(path, state)
        assert.equal(target === null, entry === '/home', `${path}`)
        if (target !== null) assert.equal(target, entry, `${path}`)
      }
    }
  })

  test('가드는 상태를 바꾸지 않는다 (입력 객체 불변, 같은 입력에 같은 결과)', () => {
    const state = Object.freeze({ ...DONE, guideLeftThisRun: true })
    const first = getRouteRedirect('/home', state)
    assert.equal(getRouteRedirect('/home', state), first)
    assert.deepEqual(state, { ...DONE, guideLeftThisRun: true })
  })
})
