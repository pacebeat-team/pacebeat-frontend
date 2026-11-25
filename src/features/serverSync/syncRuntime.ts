import { fromBaselineResponse } from './baselineMapper.ts'
import type { RemoteBaselineView } from './baselineMapper.ts'
import { findRunRequestViolations, fromRunDetail, LOCAL_INVALID_CODE, parseRunList, toRunCreateRequest } from './runMapper.ts'
import { createRunSyncQueue, RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import type { QueueStorage, RunCreator, RunSyncQueue } from './runSyncQueue.ts'
import { toFullGuidancePayload } from './guidanceMapper.ts'
import type { LocalGuidanceSyncInput } from './guidanceMapper.ts'
import { fromUserProfileResponse, isClearableProfileField, sanitizeProfileRequest, toProfileUpdateRequest } from './profileMapper.ts'
import type { ClearableProfileField, LocalProfileSnapshot } from './profileMapper.ts'
import { detailToRunRecord, fillEmptyProfile, IMPORT_LEDGER_KEY, parseLedger, planImport, serializeLedger } from './recordImport.ts'
import type { ProfileFields } from './recordImport.ts'
import type {
  BaselineResponse,
  BaselineUpsertRequest,
  FullGuidancePayload,
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
    deleteAll?(): Promise<unknown>
    deleteBySession?(clientSessionId: string): Promise<unknown>
  }
  readonly users: {
    getMe(): Promise<UserProfileResponse>
    updateMe(body: UserProfileUpdateRequest): Promise<unknown>
    getBaseline?(): Promise<BaselineResponse>
    putBaseline(body: BaselineUpsertRequest): Promise<unknown>
    updateGuidance(body: FullGuidancePayload): Promise<unknown>
  }
}

export const SYNC_PENDING_KEY = 'pacebeat:sync:pending:v1'

interface PendingOps {
  profile: boolean
  // 프로필 변경 시점의 요청 내용(소유 계정이 보낼 때 다른 계정이 고친 값이 섞이지 않게 스냅샷으로 둔다)
  profileRequest: UserProfileUpdateRequest | null
  // 사용자가 직접 지운 필드(서버에 null로 보낼 수 있는 것은 이 목록의 필드뿐이다. 그 밖의 null은 보내지 않는다)
  profileClears: ClearableProfileField[]
  baseline: BaselineUpsertRequest | null
  voiceGuide: boolean | null
  guidanceExtra: Omit<LocalGuidanceSyncInput, 'voiceGuide'> | null
  reflections: Record<string, RunReflectionPayload>
}

const EMPTY_PENDING: PendingOps = { profile: false, profileRequest: null, profileClears: [], baseline: null, voiceGuide: null, guidanceExtra: null, reflections: {} }

export interface SyncDeps {
  // 요청을 만든 계정(userId)에 묶인 API를 돌려준다. 토큰을 받는 시점에 계정이 바뀌었으면 요청을 보내지 않는 API여야 한다(wiring이 보장). 단일 사용자 모드(getUserId 없음)에서는 null이 넘어온다.
  readonly getApi: (userId: string | null) => SyncApi | null
  readonly isSignedIn: () => boolean
  // 현재 로그인한 사용자 id(없으면 null). 요청 도중 로그아웃·계정 변경이 있었는지 확인하는 데 쓴다. 생략하면 로그인 여부만 본다.
  readonly getUserId?: () => string | null
  // 로그인·로그아웃·계정 변경이 있을 때마다 올라가는 번호. 같은 계정으로 A→B→A처럼 돌아와도 이전 요청의 결과를 버리기 위해 쓴다.
  readonly getAuthEpoch?: () => number
  readonly queueStorage: (QueueStorage & { removeItem?(key: string): void }) | null
  readonly now?: () => number
  // 로컬 접근(읽기 + 새 기록 추가 + 빈 프로필 채우기). 없으면 해당 기능은 동작하지 않는다.
  readonly getLocalProfile?: () => LocalProfileSnapshot
  readonly applyProfilePatch?: (patch: Partial<ProfileFields>) => void
  readonly applyRemoteBaseline?: (baseline: RemoteBaselineView) => void
  readonly applyRemoteGuidance?: (guidance: GuidanceSettingsPayload) => void
  readonly loadLocalRecords?: () => readonly RunRecord[]
  readonly saveLocalRecord?: (record: RunRecord) => void
  // 로컬 기록이 아직 있는지(present), 지워졌는지(absent), 저장소를 읽을 수 없어 알 수 없는지(unknown). 생략하면 확인하지 않고 항상 보낸다.
  readonly localRecordState?: (sessionId: string) => 'present' | 'absent' | 'unknown'
  readonly onRunsChanged?: () => void
}

