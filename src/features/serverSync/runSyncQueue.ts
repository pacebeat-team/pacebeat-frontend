import type { RunCreateRequest } from '../../lib/api/types.ts'
import { classifyRunSaveFailure, runSaveRetryDelayMs } from './runMapper.ts'

// 러닝 기록 서버 저장 대기열(순수 로직 + 주입된 저장소·API). 화면·러닝 Store와 연결하지 않았다.
//
// 보장하는 것
// - 이 대기열은 로컬 러닝 기록 저장소를 읽거나 쓰거나 지우지 않는다. 서버 저장에 성공해도 로컬 기록은 그대로다.
// - 같은 client_session_id는 대기열에 한 번만 들어간다(중복 등록 방지). 새로고침해도 대기열은 남는다(저장소).
// - 한 번에 한 번만 전송한다(동시에 flush를 불러도 같은 작업을 공유한다).
// - 실패 분류: 네트워크·5xx·429는 backoff 후 재시도, 401은 로그인 후 재개(auth-wait), 그 밖의 4xx는 rejected(자동 재시도 안 함, 사용자·개발자 확인).
// 보장하지 못하는 것: 서버가 같은 client_session_id를 멱등으로 처리하는지(실서버 미검증). 전송은 성공했는데 응답을 못 받은 경우 같은 요청을 다시 보내게 되며, 서버 동작은 백엔드 확인이 필요하다.

// 한 번의 flush에서 전송 중 바뀐 요청을 다시 보내는 최대 횟수(무한 반복 방지).
const MAX_RESENDS = 3

export const RUN_SYNC_QUEUE_KEY = 'pacebeat:sync:run-queue:v1'

export type QueuedRunStatus = 'pending' | 'auth-wait' | 'rejected'

export interface QueuedRun {
  readonly clientSessionId: string
  readonly request: RunCreateRequest
  readonly status: QueuedRunStatus
  readonly attempts: number
  // 이 시각(epoch ms) 이후에 다시 시도한다.
  readonly nextAttemptAt: number
  // 거절됐을 때 서버의 error_code(없으면 null)
  readonly lastErrorCode: string | null
}

export interface QueueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface RunCreator {
  readonly runs: { create(body: RunCreateRequest): Promise<unknown> }
}

export interface RunSyncSummary {
  readonly pending: number
  readonly authWait: number
  readonly rejected: number
}

export type FlushResult =
  | { readonly kind: 'disabled' } // 서버 연동이 꺼져 있다(대기열은 그대로)
  | { readonly kind: 'done'; readonly sent: number; readonly remaining: RunSyncSummary }

const STATUSES: readonly QueuedRunStatus[] = ['pending', 'auth-wait', 'rejected']

function parseQueue(raw: string | null): QueuedRun[] {
  if (raw === null) return []
  try {
    const json: unknown = JSON.parse(raw)
    if (typeof json !== 'object' || json === null || (json as { version?: unknown }).version !== 1) return []
    const items = (json as { items?: unknown }).items
    if (!Array.isArray(items)) return []
    const out: QueuedRun[] = []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const i = item as Record<string, unknown>
      if (typeof i.clientSessionId !== 'string' || typeof i.request !== 'object' || i.request === null) continue
      if (!STATUSES.includes(i.status as QueuedRunStatus)) continue
      if (typeof i.attempts !== 'number' || typeof i.nextAttemptAt !== 'number') continue
      if (out.some((o) => o.clientSessionId === i.clientSessionId)) continue
      out.push({
        clientSessionId: i.clientSessionId,
        request: i.request as RunCreateRequest,
        status: i.status as QueuedRunStatus,
        attempts: i.attempts,
        nextAttemptAt: i.nextAttemptAt,
        lastErrorCode: typeof i.lastErrorCode === 'string' ? i.lastErrorCode : null,
      })
    }
    return out
  } catch {
    return []
  }
}

