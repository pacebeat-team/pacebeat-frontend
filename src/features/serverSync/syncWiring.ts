import { getOwnerBoundApi } from '../../lib/api/index.ts'
import { auth } from '../../lib/auth/index.ts'
import { getMetrics } from '../measurement/metrics.ts'
import { measurementStore } from '../../stores/measurementStore.ts'
import { useOnboardingStore } from '../../stores/onboardingStore.ts'
import { guidanceSettingsStore } from '../my/guidanceSettingsStore.ts'
import { profileStore } from '../profile/profileStore.ts'
import { runResultStore } from '../running/runResultStore.ts'
import { createRunStorage } from '../running/runStorage.ts'
import { deriveRecordId } from '../running/record.ts'
import { baselineRequestFromMetrics } from './baselineMapper.ts'
import { clearedProfileFields } from './profileMapper.ts'
import { toReflectionPayload } from './runMapper.ts'
import { createSyncRuntime } from './syncRuntime.ts'
import { notifyRunsChanged, REFLECTION_SAVED_EVENT } from '../records/recordsEvents.ts'
import type { RunReflection } from '../running/types.ts'

// 앱 시작 때 한 번 연결한다(main.tsx가 App보다 먼저 불러온다). api가 null이거나 로그인하지 않았으면 아무 일도 하지 않는다.
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const boundApis = new Map<string, ReturnType<typeof getOwnerBoundApi>>()
function boundApi(userId: string) {
  if (!boundApis.has(userId)) boundApis.set(userId, getOwnerBoundApi(userId))
  return boundApis.get(userId) ?? null
}
// 로그인·로그아웃·계정 변경이 있을 때마다 올라간다(같은 계정으로 돌아와도 이전 요청의 결과를 버리기 위해).
let authEpoch = 0
auth.onAuthStateChange(() => {
  authEpoch += 1
})

export const syncRuntime = createSyncRuntime({
  // 요청을 만든 계정에 묶인 API(토큰을 받는 시점에 계정이 바뀌면 요청을 보내지 않는다). 계정마다 하나씩 만들어 재사용한다.
  getApi: (userId) => (userId === null ? null : boundApi(userId)),
  getAuthEpoch: () => authEpoch,
  isSignedIn: () => auth.getState().status === 'signedIn',
  getUserId: () => auth.getState().userId,
  queueStorage: browserStorage(),
  getLocalProfile: () => {
    const p = profileStore.getState()
    const o = useOnboardingStore.getState()
    return { profile: p.profile, consent: p.consent, completedAt: p.completedAt, experienceLevel: o.experienceLevel, weeklyRuns: o.weeklyRuns }
  },
  applyProfilePatch: (patch) => profileStore.getState().setProfile(patch),
  loadLocalRecords: () => createRunStorage().loadRecords(),
  saveLocalRecord: (record) => createRunStorage().saveRecord(record),
  // 로컬에서 지운 기록은 서버로 보내지 않는다. 저장소를 읽을 수 없으면 판단하지 않고 보존한다.
  localRecordState: (sessionId) => {
    const read = createRunStorage().readRecords()
    if (!read.ok) return 'unknown'
    return read.records.some((r) => r.sessionId === sessionId) ? 'present' : 'absent'
  },
  onRunsChanged: notifyRunsChanged,
})

const stops: Array<() => void> = []

// 러닝 기록: 결과 저장이 성공하는 순간(saved: false→true) 로컬 기록을 읽어 대기열에 넣는다(로컬 저장은 이미 끝난 상태).
let wasSaved = runResultStore.getState().saved
stops.push(
  runResultStore.subscribe((state) => {
    if (state.saved && !wasSaved && state.sessionId !== null) {
      const record = createRunStorage().getRecord(deriveRecordId(state.sessionId))
      if (record !== null) void syncRuntime.syncRun(record)
    }
    wasSaved = state.saved
  }),
)

