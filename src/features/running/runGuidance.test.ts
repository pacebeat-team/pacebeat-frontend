import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DEFAULT_GUIDANCE_SETTINGS } from '../my/guidanceSettings.ts'
import { createGuidanceSettingsStore } from '../my/guidanceSettingsStore.ts'
import type { GpsSource } from '../measurement/geolocationSource.ts'
import { DEFAULT_RUN_GUIDANCE, getSessionGuidance, normalizeRunGuidance } from './runGuidance.ts'
import type { RunGuidance } from './runGuidance.ts'
import { createRunLive } from './runLive.ts'
import { createRunResultStore } from './runResultStore.ts'
import { startRunSessionPersistence } from './runSessionRestore.ts'
import { createRunSessionStorage, RUN_SESSION_KEYS } from './runSessionStorage.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

const BASE = 1_700_000_000_000

const ALL_OFF: RunGuidance = { beatGuide: false, voiceGuide: false, frequency: 'both', autoPause: false }

function memoryStorage(map = new Map<string, string>()): RunKeyValueStorage & { readonly map: Map<string, string> } {
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

// 새로고침을 흉내 낸다: 저장소(map)는 그대로 두고 Store·컨트롤러·저장 연결을 새로 만든다.
function boot(kv: RunKeyValueStorage, at = BASE) {
  const clock = { now: at }
  const records = createRunStorage(kv)
  const runs = createRunStore(records)
  const results = createRunResultStore(runs, records, { getState: () => ({ reset: () => undefined }) })
  const source: GpsSource = { start: () => undefined, stop: () => undefined, isRunning: false }
  const controller = createRunLive({
    store: runs,
    now: () => clock.now,
    createSource: () => source,
    createId: () => 'sess-1',
    autoHeartbeat: false,
    listenVisible: () => () => undefined,
    queryPermission: () => Promise.resolve('unknown'),
  })
  const persistence = startRunSessionPersistence({
    runs,
    results,
    live: controller.live,
    sessionStorage: createRunSessionStorage(kv),
    records,
    now: () => clock.now,
  })
  return { clock, runs, controller, persistence }
}

describe('안내 설정 스냅샷 값', () => {
  test('러닝 쪽 기본값은 안내 설정 화면의 기본값과 같다(경계 때문에 따로 둔 값이 어긋나지 않는다)', () => {
    assert.deepEqual({ ...DEFAULT_RUN_GUIDANCE }, { ...DEFAULT_GUIDANCE_SETTINGS })
  })

  test('객체가 아니거나 없으면 기본값이다', () => {
    for (const value of [undefined, null, 'x', 3, [], true]) assert.deepEqual(normalizeRunGuidance(value), DEFAULT_RUN_GUIDANCE)
  })

  test('항목이 누락되거나 손상되면 그 항목만 기본값이고 나머지는 유지한다', () => {
    assert.deepEqual(normalizeRunGuidance({ beatGuide: false }), { ...DEFAULT_RUN_GUIDANCE, beatGuide: false })
    assert.deepEqual(normalizeRunGuidance({ voiceGuide: 'yes', frequency: 'hourly', autoPause: false, beatGuide: false }), {
      beatGuide: false,
      voiceGuide: DEFAULT_RUN_GUIDANCE.voiceGuide,
      frequency: DEFAULT_RUN_GUIDANCE.frequency,
      autoPause: false,
    })
  })

  test('허용하지 않은 필드는 버리고 새 객체를 만든다', () => {
    const input = { ...ALL_OFF, extra: 1, setBeatGuide: () => undefined }
    const out = normalizeRunGuidance(input)
    assert.deepEqual(out, ALL_OFF)
    assert.notEqual(out, input)
  })

  test('스냅샷이 없는 세션은 기본값으로 읽는다', () => {
    assert.deepEqual(getSessionGuidance(null), DEFAULT_RUN_GUIDANCE)
    assert.deepEqual(getSessionGuidance({}), DEFAULT_RUN_GUIDANCE)
    assert.deepEqual(getSessionGuidance({ guidance: ALL_OFF }), ALL_OFF)
  })
})

describe('러닝 시작 시 스냅샷 (runStore)', () => {
  test('시작할 때 넘긴 설정이 세션에 고정된다', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    store.getState().startRun('gps', BASE, () => 's1', ALL_OFF)
    assert.deepEqual(store.getState().activeSession?.guidance, ALL_OFF)
  })

  test('넘긴 객체가 나중에 바뀌어도(설정 화면의 변경) 세션의 스냅샷은 그대로이다', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    const live = { ...ALL_OFF }
    store.getState().startRun('time', BASE, () => 's1', live)
    live.autoPause = true
    live.frequency = 'perKm'
    assert.deepEqual(store.getState().activeSession?.guidance, ALL_OFF)
  })

  test('일시정지·재개·종료를 거쳐도 스냅샷이 유지된다', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    store.getState().startRun('gps', BASE, () => 's1', ALL_OFF)
    store.getState().pauseRun(BASE + 1000)
    store.getState().resumeRun(BASE + 2000)
    store.getState().stopRun(BASE + 3000)
    assert.deepEqual(store.getState().activeSession?.guidance, ALL_OFF)
  })

  test('다음 러닝은 그때의 설정을 쓴다', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    store.getState().startRun('gps', BASE, () => 's1', ALL_OFF)
    store.getState().stopRun(BASE + 1000)
    store.getState().clearSession()
    store.getState().startRun('gps', BASE + 5000, () => 's2', DEFAULT_RUN_GUIDANCE)
    assert.deepEqual(store.getState().activeSession?.guidance, DEFAULT_RUN_GUIDANCE)
  })

  test('설정을 넘기지 않으면 스냅샷 필드 없이 시작하고 기본값으로 읽힌다(기존 호출과 같다)', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    store.getState().startRun('time', BASE, () => 's1')
    const active = store.getState().activeSession
    assert.equal(active !== null && 'guidance' in active, false)
    assert.deepEqual(getSessionGuidance(active), DEFAULT_RUN_GUIDANCE)
  })

  test('손상된 값을 넘겨도 세션은 시작하고 항목별 기본값이 된다', () => {
    const store = createRunStore(createRunStorage(memoryStorage()))
    store.getState().startRun('time', BASE, () => 's1', { beatGuide: 'no', voiceGuide: false } as unknown as RunGuidance)
    assert.deepEqual(store.getState().activeSession?.guidance, { ...DEFAULT_RUN_GUIDANCE, voiceGuide: false })
  })
})

