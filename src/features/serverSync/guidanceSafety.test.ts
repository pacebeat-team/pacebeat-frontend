import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError, NetworkError } from '../../lib/api/errors.ts'
import type { FullGuidancePayload, UserProfileResponse } from '../../lib/api/types.ts'
import { check, wire } from '../../testing/contractSchema.ts'
import { blankServerProfile } from '../../testing/testServerProfile.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import type { SyncApi } from './syncRuntime.ts'

// Guidance 전송 안전성(검토 항목 1~7). 가짜 API·저장소만 쓰며 서버에는 요청하지 않는다. 실서버 검증이 아니다.
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
function mem() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}
const SERVER: FullGuidancePayload = { voice_guidance_enabled: true, vibration_guidance_enabled: false, guidance_frequency_km: 2.5, vibration_intensity: 'high' }
const consent = { ageOver14: true, termsOfService: true, privacyPolicy: true, locationTerms: true, marketing: false, policyVersion: null, consentedAt: 1 }

function world(storage = mem()) {
  const auth = { userId: 'A' as string | null, epoch: 1 }
  const sent: Array<{ as: string | null; body: FullGuidancePayload }> = []
  const ctl = {
    server: SERVER as unknown,
    getGate: null as null | ReturnType<typeof deferred<void>>,
    patchGate: null as null | ReturnType<typeof deferred<void>>,
    getError: null as null | Error,
    getCount: 0,
  }
  const api: SyncApi = {
    runs: { create: async () => ({}), list: async () => [], get: async () => { throw new ApiError(404, 'NOT_FOUND', 'x') }, updateReflection: async () => undefined },
    users: {
      getMe: async () => {
        ctl.getCount += 1
        const snapshot = ctl.server // 요청 시점의 서버 값(응답은 늦게 도착할 수 있다)
        if (ctl.getGate) await ctl.getGate.promise
        if (ctl.getError) throw ctl.getError
        return { ...blankServerProfile(), guidance: snapshot } as unknown as UserProfileResponse
      },
      updateMe: async () => undefined,
      putBaseline: async () => undefined,
      updateGuidance: async (b) => {
        if (ctl.patchGate) await ctl.patchGate.promise
        sent.push({ as: auth.userId, body: wire(b) })
        ctl.server = wire(b) // 서버는 전체 교체
      },
    },
  }
  const rt = createSyncRuntime({
    getApi: () => api, isSignedIn: () => auth.userId !== null, getUserId: () => auth.userId, getAuthEpoch: () => auth.epoch,
    queueStorage: storage, now: () => 1_000_000,
    getLocalProfile: () => ({ profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null }, consent, completedAt: 1, experienceLevel: null, weeklyRuns: null }),
    applyProfilePatch: () => undefined, loadLocalRecords: () => [], saveLocalRecord: () => undefined,
  })
  const switchTo = (uid: string | null) => { auth.userId = uid; auth.epoch += 1 }
  return { rt, auth, sent, ctl, switchTo, storage }
}

describe('Guidance: 서버 응답이 유효하지 않으면 보내지 않는다', () => {
  const cases: Array<[string, unknown]> = [
    ['필드 누락(진동 강도)', { voice_guidance_enabled: true, vibration_guidance_enabled: false, guidance_frequency_km: 2.5 }],
    ['필드 누락(음성)', { vibration_guidance_enabled: false, guidance_frequency_km: 2.5, vibration_intensity: 'high' }],
    ['null 필드', { ...SERVER, guidance_frequency_km: null }],
    ['잘못된 타입(불리언)', { ...SERVER, vibration_guidance_enabled: 'false' }],
    ['잘못된 타입(숫자)', { ...SERVER, guidance_frequency_km: '2.5' }],
    ['계약 밖 값(빈도)', { ...SERVER, guidance_frequency_km: 99 }],
    ['계약 밖 값(강도)', { ...SERVER, vibration_intensity: 'extreme' }],
    ['안내 설정이 아예 없음', undefined],
    ['객체가 아님', 'x'],
  ]
  for (const [name, server] of cases) {
    test(`${name}: PATCH 없이 대기를 유지하고, 서버 값이 정상으로 돌아오면 그때 보낸다`, async () => {
      const w = world()
      w.ctl.server = server
      await w.rt.syncVoiceGuidance({ voiceGuide: false })
      assert.equal(w.sent.length, 0)
      assert.equal(w.ctl.getCount, 1) // 재시도 루프 없음
      assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
      w.ctl.server = SERVER
      await w.rt.resume()
      assert.deepEqual(w.sent.map((s) => s.body), [{ ...SERVER, voice_guidance_enabled: false }])
      assert.equal(w.rt.pendingSummary('u:A').voiceGuide, false)
    })
  }
  test('조회 실패(401/403/404/422/5xx/네트워크)면 PATCH 없이 대기를 유지한다', async () => {
    for (const err of [new ApiError(401, 'X', 'x'), new ApiError(403, 'X', 'x'), new ApiError(404, 'X', 'x'), new ApiError(422, 'X', 'x'), new ApiError(503, 'X', 'x'), new NetworkError('x')]) {
      const w = world()
      w.ctl.getError = err
      await w.rt.syncVoiceGuidance({ voiceGuide: false })
      assert.equal(w.sent.length, 0)
      assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
    }
  })
  test('전송 본문은 항상 OpenAPI 4개 필드를 모두 가진다', async () => {
    const w = world()
    await w.rt.syncVoiceGuidance({ voiceGuide: false })
    assert.deepEqual(check('GuidanceSettingsPayload', w.sent[0].body), [])
    assert.deepEqual(Object.keys(w.sent[0].body).sort(), ['guidance_frequency_km', 'vibration_guidance_enabled', 'vibration_intensity', 'voice_guidance_enabled'])
  })
})

