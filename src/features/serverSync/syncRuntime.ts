import { toRunCreateRequest, fromRunDetail, parseRunList } from './runMapper.ts'
import { createRunSyncQueue } from './runSyncQueue.ts'
import type { QueueStorage, RunCreator, RunSyncQueue } from './runSyncQueue.ts'
import { toGuidancePayload } from './guidanceMapper.ts'
import { toProfileUpdateRequest } from './profileMapper.ts'
import type { LocalProfileSnapshot } from './profileMapper.ts'
import { fromUserProfileResponse } from './profileMapper.ts'
import { detailToRunRecord, fillEmptyProfile, IMPORT_LEDGER_KEY, parseLedger, planImport, serializeLedger } from './recordImport.ts'
import type { ProfileFields } from './recordImport.ts'
import type {
  BaselineUpsertRequest,
  GuidanceSettingsPayload,
  RunDetailResponse,
  RunReflectionPayload,
  UserProfileResponse,
  UserProfileUpdateRequest,
} from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'

// 화면 코드를 바꾸지 않고 기존 Store를 구독해 서버와 주고받는 연결(주입형이라 테스트 가능).
// 원칙
// - 서버가 꺼져 있거나(api=null) 로그인하지 않았으면 아무것도 주고받지 않고 기존 로컬 흐름만 쓴다.
// - 로컬 → 서버: 보내지 못한 것은 "대기 작업"으로 저장해 두었다가 앱 시작·로그인·온라인 복구 때 다시 보낸다(서버 오류가 로컬 데이터에 영향을 주지 않는다).
// - 서버 → 로컬: 로컬에 없는 기록 가져오기, 로컬의 빈 프로필 칸 채우기만 한다. 로컬 값을 덮어쓰지 않는다(recordImport.ts의 정책).
// - 실패해도 사용자 흐름을 막거나 예외를 던지지 않는다.

export interface SyncApi extends RunCreator {
  readonly runs: {
    create(body: Parameters<RunCreator['runs']['create']>[0]): Promise<unknown>
    list(range?: { from?: string; to?: string }): Promise<unknown>
    get(runId: string): Promise<RunDetailResponse>
    updateReflection(runId: string, body: RunReflectionPayload): Promise<unknown>
  }
  readonly users: {
    getMe(): Promise<UserProfileResponse>
    updateMe(body: UserProfileUpdateRequest): Promise<unknown>
    putBaseline(body: BaselineUpsertRequest): Promise<unknown>
    updateGuidance(body: GuidanceSettingsPayload): Promise<unknown>
  }
}

export const SYNC_PENDING_KEY = 'pacebeat:sync:pending:v1'

interface PendingOps {
  profile: boolean
  baseline: BaselineUpsertRequest | null
  voiceGuide: boolean | null
  reflections: Record<string, RunReflectionPayload>
}

const EMPTY_PENDING: PendingOps = { profile: false, baseline: null, voiceGuide: null, reflections: {} }

export interface SyncDeps {
  readonly getApi: () => SyncApi | null
  readonly isSignedIn: () => boolean
  readonly queueStorage: (QueueStorage & { removeItem?(key: string): void }) | null
  readonly now?: () => number
  // 로컬 접근(읽기 + 새 기록 추가 + 빈 프로필 채우기). 없으면 해당 기능은 동작하지 않는다.
  readonly getLocalProfile?: () => LocalProfileSnapshot
  readonly applyProfilePatch?: (patch: Partial<ProfileFields>) => void
  readonly loadLocalRecords?: () => readonly RunRecord[]
  readonly saveLocalRecord?: (record: RunRecord) => void
  readonly onRunsChanged?: () => void
}

