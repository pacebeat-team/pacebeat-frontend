import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { getGuidanceSnapshot } from '../../features/my/guidanceSettingsStore'
import { COUNTDOWN_SECONDS, getCountdownValue } from '../../features/running/runProgress'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runLive } from '../../features/running/runLive'
import { runSetupStore, useRunSetupStore } from '../../features/running/runSetupStore'
import { RunFooter } from './RunFooter'

// Figma `RUN / Countdown`: 3 · 2 · 1을 1초씩, 전환 효과 없이 보여 주고 끝나면 러닝을 시작한다.
// GPS 모드는 카운트다운 동안 위치 권한을 요청한다. 권한이 거부되면 시작하지 않고 준비 화면으로 돌아간다(시간 기록으로 자동 전환하지 않는다).
export function CountdownPage() {
  const navigate = useNavigate()
  const mode = useRunSetupStore((state) => state.mode)
  const [count, setCount] = useState(COUNTDOWN_SECONDS)
  const startedRef = useRef(false)

  // 준비 화면으로 돌아간다: 시작 신호만 지운다. 단계(level)를 되돌리지 않으므로 이동 중에 접근 가드가
  // 카운트다운 화면을 목표 화면으로 되돌리지 않는다. 신호가 없는 카운트다운 화면은 아래에서 준비 화면으로 보낸다.
  const leaveToReady = useCallback(() => {
    runSetupStore.getState().clearStart()
    navigate(RUN_PATHS.ready, { replace: true })
  }, [navigate])

  useEffect(() => {
    if (mode === null) return undefined
    startedRef.current = false
    const startAt = Date.now()
    let finished = false

    const backToReady = () => {
      if (finished) return
      finished = true
      leaveToReady()
    }

    if (mode === 'gps') runLive.prepare({ onUnavailable: backToReady })

    const id = window.setInterval(() => {
      if (finished) return
      const value = getCountdownValue(Date.now() - startAt)
      if (value > 0) {
        setCount(value)
        return
      }
      // 위치 권한 응답을 기다리는 중이면 시작하지 않고 마지막 숫자에서 기다린다(허용되면 시작, 거부되면 준비 화면으로 돌아간다).
      if (mode === 'gps' && runLive.gpsStartState() === 'waiting') {
        setCount(1)
        return
      }
      finished = true
      window.clearInterval(id)
      startedRef.current = true
      runLive.begin(mode, getGuidanceSnapshot())
      navigate(RUN_PATHS.active, { replace: true })
    }, 200)

    return () => {
      finished = true
      window.clearInterval(id)
      // 세션을 시작하기 전에 화면을 벗어나면(뒤로 가기 등) 위치 수집을 멈춘다.
      if (!startedRef.current) runLive.cancelPrepare()
    }
  }, [mode, leaveToReady, navigate])

  const cancel = () => {
    runLive.cancelPrepare()
    leaveToReady()
  }

  if (mode === null) return <Navigate to={RUN_PATHS.ready} replace />

  return (
    <div className="flex min-h-0 flex-1 flex-col font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-3 [&>*]:shrink-0">
        <p className="text-[23.5px] font-bold leading-[29px] text-ink">P!PACE</p>
        <div className="mt-[60px] flex h-[250px] w-full items-center justify-center">
          <p
            role="timer"
            aria-live="polite"
            className="text-[180px] font-light leading-[216px] tracking-[-5.4px] text-ink"
          >
            {count}
          </p>
        </div>
        <p className="mt-5 text-center text-[28px] leading-[40px] text-ink">내 페이스로, 출발!</p>
      </div>
      <RunFooter>
        <PrimaryButton label="준비 화면으로" onClick={cancel} />
      </RunFooter>
    </div>
  )
}

export default CountdownPage
