import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasPreviousEntry } from './history.ts'

// 프로필 입력 화면의 뒤로 가기. 이전 화면이 있으면 한 단계 돌아가고,
// 직접 진입이나 새로고침이라 기록이 없으면 이전 단계 경로로 보낸다. (기록을 쌓지 않도록 replace)
export function useStepBack(fallbackPath: string): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    if (hasPreviousEntry(window.history.state)) navigate(-1)
    else navigate(fallbackPath, { replace: true })
  }, [navigate, fallbackPath])
}
