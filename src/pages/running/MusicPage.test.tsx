import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MusicPage } from './MusicPage'

// 음악 화면: 게스트·인증 꺼짐에서는 로컬 목록이고 서버 요청이 없다. 로그인 상태에서는 서버 프리셋의 순서만 반영한다. lib/auth·lib/api는 가짜다(실서버 아님).
const mocks = vi.hoisted(() => ({
  auth: { status: 'disabled' as string, userId: null as string | null },
  presets: vi.fn(),
  getOwnerBoundApi: vi.fn(),
}))
vi.mock('../../lib/auth/index.ts', () => ({ useAuthState: <T,>(selector: (s: { status: string; userId: string | null }) => T): T => selector({ ...mocks.auth }) }))
vi.mock('../../lib/api/index.ts', () => ({ getOwnerBoundApi: (userId: string) => mocks.getOwnerBoundApi(userId) }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MusicPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const titles = () => screen.getAllByRole('listitem').map((li) => li.textContent?.split(/\d/)[0])

beforeEach(() => {
  mocks.auth.status = 'disabled'
  mocks.auth.userId = null
  mocks.presets.mockReset()
  mocks.getOwnerBoundApi.mockReset()
  mocks.getOwnerBoundApi.mockReturnValue({ runs: { musicPresets: mocks.presets } })
})

describe('MusicPage 음악 목록', () => {
  test('인증이 꺼져 있으면 로컬 4곡이 그대로 보이고 서버 요청이 없다', () => {
    renderPage()
    expect(titles()).toEqual(['Morning Stride', 'City Loop', 'Easy Tempo', 'Night Pace'])
    expect(mocks.presets).not.toHaveBeenCalled()
    expect(mocks.getOwnerBoundApi).not.toHaveBeenCalled()
  })
  test('로그아웃 상태에서도 서버 요청이 없다', () => {
    mocks.auth.status = 'signedOut'
    renderPage()
    expect(mocks.presets).not.toHaveBeenCalled()
  })
  test('로그인 상태에서는 서버 순서를 반영하고, 로컬 곡은 줄지 않는다', async () => {
    mocks.auth.status = 'signedIn'
    mocks.auth.userId = 'A'
    mocks.presets.mockResolvedValue([
      { id: 'night-pace', title: 'x', bpm: 1 },
      { id: 'city-loop', title: 'y', bpm: 2 },
    ])
    renderPage()
    await waitFor(() => expect(titles()).toEqual(['Night Pace', 'City Loop', 'Morning Stride', 'Easy Tempo']))
    expect(mocks.getOwnerBoundApi).toHaveBeenCalledWith('A')
  })
  test('서버 오류·빈 응답·잘못된 응답이면 로컬 목록 그대로다', async () => {
    mocks.auth.status = 'signedIn'
    mocks.auth.userId = 'A'
    for (const impl of [() => Promise.reject(new Error('503')), () => Promise.resolve([]), () => Promise.resolve('bad')]) {
      mocks.presets.mockReset()
      mocks.presets.mockImplementation(impl)
      const { unmount } = renderPage()
      await waitFor(() => expect(mocks.presets).toHaveBeenCalled())
      expect(titles()).toEqual(['Morning Stride', 'City Loop', 'Easy Tempo', 'Night Pace'])
      unmount()
    }
  })
})
