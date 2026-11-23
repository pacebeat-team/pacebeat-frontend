import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GUIDE_BACK_STORAGE_KEY,
  GUIDE_SKIP_STORAGE_KEY,
  createGuideBackSession,
  createGuideSkipSession,
} from './guideSkip.ts'
import type { GuideSkipStorage } from './guideSkip.ts'

function fakeStorage(): GuideSkipStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe('createGuideSkipSession', () => {
  test('처음에는 건너뛰지 않은 상태다', () => {
    assert.equal(createGuideSkipSession(() => fakeStorage()).wasSkipped(), false)
  })

  test('건너뛰면 기록하고, 여러 번 불러도 같다', () => {
    const storage = fakeStorage()
    const session = createGuideSkipSession(() => storage)
    session.markSkipped()
    session.markSkipped()
    assert.equal(session.wasSkipped(), true)
    assert.equal(storage.data.get(GUIDE_SKIP_STORAGE_KEY), '1')
    assert.equal(storage.data.size, 1)
  })

  test('새로고침(같은 저장소를 쓰는 새 인스턴스)해도 건너뛴 상태가 유지된다', () => {
    const storage = fakeStorage()
    createGuideSkipSession(() => storage).markSkipped()
    assert.equal(createGuideSkipSession(() => storage).wasSkipped(), true)
  })

  test('앱을 새로 시작하면(저장소가 비어 있으면) 건너뛰지 않은 상태다', () => {
    const first = fakeStorage()
    createGuideSkipSession(() => first).markSkipped()
    assert.equal(createGuideSkipSession(() => fakeStorage()).wasSkipped(), false)
  })

  test('저장소를 얻을 수 없으면 메모리에만 기억하고 예외를 던지지 않는다', () => {
    const session = createGuideSkipSession(() => null)
    assert.equal(session.wasSkipped(), false)
    session.markSkipped()
    assert.equal(session.wasSkipped(), true)
  })

  test('저장소 접근이나 쓰기가 예외를 던져도 같은 실행 동안은 기억한다', () => {
    const throwingGet = createGuideSkipSession(() => {
      throw new Error('blocked')
    })
    assert.equal(throwingGet.wasSkipped(), false)
    throwingGet.markSkipped()
    assert.equal(throwingGet.wasSkipped(), true)

    const throwingSet = createGuideSkipSession(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }))
    throwingSet.markSkipped()
    assert.equal(throwingSet.wasSkipped(), true)
  })

  test('건너뛰기는 온보딩 상태를 만들거나 바꾸지 않는다 (저장소에는 건너뜀 표시 하나뿐)', () => {
    const storage = fakeStorage()
    createGuideSkipSession(() => storage).markSkipped()
    assert.deepEqual([...storage.data.keys()], [GUIDE_SKIP_STORAGE_KEY])
  })
})

describe('createGuideBackSession', () => {
  test('처음에는 나오지 않은 상태이고, 기록하면 여러 번 불러도 같다', () => {
    const storage = fakeStorage()
    const session = createGuideBackSession(() => storage)
    assert.equal(session.wasLeft(), false)
    session.markLeft()
    session.markLeft()
    assert.equal(session.wasLeft(), true)
    assert.equal(storage.data.get(GUIDE_BACK_STORAGE_KEY), '1')
  })

  test('건너뛰기 기록과 서로 독립이다 (뒤로 가기는 건너뛰기가 아니다)', () => {
    const storage = fakeStorage()
    const skip = createGuideSkipSession(() => storage)
    const back = createGuideBackSession(() => storage)
    back.markLeft()
    assert.equal(skip.wasSkipped(), false)
    assert.equal(storage.data.has(GUIDE_SKIP_STORAGE_KEY), false)
    skip.markSkipped()
    assert.equal(back.wasLeft(), true)
    assert.notEqual(GUIDE_BACK_STORAGE_KEY, GUIDE_SKIP_STORAGE_KEY)
  })

  test('새로고침(같은 저장소)에서는 유지되고, 새 실행(빈 저장소)에서는 사라진다', () => {
    const storage = fakeStorage()
    createGuideBackSession(() => storage).markLeft()
    assert.equal(createGuideBackSession(() => storage).wasLeft(), true)
    assert.equal(createGuideBackSession(() => fakeStorage()).wasLeft(), false)
  })

  test('저장소를 못 쓰거나 예외를 던져도 같은 실행 동안은 기억한다', () => {
    const none = createGuideBackSession(() => null)
    none.markLeft()
    assert.equal(none.wasLeft(), true)
    const throwing = createGuideBackSession(() => {
      throw new Error('blocked')
    })
    assert.equal(throwing.wasLeft(), false)
    throwing.markLeft()
    assert.equal(throwing.wasLeft(), true)
  })
})
