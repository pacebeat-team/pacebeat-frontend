import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildRunRecord } from './record.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

// 기초 측정과의 경계 검사.
// - 소스 검사: features/running의 소스(테스트 제외)가 쓸 수 있는 기초 측정 모듈은 순수 엔진 모듈뿐이다.
// - 동작 검사: 일반 RUN을 끝까지 써도 기초 측정 Store·온보딩 완료 상태·기초 측정 저장 키가 바뀌지 않는다.

const RUNNING_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(RUNNING_DIR, '..', '..')
const MEASUREMENT_DIR = join(SRC_DIR, 'features', 'measurement')
const ALLOWED_MEASUREMENT_MODULES = new Set(['session', 'gpsTracker', 'metrics', 'geolocationSource', 'geo', 'types'])
const MEASUREMENT_STORAGE_KEY = 'pacebeat:measurement:v1'

function listSources(): { name: string; text: string }[] {
  return readdirSync(RUNNING_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(RUNNING_DIR, name), 'utf8') }))
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = []
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1])
  return specifiers
}

describe('소스 경계', () => {
  const sources = listSources()

  test('검사 대상 소스가 있다', () => {
    assert.ok(sources.length >= 10)
  })

  test('기초 측정 모듈은 허용된 순수 엔진 모듈만 가져온다', () => {
    for (const { name, text } of sources) {
      for (const specifier of importSpecifiers(text)) {
        if (!specifier.startsWith('.')) continue
        const target = resolve(RUNNING_DIR, specifier)
        if (target.startsWith(MEASUREMENT_DIR)) {
          const module = basename(target).replace(/\.ts$/, '')
          assert.ok(ALLOWED_MEASUREMENT_MODULES.has(module), `${name}이(가) 허용되지 않은 측정 모듈을 가져옴: ${specifier}`)
        }
      }
    }
  })

  test('features/running 밖에서는 기초 측정 모듈 외에 아무것도 가져오지 않는다(Store·lib·app 금지)', () => {
    for (const { name, text } of sources) {
      for (const specifier of importSpecifiers(text)) {
        if (!specifier.startsWith('.')) continue
        const target = resolve(RUNNING_DIR, specifier)
        const inRunning = target.startsWith(RUNNING_DIR)
        const inMeasurement = target.startsWith(MEASUREMENT_DIR)
        assert.ok(inRunning || inMeasurement, `${name}이(가) 경계 밖 모듈을 가져옴: ${specifier}`)
      }
    }
  })

  test('금지 모듈 이름과 기초 측정 저장 키가 소스에 나오지 않는다', () => {
    const forbidden = ['measurementStore', 'completionSync', 'baselineCompletion', 'onboardingStore', 'sessionPersistence']
    for (const { name, text } of sources) {
      for (const word of forbidden) {
        assert.ok(!importSpecifiers(text).some((specifier) => specifier.includes(word)), `${name}이(가) ${word}를 가져옴`)
      }
      assert.ok(!text.includes(MEASUREMENT_STORAGE_KEY), `${name}에 기초 측정 저장 키가 있음`)
      assert.ok(!/measurement\/baseline(\.ts)?['"]/.test(text), `${name}이(가) baseline.ts를 가져옴`)
    }
  })

  test('기초 측정 소스는 features/running을 가져오지 않는다(반대 방향 금지)', () => {
    const offenders: string[] = []
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(join(dir, entry.name))
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (/features\/running/.test(readFileSync(join(dir, entry.name), 'utf8'))) offenders.push(entry.name)
        }
      }
    }
    scan(MEASUREMENT_DIR)
    for (const folder of ['stores', 'lib', 'app']) scan(join(SRC_DIR, folder))
    assert.deepEqual(offenders, [])
  })
})

describe('동작 경계: 일반 RUN은 기초 측정 상태를 바꾸지 않는다', () => {
  test('러닝 전 과정(시작·일시정지·재개·종료·저장)을 해도 기초 측정 Store·온보딩 완료·저장 키가 그대로다', async () => {
    const backing = new Map<string, string>([[MEASUREMENT_STORAGE_KEY, 'measurement-data']])
    const fakeLocalStorage: RunKeyValueStorage = {
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => void backing.set(key, value),
      removeItem: (key) => void backing.delete(key),
    }
    // zustand persist(온보딩 Store)는 window.localStorage를 읽는다.
    ;(globalThis as Record<string, unknown>).window = { localStorage: fakeLocalStorage }
    const { measurementStore } = await import('../../stores/measurementStore.ts')
    const { useOnboardingStore } = await import('../../stores/onboardingStore.ts')

    const measurementBefore = JSON.stringify(measurementStore.getState())
    const onboardingBefore = JSON.stringify(useOnboardingStore.getState())
    assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)

    const storage = createRunStorage(fakeLocalStorage)
    const store = createRunStore(storage)
    const BASE = 1_700_000_000_000

    // GPS 러닝: 목표(3km) 도달로 자동 종료 후 기록 저장
    store.getState().startRun('gps', BASE, () => 'sess-1')
    store.getState().recordDistanceSample(300_000, 1000)
    store.getState().pauseRun(BASE + 310_000)
    store.getState().resumeRun(BASE + 320_000)
    store.getState().recordDistanceSample(900_000, 3000)
    store.getState().stopRun(BASE + 930_000, 'goal')
    const active = store.getState().activeSession
    assert.ok(active !== null)
    storage.saveRecord(
      buildRunRecord({
        recordId: 'rec-1',
        session: active.session,
        mode: 'gps',
        goal: active.goal,
        musicTrackId: null,
        distanceM: 3000,
        avgPaceSecPerKm: 300,
        distanceSamples: active.distanceSamples,
        gpsGaps: [],
        goalReached: true,
      }),
    )
    store.getState().clearSession()

    // TIME 러닝도 같은 방식으로
    store.getState().startRun('time', BASE, () => 'sess-2')
    store.getState().stopRun(BASE + 120_000)
    store.getState().clearSession()

    assert.equal(JSON.stringify(measurementStore.getState()), measurementBefore)
    assert.equal(JSON.stringify(useOnboardingStore.getState()), onboardingBefore)
    assert.equal(useOnboardingStore.getState().baselineMeasurementCompleted, false)
    assert.equal(backing.get(MEASUREMENT_STORAGE_KEY), 'measurement-data')
    assert.ok(backing.has('pacebeat:run:records:v1'))
    for (const key of backing.keys()) {
      assert.ok(key === MEASUREMENT_STORAGE_KEY || key.startsWith('pacebeat:run:') || key === 'pacebeat-onboarding', `예상하지 못한 키: ${key}`)
    }
  })
})
