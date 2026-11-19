import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GUIDANCE_SETTINGS,
  GUIDANCE_STORAGE_KEY,
  loadGuidanceSettings,
  parseGuidanceSettings,
  saveGuidanceSettings,
  serializeGuidanceSettings,
} from './guidanceSettings.ts'
import { createGuidanceSettingsStore } from './guidanceSettingsStore.ts'

function memory() {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

test('기본값은 Figma 기본 상태이고 저장 키는 다른 저장소와 겹치지 않는다', () => {
  assert.deepEqual(DEFAULT_GUIDANCE_SETTINGS, { beatGuide: true, voiceGuide: true, frequency: 'offPace', autoPause: true })
  for (const other of ['pacebeat:run:records:v1', 'pacebeat-profile', 'pacebeat-onboarding', 'pacebeat:measurement:v1', 'pacebeat:run:settings']) {
    assert.notEqual(GUIDANCE_STORAGE_KEY, other)
  }
})

test('읽기: 없음·깨짐·다른 버전은 기본값, 알 수 없는 항목만 기본값으로 되돌린다', () => {
  assert.deepEqual(parseGuidanceSettings(null), DEFAULT_GUIDANCE_SETTINGS)
  assert.deepEqual(parseGuidanceSettings('{oops'), DEFAULT_GUIDANCE_SETTINGS)
  assert.deepEqual(parseGuidanceSettings(JSON.stringify({ version: 2, data: { beatGuide: false } })), DEFAULT_GUIDANCE_SETTINGS)
  assert.deepEqual(parseGuidanceSettings('[]'), DEFAULT_GUIDANCE_SETTINGS)
  assert.deepEqual(
    parseGuidanceSettings(JSON.stringify({ version: 1, data: { beatGuide: false, voiceGuide: 'yes', frequency: 'weird', autoPause: false } })),
    { beatGuide: false, voiceGuide: true, frequency: 'offPace', autoPause: false },
  )
})

test('저장 후 다시 읽으면 같은 값이다', () => {
  const mem = memory()
  const next = { beatGuide: false, voiceGuide: false, frequency: 'both', autoPause: false } as const
  assert.equal(saveGuidanceSettings(mem, next), true)
  assert.deepEqual(loadGuidanceSettings(mem), next)
  assert.equal(mem.data.get(GUIDANCE_STORAGE_KEY), serializeGuidanceSettings(next))
})

test('저장소를 쓸 수 없거나 쓰기가 실패해도 예외 없이 동작한다', () => {
  assert.deepEqual(loadGuidanceSettings(null), DEFAULT_GUIDANCE_SETTINGS)
  assert.equal(saveGuidanceSettings(null, DEFAULT_GUIDANCE_SETTINGS), false)
  const broken = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('quota')
    },
  }
  assert.deepEqual(loadGuidanceSettings(broken), DEFAULT_GUIDANCE_SETTINGS)
  assert.equal(saveGuidanceSettings(broken, DEFAULT_GUIDANCE_SETTINGS), false)
  const store = createGuidanceSettingsStore(broken)
  store.getState().setVoiceGuide(false)
  assert.equal(store.getState().voiceGuide, false)
})

test('store: 바꾼 값이 저장되고 새 store가 같은 값으로 시작하며 다른 키는 건드리지 않는다', () => {
  const mem = memory()
  mem.data.set('pacebeat:run:records:v1', 'KEEP')
  const store = createGuidanceSettingsStore(mem)
  store.getState().setFrequency('perKm')
  store.getState().setBeatGuide(false)
  const again = createGuidanceSettingsStore(mem)
  assert.equal(again.getState().frequency, 'perKm')
  assert.equal(again.getState().beatGuide, false)
  assert.equal(again.getState().autoPause, true)
  assert.equal(mem.data.get('pacebeat:run:records:v1'), 'KEEP')
  assert.deepEqual([...mem.data.keys()].sort(), [GUIDANCE_STORAGE_KEY, 'pacebeat:run:records:v1'].sort())
})
