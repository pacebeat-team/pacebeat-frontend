import { deleteRunRecords } from './dataDelete.ts'
import type { DeleteResult } from './dataDelete.ts'
import type { RunKeyValueStorage } from '../running/runStorage.ts'

// 삭제 화면의 두 버튼이 하는 일.
// - 확인: 실제 삭제를 실행한다. 삭제된 것이 확인되면(또는 지울 기록이 없으면) 이전 화면으로 나간다. 실패하면 나가지 않는다(성공처럼 보이지 않는다).
// - 돌아가기: 삭제를 실행하지 않고 저장소를 건드리지 않은 채 이전 화면으로 나간다.
// - 삭제가 끝난 뒤 다시 눌러도 삭제를 한 번 더 실행하지 않는다(중복 클릭 방지). 실패한 뒤에는 다시 시도할 수 있다.

export type ConfirmOutcome = DeleteResult | { readonly status: 'already-done' }

export interface DeleteActionDeps {
  // 기본은 브라우저 localStorage(접근이 막히면 null)
  readonly storage?: RunKeyValueStorage | null
  readonly leave: () => void
}

function browserStorage(): RunKeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export interface DeleteAction {
  confirm: () => ConfirmOutcome
  cancel: () => void
}

export function createDeleteAction(deps: DeleteActionDeps): DeleteAction {
  let done = false
  return {
    confirm: () => {
      if (done) return { status: 'already-done' }
      const result = deleteRunRecords(deps.storage === undefined ? browserStorage() : deps.storage)
      if (result.status === 'failed') return result
      done = true
      deps.leave()
      return result
    },
    cancel: () => deps.leave(),
  }
}
