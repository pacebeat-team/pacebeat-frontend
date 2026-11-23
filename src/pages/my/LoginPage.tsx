import { useState } from 'react'
import type { FormEvent } from 'react'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { auth, useAuthState } from '../../lib/auth'
import type { SignInFailure } from '../../lib/auth'
import { DeviceScreen } from './DeviceParts'

// 이메일·비밀번호 로그인(Supabase Auth). 로그인하지 않아도 앱의 모든 로컬 기능은 그대로 동작한다.
// 입력한 이메일·비밀번호는 이 화면의 상태에만 있고 저장·출력하지 않는다. 안내 문구는 Figma에 없어 확정 전이다(docs/unconfirmed-copy.md).
const ERROR_TEXT_CLASS = 'text-[#D92D20]'

const MESSAGES: Record<SignInFailure, string> = {
  disabled: '로그인을 사용할 수 없어요.',
  'invalid-input': '이메일과 비밀번호를 입력해 주세요.',
  'invalid-credentials': '이메일 또는 비밀번호가 맞지 않아요.',
  'rate-limited': '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.',
  network: '연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
  'bad-response': '로그인하지 못했어요. 다시 시도해 주세요.',
  superseded: '로그인하지 못했어요. 다시 시도해 주세요.',
}

export function LoginPage() {
  const goBack = useMyBack(MY_ROUTES.account)
  const status = useAuthState((state) => state.status)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SignInFailure | null>(null)

  const disabled = status === 'disabled'
  const signedIn = status === 'signedIn'
  const canSubmit = !disabled && !busy && email.trim() !== '' && password !== ''

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const result = await auth.signInWithPassword(email, password)
    setBusy(false)
    if (result.ok) {
      setPassword('')
      goBack()
      return
    }
    setError(result.reason)
  }

  return (
    <DeviceScreen title="로그인" onBack={goBack} onConfirm={() => void submit()} confirmLabel={busy ? '로그인 중' : '로그인'} confirmDisabled={!canSubmit} secondary={{ label: '돌아가기', onClick: goBack }}>
      {disabled ? (
        <p className="mt-6 text-[16px] leading-6" role="status">로그인을 사용할 수 없어요. 지금은 이 기기에만 기록을 저장해요.</p>
      ) : signedIn ? (
        <p className="mt-6 text-[16px] leading-6" role="status">이미 로그인되어 있어요. 다른 계정으로 로그인하면 계정이 바뀌어요.</p>
      ) : null}
      <form className="mt-6 flex flex-col" onSubmit={(event) => void submit(event)} noValidate>
        <label className="text-[14px] leading-[20px] text-muted" htmlFor="login-email">이메일</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="email"
          disabled={disabled || busy}
          aria-invalid={error === 'invalid-credentials'}
          className="h-[48px] w-full min-w-0 bg-transparent text-[20px] leading-[28px] text-[#111111] outline-none"
        />
        <div className="h-px bg-[#dedee5]" />
        <label className="mt-5 text-[14px] leading-[20px] text-muted" htmlFor="login-password">비밀번호</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          disabled={disabled || busy}
          aria-invalid={error === 'invalid-credentials'}
          className="h-[48px] w-full min-w-0 bg-transparent text-[20px] leading-[28px] text-[#111111] outline-none"
        />
        <div className="h-px bg-[#dedee5]" />
        <button type="submit" className="sr-only" disabled={!canSubmit} tabIndex={-1}>로그인</button>
        <p role="alert" aria-live="polite" className={`mt-3 min-h-[20px] text-[13px] leading-[20px] ${ERROR_TEXT_CLASS}`}>
          {error === null ? '' : MESSAGES[error]}
        </p>
      </form>
      <p className="mt-4 text-[14px] leading-[20px] text-muted">로그인하지 않아도 모든 기능을 쓸 수 있어요. 로그인하기 전의 기록은 계정에 자동으로 옮겨지지 않아요.</p>
    </DeviceScreen>
  )
}

export default LoginPage
