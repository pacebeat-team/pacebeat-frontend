import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { describeLocationReadiness, getReadyActions, queryLocationReadiness } from './locationReadiness.ts'
import type { PermissionsLike } from './locationReadiness.ts'

const geolocation = { watchPosition: () => 1, clearWatch: () => undefined }
const secureEnv = { isSecureContext: true, geolocation }
const permission = (state: string): PermissionsLike => ({ query: async () => ({ state }) })

describe('위치 사용 가능 여부', () => {
  test('보안 컨텍스트이고 geolocation이 있으며 권한 상태를 알 수 없으면 사용 가능', async () => {
    assert.deepEqual(await queryLocationReadiness({ env: secureEnv, permissions: null }), { available: true })
  })
  test('권한이 prompt·granted면 사용 가능', async () => {
    assert.equal((await queryLocationReadiness({ env: secureEnv, permissions: permission('prompt') })).available, true)
    assert.equal((await queryLocationReadiness({ env: secureEnv, permissions: permission('granted') })).available, true)
  })
  test('권한이 denied면 사용 불가', async () => {
    assert.deepEqual(await queryLocationReadiness({ env: secureEnv, permissions: permission('denied') }), {
      available: false,
      reason: 'denied',
    })
  })
  test('비보안 환경은 사용 불가', async () => {
    assert.deepEqual(await queryLocationReadiness({ env: { isSecureContext: false, geolocation }, permissions: null }), {
      available: false,
      reason: 'insecure-context',
    })
  })
  test('geolocation을 지원하지 않으면 사용 불가', async () => {
    assert.deepEqual(await queryLocationReadiness({ env: { isSecureContext: true, geolocation: null }, permissions: null }), {
      available: false,
      reason: 'unsupported',
    })
  })
  test('권한 조회가 실패하면 사용 가능으로 본다(시작할 때 실제 권한이 결정한다)', async () => {
    const failing: PermissionsLike = {
      query: async () => {
        throw new Error('TypeError')
      },
    }
    assert.equal((await queryLocationReadiness({ env: secureEnv, permissions: failing })).available, true)
  })
})

describe('준비 확인 화면 문구와 버튼 상태', () => {
  test('사용 가능: 양호 문구, 러닝 시작 가능, 시간 기록은 강조하지 않음', () => {
    const row = describeLocationReadiness({ available: true })
    assert.equal(row.status, '양호')
    assert.equal(row.detail, '거리와 페이스를 기록할 수 있어요.')
    assert.deepEqual(getReadyActions({ available: true }), { startDisabled: false, timeEmphasized: false })
  })
  test('사용 불가(거부·미지원·비보안): 러닝 시작 비활성, 시간 기록 강조', () => {
    for (const reason of ['denied', 'unsupported', 'insecure-context'] as const) {
      const readiness = { available: false, reason } as const
      assert.equal(describeLocationReadiness(readiness).status, '사용할 수 없어요')
      assert.deepEqual(getReadyActions(readiness), { startDisabled: true, timeEmphasized: true })
    }
  })
  test('확인 중에는 러닝 시작을 누를 수 없고 시간 기록을 강조하지 않는다', () => {
    assert.equal(describeLocationReadiness(null).status, '확인 중')
    assert.deepEqual(getReadyActions(null), { startDisabled: true, timeEmphasized: false })
  })
})
