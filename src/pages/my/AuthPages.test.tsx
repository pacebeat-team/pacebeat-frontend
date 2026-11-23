import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MY_ROUTES } from '../../features/my/routes'
import { AccountPage } from './AccountPage'
import { LoginPage } from './LoginPage'

// 로그인·계정 화면. lib/auth는 가짜로 바꾼다(실제 Supabase에는 요청하지 않는다). 실서버 검증이 아니다.
const mocks = vi.hoisted(() => {
  const state = { status: 'signedOut' as string, userId: null as string | null }
  const listeners = new Set<() => void>()
  return {
    state,
    listeners,
    signInWithPassword: vi.fn(),
    signOut: vi.fn(async () => {
      state.status = 'signedOut'
      listeners.forEach((l) => l())
    }),
  }
})

vi.mock('../../lib/auth', async () => {
  const React = await import('react')
  return {
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
    useAuthState: <T,>(selector: (s: { status: string; userId: string | null }) => T): T => {
      const [, force] = React.useReducer((n: number) => n + 1, 0)
      React.useEffect(() => {
        mocks.listeners.add(force as () => void)
        return () => void mocks.listeners.delete(force as () => void)
      }, [])
      return selector({ ...mocks.state })
    },
  }
})

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={MY_ROUTES.accountLogin} element={<LoginPage />} />
        <Route path={MY_ROUTES.account} element={<AccountPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.state.status = 'signedOut'
  mocks.state.userId = null
  mocks.signInWithPassword.mockReset()
  mocks.signOut.mockClear()
})

describe('LoginPage', () => {
  test('인증이 꺼져 있으면(설정 없음) 안내만 보이고 입력과 로그인 시도가 막힌다', async () => {
    mocks.state.status = 'disabled'
    renderAt(MY_ROUTES.accountLogin)
    expect(screen.getByRole('status')).toHaveTextContent('로그인을 사용할 수 없어요')
    expect(screen.getByLabelText('이메일')).toBeDisabled()
    expect(screen.getByLabelText('비밀번호')).toBeDisabled()
    const cta = screen.getAllByRole('button', { name: '로그인' }).find((b) => !b.classList.contains('sr-only')) as HTMLElement
    expect(cta).toBeDisabled()
    await userEvent.click(cta)
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  test('입력이 비어 있으면 로그인 버튼이 눌리지 않는다', async () => {
    renderAt(MY_ROUTES.accountLogin)
    const cta = screen.getAllByRole('button', { name: '로그인' }).find((b) => !b.classList.contains('sr-only')) as HTMLElement
    expect(cta).toBeDisabled()
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.test')
    expect(cta).toBeDisabled()
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pw')
    expect(cta).toBeEnabled()
  })

  test('성공하면 입력값으로 signInWithPassword를 부르고 화면을 떠난다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ ok: true })
    renderAt(MY_ROUTES.accountLogin)
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.test')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pw1234{Enter}')
    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith('a@b.test', 'pw1234'))
    await waitFor(() => expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument())
  })

  test('실패하면 사유별 문구를 보여 주고 화면에 머문다. 이메일은 남기고, 오류에 입력값을 싣지 않는다', async () => {
    for (const [reason, text] of [['invalid-credentials', '이메일 또는 비밀번호가 맞지 않아요.'], ['network', '연결하지 못했어요'], ['rate-limited', '시도가 너무 많아요']] as const) {
      mocks.signInWithPassword.mockResolvedValue({ ok: false, reason })
      const { unmount } = renderAt(MY_ROUTES.accountLogin)
      await userEvent.type(screen.getByLabelText('이메일'), 'a@b.test')
      await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pw')
      await userEvent.click(screen.getAllByRole('button', { name: '로그인' }).find((b) => !b.classList.contains('sr-only')) as HTMLElement)
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      expect(screen.getByRole('alert').textContent).not.toContain('secret-pw')
      expect(screen.getByLabelText('이메일')).toHaveValue('a@b.test')
      unmount()
    }
  })

  test('요청 중에는 입력이 잠기고 중복 제출되지 않는다', async () => {
    let resolve!: (v: unknown) => void
    mocks.signInWithPassword.mockReturnValue(new Promise((r) => (resolve = r)))
    renderAt(MY_ROUTES.accountLogin)
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.test')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pw{Enter}')
    await userEvent.keyboard('{Enter}')
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('이메일')).toBeDisabled()
    resolve({ ok: false, reason: 'network' })
    expect(await screen.findByRole('alert')).toHaveTextContent('연결하지 못했어요')
  })
})

describe('AccountPage 계정 연결', () => {
  test('인증이 꺼져 있으면 "연결 안 됨"이고 로그인 화면으로 가는 링크가 없다', () => {
    mocks.state.status = 'disabled'
    renderAt(MY_ROUTES.account)
    expect(screen.getByText('연결 안 됨')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /계정 연결/ })).not.toBeInTheDocument()
  })
  test('로그아웃 상태에서는 로그인 화면으로 가는 링크가 있다', () => {
    renderAt(MY_ROUTES.account)
    expect(screen.getByRole('link', { name: /계정 연결/ })).toHaveAttribute('href', MY_ROUTES.accountLogin)
  })
  test('세션이 만료되면 "다시 로그인 필요"를 보여 준다', () => {
    mocks.state.status = 'expired'
    renderAt(MY_ROUTES.account)
    expect(screen.getByText('다시 로그인 필요')).toBeInTheDocument()
  })
  test('로그인 상태에서는 "연결됨"과 로그아웃이 보이고, 로그아웃하면 로컬 기록은 지워지지 않는다는 안내가 있다', async () => {
    mocks.state.status = 'signedIn'
    mocks.state.userId = 'A'
    localStorage.setItem('pacebeat:run:records:v1', '{"version":1,"data":[]}')
    renderAt(MY_ROUTES.account)
    expect(screen.getByText('연결됨')).toBeInTheDocument()
    expect(screen.getByText(/러닝 기록은 지워지지 않아요/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('연결됨')).not.toBeInTheDocument())
    expect(localStorage.getItem('pacebeat:run:records:v1')).not.toBeNull() // 로그아웃이 로컬 기록을 건드리지 않았다
  })
})