// 계정별 격리(저장 구조)
// 대기열(RUN_SYNC_QUEUE_KEY)과 대기 작업(SYNC_PENDING_KEY)은 같은 키 안에 소유자별 버킷으로 저장한다: { version: 2, owners: { 'u:<userId>' | 'guest': ... }, legacy?: <v1 원본> }.
// - 소유자는 요청을 만든 시점의 로그인 사용자(`u:<userId>`)이고, 로그인하지 않았거나 계정을 확인할 수 없으면 'guest'다.
// - 전송은 현재 로그인한 계정의 버킷만 한다. 'guest' 버킷과 `legacy`(소유자 정보가 없던 v1 형식)는 어떤 계정으로도 전송하지 않고 그대로 보존한다(삭제·이전 없음).
// - getUserId를 주지 않으면(단일 사용자 가정, 테스트용) 로그인 여부만 보고 하나의 버킷('single')을 쓴다.
interface Container<T> {
  owners: Record<string, T>
  legacy: unknown
}

export function createSyncRuntime(deps: SyncDeps) {
  function readContainer<T>(key: string): Container<T> {
    let raw: string | null
    try {
      raw = deps.queueStorage?.getItem(key) ?? null
    } catch {
      return { owners: {}, legacy: undefined }
    }
    if (raw === null) return { owners: {}, legacy: undefined }
    try {
      const j: unknown = JSON.parse(raw)
      if (typeof j === 'object' && j !== null && (j as { version?: unknown }).version === 2 && typeof (j as { owners?: unknown }).owners === 'object' && (j as { owners?: unknown }).owners !== null)
        return { owners: { ...(j as { owners: Record<string, T> }).owners }, legacy: (j as { legacy?: unknown }).legacy }
      return { owners: {}, legacy: j } // 소유자 정보가 없는 기존(v1) 형식: 그대로 보존한다
    } catch {
      return { owners: {}, legacy: raw } // 읽을 수 없는 값도 지우지 않고 보존한다
    }
  }
  function writeContainer<T>(key: string, c: Container<T>): void {
    const body: { version: 2; owners: Record<string, T>; legacy?: unknown } = { version: 2, owners: c.owners }
    if (c.legacy !== undefined) body.legacy = c.legacy
    deps.queueStorage?.setItem(key, JSON.stringify(body))
  }

  // 현재 전송 권한이 있는 소유자(로그인했고 계정을 확인할 수 있을 때만). 없으면 null → 전송하지 않는다.
  const ownerKey = (): string | null => {
    if (!deps.isSignedIn()) return null
    if (deps.getUserId === undefined) return 'single'
    const uid = deps.getUserId()
    return uid === null || uid === '' ? null : `u:${uid}`
  }
  // 새 작업을 쌓을 소유자: 확인된 계정이 있으면 그 계정, 아니면 'guest'(어느 계정으로도 자동 전송되지 않는다).
  const writeOwner = (): string => ownerKey() ?? 'guest'
  const ownerUserId = (owner: string): string | null => (owner.startsWith('u:') ? owner.slice(2) : null)
  const ready = (owner: string): SyncApi | null => (ownerKey() === owner ? deps.getApi(ownerUserId(owner)) : null)
  const authEpoch = (): number => deps.getAuthEpoch?.() ?? 0
  // 요청을 시작할 때의 소유자·인증 세대와 지금이 같은가. 같은 userId로 돌아왔더라도(A→B→A) 세대가 다르면 이전 요청의 결과는 버린다.
  const isStale = (owner: string, epoch: number): boolean => ownerKey() !== owner || authEpoch() !== epoch

  // 소유자별 러닝 저장 대기열(엔진은 runSyncQueue 그대로, 저장소만 소유자 버킷으로 연결).
  const queues = new Map<string, RunSyncQueue>()
  function queueFor(owner: string): RunSyncQueue {
    let q = queues.get(owner)
    if (q === undefined) {
      const storage: QueueStorage | null =
        deps.queueStorage === null
          ? null
          : {
              getItem: () => {
                const bucket = readContainer<{ items?: unknown }>(RUN_SYNC_QUEUE_KEY).owners[owner]
                return bucket === undefined ? null : JSON.stringify({ version: 1, items: bucket.items })
              },
              setItem: (_key, value) => {
                const c = readContainer<{ items?: unknown }>(RUN_SYNC_QUEUE_KEY)
                c.owners[owner] = { items: (JSON.parse(value) as { items: unknown }).items }
                writeContainer(RUN_SYNC_QUEUE_KEY, c)
              },
            }
      q = createRunSyncQueue({
        storage,
        getApi: () => ready(owner),
        now: deps.now,
        check: (item) => {
          if (deps.localRecordState === undefined) return 'send'
          try {
            const state = deps.localRecordState(item.clientSessionId)
            return state === 'present' ? 'send' : state === 'absent' ? 'deleted' : 'hold'
          } catch {
            return 'hold' // 저장소 오류: 보내지도 지우지도 않고 보존한다
          }
        },
        markServerKnown: (id) => markLedger(id),
      })
      queues.set(owner, q)
    }
    return q
  }
  // 현재 소유자(없으면 guest)의 대기열을 가리키는 얇은 래퍼.
  const queue: RunSyncQueue = {
    enqueue: (r) => queueFor(writeOwner()).enqueue(r),
    enqueueRejected: (r, code) => queueFor(writeOwner()).enqueueRejected(r, code),
    list: () => queueFor(writeOwner()).list(),
    summary: () => queueFor(writeOwner()).summary(),
    flush: () => queueFor(writeOwner()).flush(),
    resumeAfterAuth: () => queueFor(writeOwner()).resumeAfterAuth(),
    remove: (id) => queueFor(writeOwner()).remove(id),
    updateReflection: (id, r) => queueFor(writeOwner()).updateReflection(id, r),
  }

  function readPending(owner: string): PendingOps {
    const j = readContainer<Partial<PendingOps>>(SYNC_PENDING_KEY).owners[owner]
    if (typeof j !== 'object' || j === null) return { ...EMPTY_PENDING, reflections: {} }
    return {
      profile: j.profile === true,
      profileRequest: typeof j.profileRequest === 'object' && j.profileRequest !== null ? j.profileRequest : null,
      profileClears: Array.isArray(j.profileClears) ? j.profileClears.filter(isClearableProfileField) : [],
      baseline: typeof j.baseline === 'object' && j.baseline !== null ? j.baseline : null,
      voiceGuide: typeof j.voiceGuide === 'boolean' ? j.voiceGuide : null,
      guidanceExtra: typeof j.guidanceExtra === 'object' && j.guidanceExtra !== null ? j.guidanceExtra : null,
      reflections: typeof j.reflections === 'object' && j.reflections !== null ? j.reflections : {},
    }
  }
  const mutatePending = (owner: string, fn: (p: PendingOps) => void) => {
    try {
      const c = readContainer<PendingOps>(SYNC_PENDING_KEY)
      const p = readPending(owner)
      fn(p)
      c.owners[owner] = p
      writeContainer(SYNC_PENDING_KEY, c) // 다른 소유자의 버킷과 legacy는 그대로 둔다
    } catch {
      // 저장 실패는 무시한다. 로컬 데이터에는 영향 없다.
    }
  }

  async function safe(task: () => Promise<unknown>): Promise<boolean> {
    try {
      await task()
      return true
    } catch {
      return false
    }
  }
  // 같은 작업이 진행 중일 때 다시 불리면 겹쳐 보내지 않고, 끝난 뒤 최신 값으로 한 번 더 실행한다(순서 뒤바뀜·최신 값 유실 방지).
  function serialized(task: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | null = null
    let again = false
    return () => {
      if (running !== null) {
        again = true
        return running
      }
      running = (async () => {
        do {
          again = false
          await task()
        } while (again)
      })().finally(() => {
        running = null
      })
      return running
    }
  }
  // 같은 계정·같은 인증 세대에서 동시에 여러 번 불려도 하나만 실행하고 결과를 공유한다(앱 시작·로그인·온라인 복구가 겹치는 경우).
  // 다른 계정(또는 다른 세대)의 작업이 진행 중이면 그것이 끝난 뒤 새로 실행한다(이전 계정의 진행 중 작업이 새 계정의 동기화를 가로채지 않게).
  function shared<T>(task: () => Promise<T>): () => Promise<T> {
    let running: { readonly key: string; readonly promise: Promise<T> } | null = null
    return async () => {
      const key = `${ownerKey() ?? ''}|${authEpoch()}`
      while (running !== null && running.key !== key) {
        try {
          await running.promise
        } catch {
          // 다른 컨텍스트의 실패는 여기서 중요하지 않다.
        }
      }
      if (running !== null) return running.promise
      const entry: { readonly key: string; readonly promise: Promise<T> } = {
        key,
        promise: task().finally(() => {
          if (running === entry) running = null
        }),
      }
      running = entry
      return entry.promise
    }
  }

  async function fetchRunList(api: SyncApi): Promise<ReturnType<typeof parseRunList>> {
    try {
      return parseRunList(await api.runs.list())
    } catch {
      return null
    }
  }

  const sendProfile = serialized(async () => {
    const owner = ownerKey()
    if (owner === null) return
    const api = ready(owner)
    const pending = readPending(owner)
    if (api === null || !pending.profile) return
    // 이 계정이 변경한 시점의 스냅샷을 보낸다(같은 기기에서 다른 계정이 고친 값이 섞이지 않는다).
    const clears = new Set(pending.profileClears)
    const raw = pending.profileRequest ?? (deps.getLocalProfile === undefined ? null : toProfileUpdateRequest(deps.getLocalProfile(), clears))
    if (raw === null) return
    // 지우기로 기록되지 않은 null은 보내지 않는다(서버 값을 지우지 않는다). 보낼 내용이 하나도 없으면 요청 없이 대기 표시만 푼다.
    const req = sanitizeProfileRequest(raw, clears)
    if (Object.keys(req).length === 0) {
      mutatePending(owner, (p) => void (JSON.stringify(p.profileRequest) === JSON.stringify(pending.profileRequest) && ((p.profile = false), (p.profileRequest = null), (p.profileClears = []))))
      return
    }
    // 보내는 동안 더 새로운 스냅샷이 쌓였다면 대기 표시를 지우지 않고 한 번 더 보낸다. 응답은 이 소유자의 버킷에만 반영한다.
    if (await safe(() => api.users.updateMe(req))) mutatePending(owner, (p) => void (JSON.stringify(p.profileRequest) === JSON.stringify(pending.profileRequest) && ((p.profile = false), (p.profileRequest = null), (p.profileClears = []))))
  })
  const sendBaseline = serialized(async () => {
    const owner = ownerKey()
    if (owner === null) return
    const api = ready(owner)
    const req = readPending(owner).baseline
    if (api === null || req === null) return
    // 보내는 동안 더 새로운 값으로 바뀌었다면 지우지 않는다.
    if (await safe(() => api.users.putBaseline(req))) mutatePending(owner, (p) => void (JSON.stringify(p.baseline) === JSON.stringify(req) && (p.baseline = null)))
  })
  const sendVoice = serialized(async () => {
    const owner = ownerKey()
    const epoch = authEpoch()
    if (owner === null) return
    const api = ready(owner)
    if (api === null || readPending(owner).voiceGuide === null) return
    // 서버가 4개 필드를 전부 교체하므로, 서버의 현재 값을 먼저 읽어 그 위에 음성 안내만 덮어 보낸다.
    // 현재 값을 읽지 못하거나 4개 필드가 모두 유효하지 않으면 보내지 않고 대기를 유지한다(나머지 설정을 기본값·추측값으로 덮지 않기 위해).
    // 알려진 한계: GET과 PATCH 사이에 다른 기기가 설정을 바꾸면 그 변경을 덮는다(서버에 버전 검사·부분 갱신이 없어 프론트만으로는 막을 수 없다).
    let current: unknown
    try {
      current = (await api.users.getMe()).guidance
    } catch {
      return
    }
    if (isStale(owner, epoch)) return // 응답을 기다리는 동안 로그아웃·계정 변경: 이전 계정의 설정을 새 계정으로 보내지 않는다
    // 조회하는 동안 로컬 설정이 다시 바뀌었을 수 있으므로 보내기 직전의 최신 값을 쓴다.
    const latestPending = readPending(owner)
    const v = latestPending.voiceGuide
    const extra = latestPending.guidanceExtra
    if (v === null) return
    const body = toFullGuidancePayload({ voiceGuide: v, ...(extra ?? {}) }, current)
    if (body === null) return
    if (await safe(() => api.users.updateGuidance(body))) {
      mutatePending(owner, (p) => {
        if (p.voiceGuide === v && JSON.stringify(p.guidanceExtra) === JSON.stringify(extra)) {
          p.voiceGuide = null
          p.guidanceExtra = null
        }
      })
    }
  })
  const sendReflections = serialized(async () => {
    const owner = ownerKey()
    const epoch = authEpoch()
    if (owner === null) return
    const api = ready(owner)
    const entries = Object.entries(readPending(owner).reflections)
    if (api === null || entries.length === 0) return
    const list = await fetchRunList(api)
    if (list === null || isStale(owner, epoch)) return // 목록 형식을 확인할 수 없으면 보내지 않는다(대기 유지)
    for (const [sessionId, payload] of entries) {
      const run = list.find((r) => r.clientSessionId === sessionId)
      if (run === undefined) continue // 서버에 아직 없다(대기열에서 전송 중이거나 거절됨): 대기 유지
      if (isStale(owner, epoch)) return // 목록을 받는 사이 계정이 바뀌었다: 다른 계정으로 보내지 않는다(대기 유지)
      if (await safe(() => api.runs.updateReflection(run.runId, payload)))
        mutatePending(owner, (p) => void (JSON.stringify(p.reflections[sessionId]) === JSON.stringify(payload) && delete p.reflections[sessionId])) // 보내는 동안 다시 고쳤다면 남긴다
    }
  })

  // 서버에만 있는 기록을 로컬로 가져온다(정책: recordImport.ts). 한 건이 실패해도 나머지는 계속하고, 로컬은 건드리지 않는다.
  const pullRuns = shared(async (): Promise<number> => {
    const owner = ownerKey()
    const epoch = authEpoch()
    if (owner === null) return 0
    const api = ready(owner)
    if (api === null || deps.loadLocalRecords === undefined || deps.saveLocalRecord === undefined) return 0
    const list = await fetchRunList(api)
    if (list === null || isStale(owner, epoch)) return 0
    const ledger = parseLedger(deps.queueStorage?.getItem(IMPORT_LEDGER_KEY) ?? null)
    for (const id of memoryLedger) ledger.add(id)
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
      if (isStale(owner, epoch)) return imported // 로그아웃·계정 변경: 이전 계정의 기록을 이 기기에 넣지 않는다
      const record = detail.client_session_id === target.clientSessionId ? detailToRunRecord(fromRunDetail(detail)) : null // 목록과 상세의 id가 다르면 건너뛴다
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
      saveLedger(ledger) // 한 건마다 남긴다(중간에 앱이 닫혀도 가져온 기록이 장부에서 빠지지 않게)
    }
    // 이미 로컬에 있는 서버 기록도 "본 것"으로 남겨, 나중에 로컬에서 지워도 되살아나지 않게 한다.
    for (const run of list) if (local.has(run.clientSessionId)) ledger.add(run.clientSessionId)
    saveLedger(ledger)
    if (imported > 0) deps.onRunsChanged?.()
    return imported
  })

  // 장부에 못 쓴 id는 이번 실행 동안 메모리에 둔다(저장소 오류로 장부 저장이 실패해도 같은 실행 안에서는 재유입을 막는다).
  const memoryLedger = new Set<string>()
  function markLedger(id: string): void {
    memoryLedger.add(id)
    let stored: Set<string>
    try {
      stored = parseLedger(deps.queueStorage?.getItem(IMPORT_LEDGER_KEY) ?? null)
    } catch {
      return
    }
    stored.add(id)
    saveLedger(stored)
  }

  function saveLedger(ledger: ReadonlySet<string>): void {
    try {
      deps.queueStorage?.setItem(IMPORT_LEDGER_KEY, serializeLedger(ledger))
    } catch {
      // 장부를 못 쓰면 이번 실행 동안만 유지된다(이후 로컬에서 지운 기록이 다시 가져와질 수 있다: 알려진 한계).
    }
  }

  // 서버 프로필로 로컬의 비어 있는 칸만 채운다(완료·동의·온보딩 상태와 이미 있는 값은 건드리지 않는다).
  const pullProfile = shared(async (): Promise<void> => {
    const owner = ownerKey()
    const epoch = authEpoch()
    if (owner === null) return
    const api = ready(owner)
    if (api === null || deps.getLocalProfile === undefined || deps.applyProfilePatch === undefined) return
    try {
      const res = await api.users.getMe()
      if (isStale(owner, epoch)) return // 응답을 기다리는 동안 로그아웃·계정 변경
      const remote = fromUserProfileResponse(res)
      const patch = fillEmptyProfile(deps.getLocalProfile().profile, remote.profile)
      if (Object.keys(patch).length > 0) deps.applyProfilePatch(patch)
      if (deps.applyRemoteGuidance !== undefined && res !== null && typeof res === 'object' && 'guidance' in res && res.guidance !== null && typeof res.guidance === 'object') {
        deps.applyRemoteGuidance(res.guidance)
      }
    } catch {
      // 다음 기회에 다시
    }
  })

  // 서버에 저장된 기초 측정 기준(GET /api/v1/users/me/baseline)을 가져와 유효한 기준 페이스가 있으면 로컬에 반영한다.
  const pullBaseline = shared(async (): Promise<void> => {
    if (deps.applyRemoteBaseline === undefined) return
    const owner = ownerKey()
    const epoch = authEpoch()
    if (owner === null) return
    const api = ready(owner)
    if (api === null || api.users.getBaseline === undefined) return
    try {
      const remote = fromBaselineResponse(await api.users.getBaseline())
      if (isStale(owner, epoch)) return
      if (remote.qualityStatus === 'valid' && remote.paceSecPerKm !== null && remote.paceSecPerKm > 0) {
        deps.applyRemoteBaseline(remote)
      }
    } catch {
      // 다음 기회에 다시
    }
  })

  // newClears: 이번 변경에서 사용자가 지운 필드. 아직 보내지 못한 이전 지우기는 값이 여전히 비어 있는 동안 유지한다(다시 값이 생기면 값을 보낸다).
  function markProfile(newClears: readonly ClearableProfileField[] = []): void {
    const local = deps.getLocalProfile === undefined ? null : deps.getLocalProfile()
    mutatePending(writeOwner(), (p) => {
      const merged = new Set<ClearableProfileField>([...p.profileClears, ...newClears])
      const stillEmpty = local === null ? [] : [...merged].filter((f) => toProfileUpdateRequest(local, new Set([f]))[f] === null)
      p.profile = true
      p.profileClears = stillEmpty
      p.profileRequest = local === null ? null : toProfileUpdateRequest(local, new Set(stillEmpty))
    })
  }

  return {
    queue,
    // 소유자 불명(v1) 데이터와 guest 버킷의 보존 현황(전송하지 않는다). 진단·테스트용.
    quarantineSummary: () => {
      const q = readContainer<{ items?: unknown }>(RUN_SYNC_QUEUE_KEY)
      const p = readContainer<Partial<PendingOps>>(SYNC_PENDING_KEY)
      const legacyItems = (q.legacy as { items?: unknown } | undefined)?.items
      return {
        legacyQueueItems: Array.isArray(legacyItems) ? legacyItems.length : 0,
        legacyPending: p.legacy !== undefined,
        guestQueueItems: (() => {
          const items = q.owners.guest?.items
          return Array.isArray(items) ? items.length : 0
        })(),
        owners: Object.keys(q.owners).concat(Object.keys(p.owners)).filter((v, i, a) => a.indexOf(v) === i),
      }
    },
    // 러닝 기록을 서버 저장 대기열에 넣고 보낸다. client_session_id는 로컬 sessionId를 그대로 쓴다(서버가 (user, client_session_id)로 upsert).
    async syncRun(record: RunRecord): Promise<void> {
      const request = toRunCreateRequest(record, record.sessionId)
      if (request === null) return
      const own = queueFor(writeOwner()) // 소유자는 한 번만 정한다(넣는 곳과 보내는 곳이 달라지지 않게)
      // 서버 제약을 어긴 기록(0ms 러닝 등)은 보내지 않고 rejected로 보관한다. 값을 고치거나 버리지 않고 로컬 기록도 그대로 둔다.
      if (findRunRequestViolations(request).length > 0) {
        own.enqueueRejected(request, LOCAL_INVALID_CODE)
        return
      }
      own.enqueue(request) // 이미 있으면 무시(중복 등록 없음)
      await safe(() => own.flush())
    },
    // 앱 시작·로그인·온라인 복구 때: 대기 작업을 먼저 보내고, 그다음 서버 데이터를 가져온다(로컬 변경이 서버 값에 밀리지 않게).
    resume: shared(async (): Promise<void> => {
      const owner = ownerKey()
      if (owner === null) return // 로그인하지 않았거나 계정을 확인할 수 없다: 아무것도 보내지 않고 모두 보존한다
      const own = queueFor(owner)
      own.resumeAfterAuth() // 이 계정의 인증 대기 항목만 푼다
      await safe(() => own.flush())
      await sendProfile()
      await sendBaseline()
      await sendVoice()
      await sendReflections()
      await pullProfile()
      await pullBaseline()
      await pullRuns()
    }),
    // 프로필이 바뀐 즉시 대기 표시와 변경 스냅샷만 남긴다(디바운스 대기 중 앱이 닫혀도 다음 시작에 보낸다). 전송은 하지 않는다.
    markProfileDirty(clears: readonly ClearableProfileField[] = []): void {
      markProfile(clears)
    },
    // 프로필을 보낸다(실패하면 대기 작업으로 남아 다음에 다시 보낸다).
    async syncProfile(clears: readonly ClearableProfileField[] = []): Promise<void> {
      markProfile(clears)
      await sendProfile()
    },
    async syncVoiceGuidance(settings: LocalGuidanceSyncInput): Promise<void> {
      const { voiceGuide, ...extra } = settings
      const hasExtra = Object.keys(extra).length > 0
      mutatePending(writeOwner(), (p) => {
        p.voiceGuide = voiceGuide
        p.guidanceExtra = hasExtra ? extra : null
      })
      await sendVoice()
    },
    async syncDeleteAllRuns(): Promise<void> {
      const owner = ownerKey()
      const epoch = authEpoch()
      if (owner === null) return
      const api = ready(owner)
      if (api === null || api.runs.deleteAll === undefined) return
      if (await safe(() => api.runs.deleteAll!())) {
        if (isStale(owner, epoch)) return
        memoryLedger.clear()
        saveLedger(new Set())
      }
    },
    async syncBaseline(request: BaselineUpsertRequest): Promise<void> {
      mutatePending(writeOwner(), (p) => void (p.baseline = request))
      await sendBaseline()
    },
    // 기록 상세에서 고친 회고를 서버에도 반영한다. 아직 서버에 가지 못한 기록이면 대기열의 요청에 최신 회고를 싣는다.
    async syncReflection(sessionId: string, payload: RunReflectionPayload): Promise<void> {
      const owner = writeOwner()
      const own = queueFor(owner)
      if (own.updateReflection(sessionId, payload)) {
        await safe(() => own.flush())
        return
      }
      mutatePending(owner, (p) => void (p.reflections[sessionId] = payload))
      await sendReflections()
    },
    pullRuns,
    pullProfile,
    pullBaseline,
    // 현재 소유자(없으면 guest)의 대기 작업 요약.
    pendingSummary: (owner: string = writeOwner()) => {
      const p = readPending(owner)
      return { profile: p.profile, baseline: p.baseline !== null, voiceGuide: p.voiceGuide !== null, reflections: Object.keys(p.reflections).length }
    },
  }
}
