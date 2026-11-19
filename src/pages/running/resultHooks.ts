import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { runResultStore } from '../../features/running/runResultStore'
import { isFinishedSnapshot, summarizeRun } from '../../features/running/runResult'
import type { RunSummary } from '../../features/running/runResult'
import { useRunStore } from '../../features/running/runStore'
import type { ReflectionDifficulty, ReflectionReason } from '../../features/running/types'

export const DIFFICULTY_OPTIONS: readonly { value: ReflectionDifficulty; label: string }[] = [
  { value: 'easy', label: '쉬웠어요' },
  { value: 'moderate', label: '적당했어요' },
  { value: 'hard', label: '힘들었어요' },
]

export const REASON_OPTIONS: readonly { value: ReflectionReason; label: string }[] = [
  { value: 'breath', label: '숨이 참' },
  { value: 'legs', label: '다리 피로' },
  { value: 'boredom', label: '지루함' },
  { value: 'time', label: '시간 부족' },
]

// 종료된 세션의 결과 요약. 세션이 바뀌면 결과 입력 상태를 맞춘다.
export function useFinishedRun(): { summary: RunSummary; sessionId: string } | null {
  const snapshot = useRunStore((state) => state.activeSession)
  const finished = isFinishedSnapshot(snapshot) ? snapshot : null
  const sessionId = finished?.session.id ?? null
  useEffect(() => {
    runResultStore.getState().sync(sessionId)
  }, [sessionId])
  if (finished === null) return null
  const summary = summarizeRun(finished)
  return summary === null ? null : { summary, sessionId: finished.session.id }
}

// 저장한 뒤 목적지로 이동한다. 저장에 실패하면 이동하지 않는다.
export function useSaveAndGo() {
  const navigate = useNavigate()
  return (destination: string) => {
    if (!runResultStore.getState().save()) return
    // 세션 정리는 결과 흐름을 벗어난 뒤 AppLayout이 한다.
    navigate(destination, { replace: true })
  }
}

