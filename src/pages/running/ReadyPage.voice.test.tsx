import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { guidanceSettingsStore } from '../../features/my/guidanceSettingsStore'
import { ReadyPage } from './ReadyPage'

afterEach(() => {
  act(() => guidanceSettingsStore.getState().setVoiceGuide(true))
})

function renderReady() {
  return render(
    <MemoryRouter>
      <ReadyPage />
    </MemoryRouter>,
  )
}

describe('ReadyPage 음성 안내 표시', () => {
  it('저장된 음성 안내가 켜져 있으면 켜짐을 보여 준다', () => {
    act(() => guidanceSettingsStore.getState().setVoiceGuide(true))
    renderReady()
    expect(screen.getByText(/켜짐 · 진동은/)).toBeTruthy()
  })
  it('꺼져 있으면 꺼짐을 보여 주고 설정을 바꾸면 따라간다', () => {
    act(() => guidanceSettingsStore.getState().setVoiceGuide(false))
    renderReady()
    expect(screen.getByText(/꺼짐 · 진동은/)).toBeTruthy()
    act(() => guidanceSettingsStore.getState().setVoiceGuide(true))
    expect(screen.getByText(/켜짐 · 진동은/)).toBeTruthy()
  })
})
