import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './app/completionSync'
import './features/running/runSessionSync'
import './features/serverSync/syncWiring'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { createAppQueryClient } from './lib/api/queryClient'
import { auth, startAuth } from './lib/auth'

// 서버 데이터 캐시(TanStack Query). 아직 서버 데이터를 읽는 화면은 없다(기반만 준비).
const queryClient = createAppQueryClient()

// 인증 세션 복구 시작. 로그아웃·세션 만료 시 서버 데이터 캐시를 비운다(다른 사용자의 데이터가 남지 않게).
startAuth()
auth.onAuthStateChange((state) => {
  if (state.status === 'signedOut' || state.status === 'expired') queryClient.clear()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