describe('세션 저장·복원과 스냅샷', () => {
  test('컨트롤러로 시작하면 저장되고, 새로고침 뒤에도 같은 스냅샷으로 복원된다(일시정지 상태)', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('time', ALL_OFF)
    a.clock.now = BASE + 30_000
    a.controller.tick()
    a.persistence.stop()

    const b = boot(kv, BASE + 60_000)
    const restored = b.runs.getState().activeSession
    assert.equal(restored?.session.status, 'paused')
    assert.deepEqual(restored?.guidance, ALL_OFF)
  })

  test('복원된 뒤 안내 설정이 바뀌어도 복원된 세션은 시작 때의 값을 유지한다', () => {
    const settings = createGuidanceSettingsStore(null)
    settings.setState({ ...ALL_OFF })
    const kv = memoryStorage()
    const a = boot(kv)
    const { beatGuide, voiceGuide, frequency, autoPause } = settings.getState()
    a.controller.begin('gps', { beatGuide, voiceGuide, frequency, autoPause })
    a.persistence.stop()

    const b = boot(kv, BASE + 1000)
    settings.getState().setAutoPause(true)
    settings.getState().setFrequency('perKm')
    assert.equal(settings.getState().autoPause, true)
    assert.deepEqual(b.runs.getState().activeSession?.guidance, ALL_OFF)
  })

  test('복원 뒤 재개·종료해도 스냅샷이 남고 다시 저장된다', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('time', ALL_OFF)
    a.persistence.stop()
    const b = boot(kv, BASE + 1000)
    b.controller.resume()
    b.controller.stop('user')
    b.persistence.stop()
    const c = boot(kv, BASE + 2000)
    assert.deepEqual(c.runs.getState().activeSession?.guidance, ALL_OFF)
  })

  test('스냅샷이 없는 이전 저장 세션도 그대로 복원된다(기본값으로 읽는다)', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('time') // 설정 없이 시작: 필드 없음
    a.persistence.stop()
    const stored = JSON.parse(kv.map.get(RUN_SESSION_KEYS.session) ?? 'null')
    assert.equal('guidance' in stored.data.snapshot, false)

    const b = boot(kv, BASE + 1000)
    const restored = b.runs.getState().activeSession
    assert.notEqual(restored, null)
    assert.deepEqual(getSessionGuidance(restored), DEFAULT_RUN_GUIDANCE)
  })

  test('저장된 스냅샷이 손상돼도 세션은 복원되고 스냅샷은 항목별 기본값이 된다', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('time', ALL_OFF)
    a.persistence.stop()
    const stored = JSON.parse(kv.map.get(RUN_SESSION_KEYS.session) ?? 'null')
    stored.data.snapshot.guidance = { beatGuide: 'broken', frequency: 99, voiceGuide: false, autoPause: null, extra: 1 }
    kv.map.set(RUN_SESSION_KEYS.session, JSON.stringify(stored))

    const b = boot(kv, BASE + 1000)
    const restored = b.runs.getState().activeSession
    assert.notEqual(restored, null)
    assert.deepEqual(restored?.guidance, { ...DEFAULT_RUN_GUIDANCE, voiceGuide: false })
  })

  test('스냅샷이 문자열 같은 엉뚱한 값이어도 세션은 복원된다', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('time', ALL_OFF)
    a.persistence.stop()
    const stored = JSON.parse(kv.map.get(RUN_SESSION_KEYS.session) ?? 'null')
    stored.data.snapshot.guidance = 'oops'
    kv.map.set(RUN_SESSION_KEYS.session, JSON.stringify(stored))
    const b = boot(kv, BASE + 1000)
    assert.deepEqual(b.runs.getState().activeSession?.guidance, DEFAULT_RUN_GUIDANCE)
  })
})