// 보내기 직전의 판정: send=보낸다 / deleted=사용자가 로컬 기록을 지웠으므로 보내지 않고 이 대기열에서 뺀다 / hold=판단할 수 없으니(저장소 오류 등) 보내지도 지우지도 않고 보존한다.
export type SendVerdict = 'send' | 'deleted' | 'hold'

export function createRunSyncQueue(deps: {
  readonly storage: QueueStorage | null
  readonly getApi: () => RunCreator | null
  readonly now?: () => number
  readonly check?: (item: QueuedRun) => SendVerdict
  // 서버가 알고 있을 수 있는 기록(전송 성공, 또는 응답을 못 받았을 수 있는 기록을 보내지 않고 뺀 경우)의 id. 서버 기록 재유입 방지 장부에 남기는 데 쓴다.
  readonly markServerKnown?: (clientSessionId: string) => void
}) {
  const now = deps.now ?? Date.now
  let memory: QueuedRun[] | null = null
  let inflight: Promise<FlushResult> | null = null

  function read(): QueuedRun[] {
    if (memory !== null) return memory
    try {
      memory = parseQueue(deps.storage?.getItem(RUN_SYNC_QUEUE_KEY) ?? null)
    } catch {
      memory = []
    }
    return memory
  }

  function write(items: QueuedRun[]): void {
    memory = items
    try {
      deps.storage?.setItem(RUN_SYNC_QUEUE_KEY, JSON.stringify({ version: 1, items }))
    } catch {
      // 저장 실패는 무시한다(이번 실행 동안은 메모리 대기열로 동작). 로컬 러닝 기록은 영향이 없다.
    }
  }

  const replace = (id: string, patch: Partial<QueuedRun>) => write(read().map((q) => (q.clientSessionId === id ? { ...q, ...patch } : q)))

  function summarize(): RunSyncSummary {
    const items = read()
    return {
      pending: items.filter((q) => q.status === 'pending').length,
      authWait: items.filter((q) => q.status === 'auth-wait').length,
      rejected: items.filter((q) => q.status === 'rejected').length,
    }
  }

  async function runFlush(): Promise<FlushResult> {
    const api = deps.getApi()
    if (api === null) return { kind: 'disabled' }
    let sent = 0
    let resends = 0
    const pass = read().filter((q) => q.status === 'pending' && q.nextAttemptAt <= now())
    for (let idx = 0; idx < pass.length; idx += 1) {
      const item = pass[idx]
      // 항목마다 전송 직전에 다시 확인한다(대기 중 로그아웃·계정 변경이 있으면 이 대기열의 소유자가 아닌 인증으로 보내지 않는다).
      const current = deps.getApi()
      if (current === null) break
      // 보내기 직전에 로컬 기록이 아직 있는지 확인한다: 지운 기록은 보내지 않는다(이미 서버에 있을 수 있는 기록은 되살아나지 않게 장부에 남긴다). 판단할 수 없으면 보존한다.
      const verdict = deps.check?.(item) ?? 'send'
      if (verdict === 'hold') continue
      if (verdict === 'deleted') {
        write(read().filter((q) => q.clientSessionId !== item.clientSessionId))
        deps.markServerKnown?.(item.clientSessionId)
        continue
      }
      try {
        await current.runs.create(item.request)
        sent += 1
        deps.markServerKnown?.(item.clientSessionId) // 서버에 저장됐다: 이후 로컬에서 지워도 서버 목록에서 다시 가져오지 않는다
        // 전송하는 동안 같은 기록의 요청이 바뀌었다면(회고를 고친 경우) 지우지 않고 다시 보낸다. 서버는 같은 client_session_id의 재전송으로 회고를 갱신한다(upsert).
        const latest = read().find((q) => q.clientSessionId === item.clientSessionId)
        if (latest !== undefined && JSON.stringify(latest.request) !== JSON.stringify(item.request)) {
          replace(item.clientSessionId, { attempts: 0, nextAttemptAt: 0 })
          if (resends < MAX_RESENDS) {
            resends += 1
            pass.push(read().find((q) => q.clientSessionId === item.clientSessionId) as QueuedRun)
          }
          continue
        }
        write(read().filter((q) => q.clientSessionId !== item.clientSessionId))
      } catch (error) {
        const failure = classifyRunSaveFailure(error)
        if (failure === 'retry') {
          // 오프라인·서버 장애일 가능성이 높아, 대기 중인 모든 항목을 같은 시각까지 미룬다(순서를 바꿔 먼저 보내지 않는다).
          const attempts = item.attempts + 1
          const retryAt = now() + runSaveRetryDelayMs(attempts)
          write(read().map((q) => (q.clientSessionId === item.clientSessionId ? { ...q, attempts, nextAttemptAt: retryAt } : q.status === 'pending' ? { ...q, nextAttemptAt: Math.max(q.nextAttemptAt, retryAt) } : q)))
          break
        }
        if (failure === 'auth') {
          replace(item.clientSessionId, { status: 'auth-wait' })
          break // 로그인이 필요하다
        }
        const code = typeof (error as { errorCode?: unknown }).errorCode === 'string' ? (error as { errorCode: string }).errorCode : null
        replace(item.clientSessionId, { status: 'rejected', attempts: item.attempts + 1, lastErrorCode: code })
      }
    }
    return { kind: 'done', sent, remaining: summarize() }
  }

  return {
    // 대기열에 넣는다. 이미 있으면 false(중복 등록하지 않음).
    enqueue(request: RunCreateRequest): boolean {
      if (request.client_session_id === '' || read().some((q) => q.clientSessionId === request.client_session_id)) return false
      write([...read(), { clientSessionId: request.client_session_id, request, status: 'pending', attempts: 0, nextAttemptAt: 0, lastErrorCode: null }])
      return true
    },
    // 서버 제약을 어겨 보낼 수 없는 요청을 보내지 않고 rejected로 보관한다(이미 있으면 false). 로컬 러닝 기록은 건드리지 않는다.
    enqueueRejected(request: RunCreateRequest, errorCode: string): boolean {
      if (request.client_session_id === '' || read().some((q) => q.clientSessionId === request.client_session_id)) return false
      write([...read(), { clientSessionId: request.client_session_id, request, status: 'rejected', attempts: 0, nextAttemptAt: 0, lastErrorCode: errorCode }])
      return true
    },
    list: (): readonly QueuedRun[] => read(),
    summary: summarize,
    // 대기 중인 것을 보낸다. 동시에 여러 번 불러도 한 번만 실행한다.
    flush(): Promise<FlushResult> {
      inflight ??= runFlush().finally(() => {
        inflight = null
      })
      return inflight
    },
    // 로그인 후 호출한다: 인증 대기 중이던 항목을 다시 보낼 수 있게 한다.
    resumeAfterAuth(): void {
      if (read().some((q) => q.status === 'auth-wait')) write(read().map((q) => (q.status === 'auth-wait' ? { ...q, status: 'pending' as const, nextAttemptAt: 0 } : q)))
    },
    // 아직 서버에 가지 못한 항목의 회고를 최신 값으로 바꾼다(회고를 고친 뒤 전송된 요청이 오래된 값을 싣지 않게). 대기열에 없으면 false.
    updateReflection(clientSessionId: string, reflection: RunCreateRequest['reflection']): boolean {
      if (!read().some((q) => q.clientSessionId === clientSessionId)) return false
      write(read().map((q) => (q.clientSessionId === clientSessionId ? { ...q, request: { ...q.request, reflection } } : q)))
      return true
    },
    // 거절된 항목을 사용자가 포기하거나 고친 뒤 대기열에서 뺀다. 로컬 러닝 기록은 지우지 않는다.
    remove(clientSessionId: string): void {
      write(read().filter((q) => q.clientSessionId !== clientSessionId))
    },
  }
}

export type RunSyncQueue = ReturnType<typeof createRunSyncQueue>
