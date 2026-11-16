import { useCallback, useState } from 'react'
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
import { TermsSheet } from '../components/TermsSheet.tsx'
import { profileStore } from '../profileStore.ts'
import { PROFILE_ROUTES } from '../routes.ts'
import type { ConsentKey } from '../types.ts'

// 가입 동의 화면 (Figma PROFILE / Consent).
// 선택 상태는 이 화면의 draft로만 들고 있다가, CTA를 눌렀을 때만 submitConsent로 Store에 저장한다.

// TODO(PR #30 병합 후): 아래 ConsentHeader를 공통 ScreenHeader로 교체한다.
// 임시 구현이라 공통 컴포넌트가 생기면 이 컴포넌트는 삭제한다.
function ConsentHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-[44px] items-center gap-[8px]">
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로 가기"
        className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 5L8 12L15 19" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1 className="text-[16px] font-medium leading-[22px] text-[#111111]">{title}</h1>
    </header>
  )
}

// TODO(PR #30 병합 후): 아래 ConsentCta를 공통 PrimaryButton으로 교체한다.
// 활성 모양은 공통 PrimaryButton(#111111, 글자 #fefefe, 오른쪽 44px 화살표 원)을 따르고,
// 비활성 모양은 Figma `button / primary / disabled`(#f4f4f6, 글자 #626174, 화살표 원 없음)를 따른다.
// 공통 PrimaryButton의 비활성 모양이 이와 다르면 이 화면의 비활성 처리는 그대로 두거나 디자인과 맞춘다.
function ConsentCta({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="flex h-[64px] w-full cursor-not-allowed items-center rounded-full bg-[#f4f4f6] pl-[28px] pr-[12px] text-left text-[18px] font-medium leading-[26px] text-[#626174]"
      >
        {label}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[64px] w-full cursor-pointer items-center gap-[12px] rounded-full bg-[#111111] py-[10px] pl-[28px] pr-[12px] text-left text-[18px] font-medium leading-[26px] text-[#fefefe] transition-opacity active:opacity-[0.78]"
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#fefefe]" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 12H19M13 6L19 12L13 18" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

// TODO(PR #30 병합 후): 온보딩 인트로 경로가 생기면 이 값을 라우트 상수로 바꾼다. 지금은 해당 경로가 없다.
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

  function handleSubmit() {
    if (submitConsent(profileStore.getState(), draft)) navigate(PROFILE_ROUTES.nickname)
  }

  function handleToggleItem(key: ConsentKey) {
    setDraft((current) => toggleItem(current, key))
  }

  return (
    <div className="flex flex-col px-[24px] pb-[24px] pt-[12px]">
      <ConsentHeader title="가입하기" onBack={handleBack} />

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
          <ConsentCta label="동의하고 계속하기" disabled={!continuable} onClick={handleSubmit} />
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