export function createSyncRuntime(deps: SyncDeps) {
  const queue: RunSyncQueue = createRunSyncQueue({
    storage: deps.queueStorage,
    getApi: () => (deps.isSignedIn() ? deps.getApi() : null),
    now: deps.now,
  })

  function readPending(): PendingOps {
    try {
      const raw = deps.queueStorage?.getItem(SYNC_PENDING_KEY) ?? null
      if (raw === null) return { ...EMPTY_PENDING, reflections: {} }
      const j = JSON.parse(raw) as Partial<PendingOps>
      return {
        profile: j.profile === true,
        baseline: typeof j.baseline === 'object' && j.baseline !== null ? j.baseline : null,
        voiceGuide: typeof j.voiceGuide === 'boolean' ? j.voiceGuide : null,
        reflections: typeof j.reflections === 'object' && j.reflections !== null ? j.reflections : {},
      }
    } catch {
      return { ...EMPTY_PENDING, reflections: {} }
    }
  }
  function writePending(p: PendingOps): void {
    try {
      deps.queueStorage?.setItem(SYNC_PENDING_KEY, JSON.stringify(p))
    } catch {
      // 저장 실패는 무시한다(이번 실행 동안만 메모리 없이 동작). 로컬 데이터에는 영향 없다.
    }
  }
  const mutatePending = (fn: (p: PendingOps) => void) => {
    const p = readPending()
    fn(p)
    writePending(p)
  }

  async function safe(task: () => Promise<unknown>): Promise<boolean> {
    try {
      await task()
      return true
    } catch {
      return false
    }
  }
  const ready = (): SyncApi | null => (deps.isSignedIn() ? deps.getApi() : null)

  async function fetchRunList(api: SyncApi): Promise<ReturnType<typeof parseRunList>> {
    try {
      return parseRunList(await api.runs.list())
    } catch {
      return null
    }
  }

  async function sendProfile(): Promise<void> {
    const api = ready()
    if (api === null || deps.getLocalProfile === undefined) return
    if (await safe(() => api.users.updateMe(toProfileUpdateRequest(deps.getLocalProfile!())))) mutatePending((p) => void (p.profile = false))
  }
  async function sendBaseline(): Promise<void> {
    const api = ready()
    const req = readPending().baseline
    if (api === null || req === null) return
    if (await safe(() => api.users.putBaseline(req))) mutatePending((p) => void (p.baseline = null))
  }
  async function sendVoice(): Promise<void> {
    const api = ready()
    const v = readPending().voiceGuide
    if (api === null || v === null) return
    if (await safe(() => api.users.updateGuidance(toGuidancePayload({ voiceGuide: v })))) mutatePending((p) => void (p.voiceGuide = null))
  }
  async function sendReflections(): Promise<void> {
    const api = ready()
    const entries = Object.entries(readPending().reflections)
    if (api === null || entries.length === 0) return
    const list = await fetchRunList(api)
    if (list === null) return // 목록 형식을 확인할 수 없으면 보내지 않는다(대기 유지)
    for (const [sessionId, payload] of entries) {
      const run = list.find((r) => r.clientSessionId === sessionId)
      if (run === undefined) continue // 서버에 아직 없다(대기열에서 전송 중이거나 거절됨): 대기 유지
      if (await safe(() => api.runs.updateReflection(run.runId, payload))) mutatePending((p) => void delete p.reflections[sessionId])
    }
  }

  // 서버에만 있는 기록을 로컬로 가져온다(정책: recordImport.ts). 한 건이 실패해도 나머지는 계속하고, 로컬은 건드리지 않는다.
  async function pullRuns(): Promise<number> {
    const api = ready()
    if (api === null || deps.loadLocalRecords === undefined || deps.saveLocalRecord === undefined) return 0
    const list = await fetchRunList(api)
    if (list === null) return 0
    const ledger = parseLedger(deps.queueStorage?.getItem(IMPORT_LEDGER_KEY) ?? null)
    const local = new Set(deps.loadLocalRecords().map((r) => r.sessionId))
    const targets = planImport(list, local, ledger)
    let imported = 0
    for (const target of targets) {
      let detail: RunDetailResponse
      try {
        detail = await api.runs.get(target.runId)
      } catch {
        continue // 다음 기회에 다시 시도(장부에 넣지 않는다)
      }
      const record = detailToRunRecord(fromRunDetail(detail))
      if (record !== null) {
        // 가져오는 사이 같은 기록이 로컬에 생겼으면 로컬을 우선한다.
        if (deps.loadLocalRecords().some((r) => r.sessionId === record.sessionId)) {
          ledger.add(target.clientSessionId)
          continue
        }
        try {
          deps.saveLocalRecord(record)
          imported += 1
        } catch {
          continue // 저장 실패: 장부에 넣지 않고 다음에 다시
        }
      }
      ledger.add(target.clientSessionId) // 가져왔거나 형식이 맞지 않아 건너뛴 기록: 다시 가져오지 않는다
    }
    // 이미 로컬에 있는 서버 기록도 "본 것"으로 남겨, 나중에 로컬에서 지워도 되살아나지 않게 한다.
    for (const run of list) if (local.has(run.clientSessionId)) ledger.add(run.clientSessionId)
    try {
      deps.queueStorage?.setItem(IMPORT_LEDGER_KEY, serializeLedger(ledger))
    } catch {
      // 장부를 못 쓰면 다음에 다시 판단한다.
    }
    if (imported > 0) deps.onRunsChanged?.()
    return imported
  }

  // 서버 프로필로 로컬의 비어 있는 칸만 채운다(완료·동의·온보딩 상태와 이미 있는 값은 건드리지 않는다).
  async function pullProfile(): Promise<void> {
    const api = ready()
    if (api === null || deps.getLocalProfile === undefined || deps.applyProfilePatch === undefined) return
    try {
      const remote = fromUserProfileResponse(await api.users.getMe())
      const patch = fillEmptyProfile(deps.getLocalProfile().profile, remote.profile)
      if (Object.keys(patch).length > 0) deps.applyProfilePatch(patch)
    } catch {
      // 다음 기회에 다시
    }
  }

  return {
    queue,
    // 러닝 기록을 서버 저장 대기열에 넣고 보낸다. client_session_id는 로컬 sessionId를 그대로 쓴다(서버가 (user, client_session_id)로 upsert).
    async syncRun(record: RunRecord): Promise<void> {
      const request = toRunCreateRequest(record, record.sessionId)
      if (request === null) return
      queue.enqueue(request) // 이미 있으면 무시(중복 등록 없음)
      await safe(() => queue.flush())
    },
    // 앱 시작·로그인·온라인 복구 때: 대기 작업을 먼저 보내고, 그다음 서버 데이터를 가져온다(로컬 변경이 서버 값에 밀리지 않게).
    async resume(): Promise<void> {
      if (!deps.isSignedIn()) return
      queue.resumeAfterAuth()
      await safe(() => queue.flush())
      if (readPending().profile) await sendProfile()
      await sendBaseline()
      await sendVoice()
      await sendReflections()
      await pullProfile()
      await pullRuns()
    },
    // 프로필을 보낸다(실패하면 대기 작업으로 남아 다음에 다시 보낸다).
    async syncProfile(): Promise<void> {
      mutatePending((p) => void (p.profile = true))
      await sendProfile()
    },
    async syncVoiceGuidance(settings: { readonly voiceGuide: boolean }): Promise<void> {
      mutatePending((p) => void (p.voiceGuide = settings.voiceGuide))
      await sendVoice()
    },
    async syncBaseline(request: BaselineUpsertRequest): Promise<void> {
      mutatePending((p) => void (p.baseline = request))
      await sendBaseline()
    },
    // 기록 상세에서 고친 회고를 서버에도 반영한다. 아직 서버에 가지 못한 기록이면 대기열의 요청에 최신 회고를 싣는다.
    async syncReflection(sessionId: string, payload: RunReflectionPayload): Promise<void> {
      if (queue.updateReflection(sessionId, payload)) {
        await safe(() => queue.flush())
        return
      }
      mutatePending((p) => void (p.reflections[sessionId] = payload))
      await sendReflections()
    },
    pullRuns,
    pullProfile,
    pendingSummary: () => {
      const p = readPending()
      return { profile: p.profile, baseline: p.baseline !== null, voiceGuide: p.voiceGuide !== null, reflections: Object.keys(p.reflections).length }
    },
  }
}
