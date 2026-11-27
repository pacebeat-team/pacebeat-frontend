import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_GUIDANCE_SETTINGS } from '../../features/my/guidanceSettings'
import { getGuidanceSnapshot, guidanceSettingsStore } from '../../features/my/guidanceSettingsStore'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runLive } from '../../features/running/runLive'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore } from '../../features/running/runStore'
import { GuidanceSettingsPage } from '../my/GuidanceSettingsPage'
import { CountdownPage } from './CountdownPage'

// 실제 사용자 흐름: 설정 화면에서 값을 바꾸고 → 카운트다운이 끝나 러닝이 시작되면 그때의 설정이 세션에 고정되고
// → 러닝 중 설정 화면에서 다시 바꿔도 현재 세션은 그대로이며 → 다음 러닝부터 바뀐 값이 적용된다. (Time 모드: 위치 수집 없음)

function SettingsScreen() {
  return (
    <MemoryRouter initialEntries={['/my/guidance']}>
      <Routes>
        <Route path="*" element={<GuidanceSettingsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function CountdownScreen() {
  return (
    <MemoryRouter initialEntries={[RUN_PATHS.countdown]}>
      <Routes>
        <Route path={RUN_PATHS.countdown} element={<CountdownPage />} />
        <Route path={RUN_PATHS.active} element={<p>진행 화면</p>} />
        <Route path={RUN_PATHS.ready} element={<p>준비 화면</p>} />
      </Routes>
    </MemoryRouter>
  )
}

// 시작 신호를 보낸 뒤 카운트다운 화면을 열고 3초가 지나 러닝이 시작되게 한다.
async function startTimeRunViaCountdown() {
  runSetupStore.getState().reset()
  runSetupStore.getState().enterGoal()
  runSetupStore.getState().confirmGoal()
  runSetupStore.getState().confirmMusic()
  runSetupStore.getState().signalStart('time')
  vi.useFakeTimers()
  try {
    const view = render(<CountdownScreen />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500)
    })
    expect(screen.getByText('진행 화면')).toBeInTheDocument()
    view.unmount()
  } finally {
    vi.useRealTimers()
  }
}

function endRun() {
  runLive.stop('user')
  runStore.getState().clearSession()
}

beforeEach(() => {
  localStorage.clear()
  guidanceSettingsStore.setState({ ...DEFAULT_GUIDANCE_SETTINGS })
  endRun()
})

afterEach(() => {
  endRun()
})

describe('안내 설정 → 러닝 시작 스냅샷 (실제 화면 흐름)', () => {
  test('설정 화면에서 바꾼 값이 러닝 시작 때 세션에 고정된다', async () => {
    const user = userEvent.setup()
    const settings = render(<SettingsScreen />)
    await user.click(screen.getByRole('switch', { name: /자동 일시정지/ }))
    await user.click(screen.getByRole('switch', { name: /음악 박자 안내/ }))
    await user.click(screen.getByRole('button', { name: '1 km마다' }))
    settings.unmount()

    await startTimeRunViaCountdown()
    expect(runStore.getState().activeSession?.guidance).toEqual({
      beatGuide: false,
      voiceGuide: false,
      frequency: 'perKm',
      autoPause: false,
    })
  })

  test('러닝 도중 설정을 바꿔도 현재 세션은 그대로이고 다음 러닝부터 반영된다', async () => {
    const user = userEvent.setup()
    await startTimeRunViaCountdown()
    const started = runStore.getState().activeSession?.guidance
    expect(started).toEqual(DEFAULT_GUIDANCE_SETTINGS)

    // 러닝 중 설정 화면에서 값을 바꾼다.
    const settings = render(<SettingsScreen />)
    await user.click(screen.getByRole('switch', { name: /음성 안내/ }))
    await user.click(screen.getByRole('button', { name: '둘 다' }))
    expect(screen.getByRole('switch', { name: /음성 안내/ })).toBeChecked()
    settings.unmount()
    expect(getGuidanceSnapshot()).toMatchObject({ voiceGuide: true, frequency: 'both' })

    // 진행 중인 세션은 바뀌지 않는다. 수동 일시정지·재개도 스냅샷을 건드리지 않는다.
    expect(runStore.getState().activeSession?.guidance).toEqual(started)
    runLive.pause()
    expect(runStore.getState().activeSession?.session.status).toBe('paused')
    runLive.resume()
    expect(runStore.getState().activeSession?.session.status).toBe('running')
    expect(runStore.getState().activeSession?.guidance).toEqual(started)

    // 다음 러닝부터 바뀐 값이 적용된다.
    endRun()
    await startTimeRunViaCountdown()
    expect(runStore.getState().activeSession?.guidance).toMatchObject({ voiceGuide: true, frequency: 'both' })
  })

  test('설정은 값만 복사된다: 스냅샷에 스토어의 함수가 섞이지 않는다', () => {
    expect(Object.keys(getGuidanceSnapshot()).sort()).toEqual(['autoPause', 'beatGuide', 'frequency', 'voiceGuide'])
  })
})
