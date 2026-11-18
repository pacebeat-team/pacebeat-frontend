import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './app/completionSync'
import App from './App'
import { runLive } from './features/running/runLive'

// 새로고침 전에 진행 중이던 러닝 세션을 되살린다(진행 중이던 세션은 일시정지 상태로, 24시간이 지난 세션은 폐기).
runLive.restore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
