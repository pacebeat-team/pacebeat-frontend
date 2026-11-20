import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRecordGuideExit } from './guidePopExit.ts'

const nav = (historyAction: string, pathname: string) => ({ historyAction, nextLocation: { pathname } })

describe('shouldRecordGuideExit', () => {
  test('기록 이동(POP)으로 프로필 화면이나 Home 등으로 나가면 잡는다', () => {
    for (const path of ['/profile/consent', '/profile/nickname', '/profile/demographics', '/profile/body', '/home', '/']) {
      assert.equal(shouldRecordGuideExit(nav('POP', path)), true, path)
    }
  })

  test('앱 내부 이동(PUSH, REPLACE)은 잡지 않는다', () => {
    for (const action of ['PUSH', 'REPLACE']) {
      assert.equal(shouldRecordGuideExit(nav(action, '/home')), false, action)
      assert.equal(shouldRecordGuideExit(nav(action, '/measurement/active')), false, action)
    }
  })

  test('측정 흐름 안의 POP은 Guide를 나가는 것이 아니므로 잡지 않는다', () => {
    for (const path of ['/measurement/active', '/measurement/result', '/measurement/guide']) {
      assert.equal(shouldRecordGuideExit(nav('POP', path)), false, path)
    }
  })
})