describe('Guidance: 동시 변경과 최신 값', () => {
  test('조회 응답을 기다리는 동안 로컬 설정이 다시 바뀌면 보내기 직전의 최신 값이 서버의 최종 값이 된다', async () => {
    const w = world()
    w.ctl.getGate = deferred()
    const first = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    const second = w.rt.syncVoiceGuidance({ voiceGuide: true }) // 조회 중 다시 변경
    w.ctl.getGate.resolve()
    await Promise.all([first, second])
    await tick()
    assert.equal((w.ctl.server as FullGuidancePayload).voice_guidance_enabled, true)
    assert.equal(w.sent.at(-1)?.body.voice_guidance_enabled, true)
    assert.ok(w.sent.every((s) => s.body.voice_guidance_enabled === true)) // 오래된 값(false)이 서버로 나가지 않았다
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, false)
  })
  test('전송(PATCH) 중에 다시 바뀌면 첫 응답이 대기를 지우지 않고 마지막 값이 다시 전송된다', async () => {
    const w = world()
    w.ctl.patchGate = deferred()
    const first = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    await tick()
    const second = w.rt.syncVoiceGuidance({ voiceGuide: true })
    w.ctl.patchGate.resolve()
    await Promise.all([first, second])
    await tick()
    assert.equal((w.ctl.server as FullGuidancePayload).voice_guidance_enabled, true)
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, false)
  })
  test('같은 값을 연달아 요청해도 서버의 다른 3개 설정은 유지된다', async () => {
    const w = world()
    await Promise.all([1, 2, 3, 4].map(() => w.rt.syncVoiceGuidance({ voiceGuide: false })))
    await tick()
    assert.deepEqual(w.ctl.server, { ...SERVER, voice_guidance_enabled: false })
  })
  test('(알려진 한계·실서버 미검증) GET과 PATCH 사이에 다른 기기가 설정을 바꾸면 그 변경은 덮인다 — 서버에 버전 검사·부분 갱신이 없어 프론트만으로는 막을 수 없다', async () => {
    const w = world()
    w.ctl.patchGate = deferred() // GET은 끝났고 PATCH가 나가기 직전
    const p = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    await tick()
    w.ctl.server = { ...SERVER, vibration_intensity: 'low' } // 그 사이 다른 기기가 강도를 바꿈
    w.ctl.patchGate.resolve()
    await p
    assert.equal((w.ctl.server as FullGuidancePayload).vibration_intensity, 'high') // 다른 기기의 'low'가 유실된다
  })
})

describe('Guidance: 계정 변경·로그아웃·인증 세대', () => {
  test('조회 중 로그아웃하면 PATCH하지 않고 그 계정의 대기를 보존한다', async () => {
    const w = world()
    w.ctl.getGate = deferred()
    const p = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    w.switchTo(null)
    w.ctl.getGate.resolve()
    await p
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
  })
  test('조회 중 A→B로 바뀌면 A의 설정이 B 이름으로 나가지 않고, B에는 대기가 생기지 않는다', async () => {
    const w = world()
    w.ctl.getGate = deferred()
    const p = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    w.switchTo('B')
    w.ctl.getGate.resolve()
    await p
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
    assert.equal(w.rt.pendingSummary('u:B').voiceGuide, false)
  })
  test('A→B→A로 같은 계정에 돌아와도 이전 세대의 조회 결과로는 보내지 않고, 새 세대에서 다시 읽어 보낸다', async () => {
    const w = world()
    w.ctl.getGate = deferred()
    const p = w.rt.syncVoiceGuidance({ voiceGuide: false })
    await tick()
    w.switchTo('B')
    w.switchTo('A')
    w.ctl.getGate.resolve()
    await p
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
    w.ctl.getGate = null
    await w.rt.resume()
    assert.deepEqual(w.sent.map((s) => [s.as, s.body.voice_guidance_enabled]), [['A', false]])
  })
  test('B가 로그인해 있는 동안 A의 대기는 B로 전송되지 않는다', async () => {
    const w = world()
    w.ctl.getError = new NetworkError('x')
    await w.rt.syncVoiceGuidance({ voiceGuide: false }) // A 대기 보존
    w.ctl.getError = null
    w.switchTo('B')
    await w.rt.resume()
    assert.equal(w.sent.length, 0)
    assert.equal(w.rt.pendingSummary('u:A').voiceGuide, true)
  })
})
