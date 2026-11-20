import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CONSENT_ITEMS,
  canContinue,
  createInitialDraft,
  getRequirementMessage,
  isAllChecked,
  submitConsent,
  toggleAll,
  toggleItem,
} from '../consent.ts'
import type { ConsentDraft } from '../consent.ts'
import { ConsentRow } from '../components/ConsentRow.tsx'
import { ProfileCta } from '../components/ProfileCta.tsx'
import { ProfileHeader } from '../components/ProfileHeader.tsx'
import { TermsSheet } from '../components/TermsSheet.tsx'
import { profileStore } from '../profileStore.ts'
import { PROFILE_ROUTES } from '../routes.ts'
import type { ConsentKey } from '../types.ts'

// 가입 동의 화면 (Figma PROFILE / Consent).
// 선택 상태는 이 화면의 draft로만 들고 있다가, CTA를 눌렀을 때만 submitConsent로 Store에 저장한다.

// 이전 화면이 없을 때 돌아갈 곳. 온보딩 경로(/onboarding/...)는 라우트 상수가 따로 없어 문자열로 둔다.
const BACK_FALLBACK_PATH = '/onboarding/intro'

export function ConsentScreen() {
  const navigate = useNavigate()
  // 이미 저장된 동의가 있으면 그 값에서 시작한다. 렌더링마다 읽지 않도록 처음 한 번만 읽는다.
  const [draft, setDraft] = useState<ConsentDraft>(() => createInitialDraft(profileStore.getState().consent))
  const [termsOpen, setTermsOpen] = useState(false)
  const closeTerms = useCallback(() => setTermsOpen(false), [])

  const allChecked = isAllChecked(draft)
  const continuable = canContinue(draft)

  function handleBack() {
    // 이전 화면이 없으면(직접 진입, 새로고침) 인트로로 보낸다.
    const index: unknown = window.history.state?.idx
    if (typeof index === 'number' && index > 0) navigate(-1)
    else navigate(BACK_FALLBACK_PATH, { replace: true })
  }

  // 저장에 성공한 뒤에는 다시 실행하지 않는다. 빠르게 여러 번 눌러도 저장과 이동은 한 번만 일어난다.
  const submittedRef = useRef(false)

  function handleSubmit() {
    if (submittedRef.current) return
    if (submitConsent(profileStore.getState(), draft)) {
      submittedRef.current = true
      navigate(PROFILE_ROUTES.nickname)
    }
  }

  function handleToggleItem(key: ConsentKey) {
    setDraft((current) => toggleItem(current, key))
  }

  return (
    <div className="flex flex-col px-[24px] pb-[24px] pt-[12px]">
      <ProfileHeader title="가입하기" onBack={handleBack} />

      <h2 className="mt-[16px] text-[34px] font-light leading-[44px] tracking-[-1.02px] text-[#111111]">
        시작하기 전에
        <br />
        확인해 주세요.
      </h2>
      <p className="mt-[16px] text-[14px] font-normal leading-[20px] text-[#626174]">필수 항목만 동의해도 괜찮아요.</p>

      <div className="mt-[20px] flex flex-col">
        <ConsentRow
          variant="all"
          label="전체 동의하기"
          description="필수 4개와 선택 1개를 함께 선택해요."
          checked={allChecked}
          onToggle={() => setDraft((current) => toggleAll(current))}
        />
        <div className="mt-[12px] h-px bg-[#dedee5]" />
        <div className="mt-[8px] flex flex-col">
          {CONSENT_ITEMS.map((item) => (
            <ConsentRow
              key={item.key}
              label={item.label}
              checked={draft[item.key]}
              onToggle={() => handleToggleItem(item.key)}
              onView={item.hasDetail ? () => setTermsOpen(true) : undefined}
            />
          ))}
        </div>

        <div className="mt-[20px]">
          <ProfileCta label="동의하고 계속하기" disabled={!continuable} onClick={handleSubmit} />
        </div>
        <p className="mt-[12px] text-[13px] font-normal leading-[18px] text-[#626174]" aria-live="polite">
          {getRequirementMessage(draft)}
        </p>
      </div>

      {termsOpen && <TermsSheet onClose={closeTerms} />}
    </div>
  )
}

export default ConsentScreen
