import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { describeActiveGps, describeRestoreHint, GPS_ACTIVE_LABELS } from './activeCopy.ts'

// 기존 화면 문구가 상태에 그대로 연결되는지 확인한다(문구를 새로 정하지 않는다).
describe('측정 중 GPS 상태 문구', () => {
  test('상태마다 기존 문구가 연결된다', () => {
    assert.equal(describeActiveGps('good'), '양호')
    assert.equal(describeActiveGps('weak'), '약함')
    assert.equal(describeActiveGps('lost'), '끊김')
    assert.equal(describeActiveGps('unavailable'), '사용 불가')
  })
  test('신호 끊김과 사용 불가(권한 거부 등)는 서로 다른 문구이다', () => {
    assert.notEqual(describeActiveGps('lost'), describeActiveGps('unavailable'))
    assert.equal(new Set(Object.values(GPS_ACTIVE_LABELS)).size, 4)
  })
  test('상태가 없으면(검색 중) 문구를 만들지 않고 null이다', () => {
    assert.equal(describeActiveGps(null), null)
  })
})

describe('복원 후 GPS 재확인 안내', () => {
  test('재확인 전·후 문구가 구분된다', () => {
    assert.equal(describeRestoreHint(false), 'GPS가 확인되면 이어갈 수 있어요.')
    assert.equal(describeRestoreHint(true), 'GPS가 확인됐어요. 이어서 달릴 수 있어요.')
  })
})