describe('자동 일시정지 복원', () => {
  test('자동 일시정지된 세션은 새로고침 뒤에도 일시정지(자동 표시 유지)로 복원되고 자동 재개되지 않는다', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('gps', DEFAULT_RUN_GUIDANCE)
    a.clock.now = BASE + 5000
    a.runs.getState().autoPauseRun(a.clock.now)
    assert.equal(a.runs.getState().activeSession?.autoPaused, true)
    a.persistence.stop()

    const b = boot(kv, BASE + 60_000)
    const restored = b.runs.getState().activeSession
    assert.equal(restored?.session.status, 'paused')
    assert.equal(restored?.autoPaused, true)
    assert.equal(restored?.session.pauses.length, 1)
    b.controller.resume()
    assert.equal(b.runs.getState().activeSession?.session.status, 'running')
    assert.equal(b.runs.getState().activeSession?.autoPaused, undefined)
  })

  test('진행 중에 새로고침하면 수동 복원 일시정지(자동 표시 없음)이고, 자동 표시 필드가 손상되면 버린다', () => {
    const kv = memoryStorage()
    const a = boot(kv)
    a.controller.begin('gps', DEFAULT_RUN_GUIDANCE)
    a.clock.now = BASE + 3000
    a.runs.getState().recordDistanceSample(1000, 5)
    a.persistence.stop()
    const raw = JSON.parse(kv.getItem(RUN_SESSION_KEYS.session) as string)
    raw.data.snapshot.autoPaused = 'yes'
    kv.setItem(RUN_SESSION_KEYS.session, JSON.stringify(raw))
    const b = boot(kv, BASE + 9000)
    assert.equal(b.runs.getState().activeSession?.session.status, 'paused')
    assert.equal(b.runs.getState().activeSession?.autoPaused, undefined)
  })
})
