import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRunRedirect, RUN_PATHS } from '../running/runFlow.ts'
import { createRunStore } from '../running/runStore.ts'
import { createRunStorage } from '../running/runStorage.ts'
import { createRunSetupStore } from '../running/runSetupStore.ts'
import { confirmGoalForHomeStart } from './homeEntry.ts'
import { buildGoalRowValue, buildHeroView, buildWeekRow, getWeekdayIndex } from './homeView.ts'

describe('Home 히어로 표시값', () => {
  test('거리·목표 시간·목표 페이스를 Figma 형식으로 만든다', () => {
    assert.deepEqual(buildHeroView(3, 1260), { distanceText: '3.0', goalText: '21:00 목표', paceText: '7:00 /km' })
    assert.deepEqual(buildHeroView(1, 450), { distanceText: '1.0', goalText: '7:30 목표', paceText: '7:30 /km' })
    assert.deepEqual(buildHeroView(5, 2250), { distanceText: '5.0', goalText: '37:30 목표', paceText: '7:30 /km' })
  })
  test('추천 목표 수정 행의 값', () => {
    assert.equal(buildGoalRowValue(3, 1260), '3 km · 21:00')
  })
})

describe('요일 줄', () => {
  test('월요일이 첫 칸, 일요일이 마지막 칸이다 (로컬 시각)', () => {
    assert.equal(getWeekdayIndex(new Date(2026, 10, 16, 0, 0)), 0) // 월
    assert.equal(getWeekdayIndex(new Date(2026, 10, 21, 12, 0)), 5) // 토
    assert.equal(getWeekdayIndex(new Date(2026, 10, 21, 23, 59)), 5)
    assert.equal(getWeekdayIndex(new Date(2026, 10, 22, 0, 0)), 6) // 일
  })
  test('주 경계: 일요일 다음 월요일은 다시 첫 칸', () => {
    assert.equal(getWeekdayIndex(new Date(2026, 10, 22, 23, 59)), 6)
    assert.equal(getWeekdayIndex(new Date(2026, 10, 23, 0, 0)), 0)
  })
  test('7칸에 오늘만 표시한다', () => {
    const row = buildWeekRow(new Date(2026, 10, 21, 9, 0))
    assert.deepEqual(row.map((d) => d.label), ['월', '화', '수', '목', '금', '토', '일'])
    assert.equal(row.filter((d) => d.isToday).length, 1)
    assert.equal(row[5].isToday, true)
  })
})

describe('Home → 음악 진입', () => {
  test('확정 전에는 가드가 목표 화면으로 되돌린다', () => {
    const setup = createRunSetupStore()
    assert.equal(resolveRunRedirect(RUN_PATHS.music, setup.getState().level), RUN_PATHS.goal)
  })
  test('확정 후에는 음악 화면이 막히지 않고, 이미 높은 단계는 낮아지지 않는다', () => {
    const setup = createRunSetupStore()
    confirmGoalForHomeStart(setup)
    assert.equal(resolveRunRedirect(RUN_PATHS.music, setup.getState().level), null)
    setup.getState().confirmMusic()
    confirmGoalForHomeStart(setup)
    assert.equal(setup.getState().level, 3)
  })
})

describe('활성 세션 중 Home 진입', () => {
  test('음악 화면 요청은 진행 화면으로 보내고, Home은 세션을 새로 만들지 않는다', () => {
    const memory = new Map<string, string>()
    const storage = createRunStorage({
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    } as Storage)
    const run = createRunStore(storage)
    run.getState().startRun('time', 1000)
    const before = run.getState().activeSession
    const setup = createRunSetupStore()
    confirmGoalForHomeStart(setup)
    assert.equal(resolveRunRedirect(RUN_PATHS.music, setup.getState().level, 'active'), RUN_PATHS.active)
    assert.equal(run.getState().activeSession, before)
    run.getState().startRun('time', 2000)
    assert.equal(run.getState().activeSession, before)
  })
})
