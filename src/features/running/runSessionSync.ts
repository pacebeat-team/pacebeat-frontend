import { runLive } from './runLive'
import { runResultStore } from './runResultStore'
import { startRunSessionPersistence } from './runSessionRestore'
import { createRunSessionStorage } from './runSessionStorage'
import { createRunStorage } from './runStorage'
import { runStore } from './runStore'

// 러닝 세션 복원·저장을 연결한다(#48). main.tsx가 App보다 먼저 불러, 첫 화면이 그려지기 전에 복원이 끝나게 한다.
// 모듈은 한 번만 실행되므로 구독이 중복 등록되지 않고, HMR로 다시 실행될 때는 이전 구독을 해제한다.
function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 저장소 접근이 막힌 환경(비공개 모드 등)
  }
}

const persistence = startRunSessionPersistence({
  runs: runStore,
  results: runResultStore,
  live: runLive.live,
  sessionStorage: createRunSessionStorage(getBrowserStorage()),
  records: createRunStorage(),
})

if (import.meta.hot) {
  import.meta.hot.dispose(persistence.stop)
}