// 프로필: 가입 완료 시각이 처음 기록될 때, 그리고 완료한 뒤 프로필을 고칠 때마다(1.5초 모아서) 보낸다. 입력하지 않은 값은 보내지 않고, 사용자가 지운 값만 null로 보낸다.
// 실패하면 대기 작업으로 남아 앱 시작·로그인·온라인 복구 때 다시 보낸다.
let wasProfileDone = profileStore.getState().completedAt !== null
let lastProfile = profileStore.getState().profile
let lastProfileJson = JSON.stringify(lastProfile)
let profileTimer: ReturnType<typeof setTimeout> | null = null
stops.push(
  profileStore.subscribe((state) => {
    const done = state.completedAt !== null
    const json = JSON.stringify(state.profile)
    const changed = json !== lastProfileJson
    const justCompleted = done && !wasProfileDone
    wasProfileDone = done
    const before = lastProfile
    lastProfile = state.profile
    lastProfileJson = json
    if (!done || (!justCompleted && !changed)) return
    // 있던 값을 사용자가 직접 지운 필드만 "지우기"로 보낸다(미입력은 서버 값을 유지하도록 보내지 않는다).
    syncRuntime.markProfileDirty(clearedProfileFields(before, state.profile)) // 디바운스 중 앱이 닫혀도 유실되지 않게 즉시 대기 표시를 남긴다
    if (profileTimer !== null) clearTimeout(profileTimer)
    profileTimer = setTimeout(() => void syncRuntime.syncProfile(), justCompleted ? 0 : 1500)
  }),
)
stops.push(() => {
  if (profileTimer !== null) clearTimeout(profileTimer)
})

// 기록 상세에서 회고를 고쳤을 때: 서버에도 반영한다(아직 서버에 없으면 대기열의 요청에 최신 회고를 싣는다).
const onReflectionSaved = (event: Event) => {
  const detail = (event as CustomEvent<{ sessionId: string; reflection: RunReflection | null }>).detail
  const payload = detail.reflection === null ? { difficulty: null, reasons: [], memo: '' } : toReflectionPayload(detail.reflection)
  void syncRuntime.syncReflection(detail.sessionId, payload)
}
if (typeof window !== 'undefined') {
  window.addEventListener(REFLECTION_SAVED_EVENT, onReflectionSaved)
  stops.push(() => window.removeEventListener(REFLECTION_SAVED_EVENT, onReflectionSaved))
}

// 기초 측정: 완료 표시가 처음 true가 될 때 측정값으로 보낸다(기준 페이스는 기존 computeBaselinePace).
let wasBaselineDone = useOnboardingStore.getState().baselineMeasurementCompleted
stops.push(
  useOnboardingStore.subscribe((state) => {
    if (state.baselineMeasurementCompleted && !wasBaselineDone) {
      const { metrics, session, now } = measurementStore.getState()
      // 종료된 실제 측정만 보낸다. 세션이 없으면 보내지 않는다(0·가짜 값 금지).
      if (session !== null) void syncRuntime.syncBaseline(baselineRequestFromMetrics(getMetrics(metrics, session, now), session.endedAt))
    }
    wasBaselineDone = state.baselineMeasurementCompleted
  }),
)

// 안내 설정: 음성 안내가 바뀔 때만 보낸다(다른 안내 설정은 서버 필드가 없어 보내지 않는다).
let lastVoice = guidanceSettingsStore.getState().voiceGuide
stops.push(
  guidanceSettingsStore.subscribe((state) => {
    if (state.voiceGuide !== lastVoice) void syncRuntime.syncVoiceGuidance({ voiceGuide: state.voiceGuide })
    lastVoice = state.voiceGuide
  }),
)

// 앱 시작·로그인·온라인 복구 때 대기열을 이어서 보낸다.
stops.push(
  auth.onAuthStateChange((state) => {
    if (state.status === 'signedIn') void syncRuntime.resume()
  }),
)
if (typeof window !== 'undefined') {
  const onOnline = () => void syncRuntime.resume()
  window.addEventListener('online', onOnline)
  stops.push(() => window.removeEventListener('online', onOnline))
}
void syncRuntime.resume()

if (import.meta.hot) {
  import.meta.hot.dispose(() => stops.forEach((stop) => stop()))
}
