import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_GUIDANCE_SETTINGS, GUIDANCE_STORAGE_KEY } from '../../features/my/guidanceSettings'
import { guidanceSettingsStore } from '../../features/my/guidanceSettingsStore'
import { MY_ROUTES } from '../../features/my/routes'
import { GuidanceSettingsPage } from './GuidanceSettingsPage'

// 화면 렌더링·사용자 상호작용 테스트 환경(Vitest + jsdom + Testing Library)이 실제 화면에서 동작하는지 확인한다.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[MY_ROUTES.guidance]}>
      <Routes>
        <Route path="*" element={<GuidanceSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  guidanceSettingsStore.setState({ ...DEFAULT_GUIDANCE_SETTINGS })
})

describe('GuidanceSettingsPage', () => {
  test('제목과 섹션이 렌더링되고 기본값이 Figma 기본 상태로 보인다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '안내 설정', level: 1 })).toBeInTheDocument()
    for (const name of ['음악', '음성', '진동', '러닝']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('switch', { name: /음악 박자 안내/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /음성 안내/ })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /자동 일시정지/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '벗어날 때만' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('클릭하면 스위치가 꺼지고 설정이 저장된다', async () => {
    const user = userEvent.setup()
    renderPage()
    const autoPause = screen.getByRole('switch', { name: /자동 일시정지/ })
    await user.click(autoPause)
    expect(autoPause).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem(GUIDANCE_STORAGE_KEY) ?? '{}').data.autoPause).toBe(false)
    await user.click(autoPause)
    expect(autoPause).toBeChecked()
  })

  test('안내 빈도는 하나만 선택된다', async () => {
    const user = userEvent.setup()
    renderPage()
    const group = screen.getByRole('group', { name: '안내 빈도' })
    await user.click(within(group).getByRole('button', { name: '1 km마다' }))
    expect(within(group).getByRole('button', { name: '1 km마다' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '벗어날 때만' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('준비 중·미지원 행은 꺼진 채로 눌러도 바뀌지 않는다', async () => {
    const user = userEvent.setup()
    renderPage()
    const fixed = screen.getByRole('switch', { name: '박자 자동 조절' })
    expect(fixed).toBeDisabled()
    await user.click(fixed)
    expect(fixed).not.toBeChecked()
    expect(screen.getByRole('switch', { name: '진동 안내' })).toBeDisabled()
  })
})
