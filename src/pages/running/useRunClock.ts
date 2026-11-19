import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { runLive } from '../../features/running/runLive'

// 1초마다(그리고 화면이 다시 보일 때) 현재 시각을 갱신한다. 값은 runLive 상태의 now로 읽는다.
export function useRunClock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined
    runLive.tick()
    const id = window.setInterval(() => runLive.tick(), 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') runLive.tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}

// 브라우저 뒤로 가기(POP)를 막는다. 러닝은 종료 확인 없이 기록이 사라지면 안 된다.
export function useBlockBack(enabled: boolean): void {
  const blocker = useBlocker(({ historyAction }) => enabled && historyAction === 'POP')
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])
}
