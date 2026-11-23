import { useNavigate } from 'react-router-dom'
import { hasPreviousEntry } from '../profile/history.ts'

// 이전 화면이 있으면 한 단계 돌아가고, 직접 열었거나 새로고침했으면 fallback으로 보낸다. (기록을 쌓지 않도록 replace)
export function useMyBack(fallback: string): () => void {
  const navigate = useNavigate()
  return () => (hasPreviousEntry(window.history.state) ? navigate(-1) : navigate(fallback, { replace: true }))
}
