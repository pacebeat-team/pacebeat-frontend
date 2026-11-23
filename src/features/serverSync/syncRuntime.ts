import { toRunCreateRequest } from './runMapper.ts'
import { createRunSyncQueue } from './runSyncQueue.ts'
import type { QueueStorage, RunCreator, RunSyncQueue } from './runSyncQueue.ts'
import { baselineRequestFromMetrics } from './baselineMapper.ts'
import { toProfileUpdateRequest } from './profileMapper.ts'
import type { LocalProfileSnapshot } from './profileMapper.ts'
import type { BaselineUpsertRequest, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import type { RunRecord } from '../running/types.ts'

// 화면 코드를 바꾸지 않고 기존 Store를 구독해 서버로 보내는 연결(주입형이라 테스트 가능).
// 원칙: 서버가 꺼져 있거나(api=null) 로그인하지 않았으면 아무것도 보내지 않고 기존 로컬 흐름만 쓴다.
// 로컬 데이터는 읽기만 한다(서버 응답으로 덮어쓰지 않는다). 실패해도 사용자 흐름을 막거나 예외를 던지지 않는다.

export interface SyncApi extends RunCreator {
  readonly users: {
    updateMe(body: UserProfileUpdateRequest): Promise<unknown>
    putBaseline(body: BaselineUpsertRequest): Promise<unknown>
  }
}

export interface SyncDeps {
  readonly getApi: () => SyncApi | null
  readonly isSignedIn: () => boolean
  readonly queueStorage: QueueStorage | null
  readonly now?: () => number
}

export function createSyncRuntime(deps: SyncDeps) {
  const queue: RunSyncQueue = createRunSyncQueue({
    storage: deps.queueStorage,
    // 로그인하지 않았으면 전송하지 않는다(대기열에는 남는다).
    getApi: () => (deps.isSignedIn() ? deps.getApi() : null),
    now: deps.now,
  })

  async function safe(task: () => Promise<unknown>): Promise<void> {
    try {
      await task()
    } catch {
      // 네트워크·서버 오류는 다음 기회(앱 시작·로그인·온라인 복구)에 다시 시도한다. 로컬 데이터에는 영향 없다.
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
    // 앱 시작·로그인·온라인 복구 때: 인증 대기 항목을 풀고 남은 것을 보낸다.
    async resume(): Promise<void> {
      if (!deps.isSignedIn()) return
      queue.resumeAfterAuth()
      await safe(() => queue.flush())
    },
    async syncProfile(local: LocalProfileSnapshot): Promise<void> {
      const api = deps.getApi()
      if (api === null || !deps.isSignedIn()) return
      await safe(() => api.users.updateMe(toProfileUpdateRequest(local)))
    },
    async syncBaseline(request: BaselineUpsertRequest): Promise<void> {
      const api = deps.getApi()
      if (api === null || !deps.isSignedIn()) return
      await safe(() => api.users.putBaseline(request))
    },
  }
}

export { baselineRequestFromMetrics }
