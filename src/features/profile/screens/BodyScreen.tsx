import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import shieldCheck from '../../../assets/icons/shield-check.svg'
import { PickerSheet } from '../components/PickerSheet.tsx'
import { ProfileStepLayout } from '../components/ProfileStepLayout.tsx'
import { ValueRow } from '../components/ValueRow.tsx'
import {
  HEIGHT_DEFAULT_CM,
  HEIGHT_OPTIONS,
  WEIGHT_DEFAULT_KG,
  WEIGHT_OPTIONS,
  createBodyDraft,
} from '../body.ts'
import type { BodyDraft } from '../body.ts'
import { resolveInitialValue } from '../pickerOptions.ts'
import { finishProfile } from '../profileFlow.ts'
import { profileStore } from '../profileStore.ts'
import { PROFILE_ROUTES, resolveProfileNextPath } from '../routes.ts'
import { useStepBack } from '../useStepBack.ts'

// 키·몸무게 입력 화면 (Figma PROFILE / Body, 3/3, 선택).
// 선택 상태는 이 화면의 draft로만 들고 있다. 프로필 가입은 이 화면의 마지막 버튼을 눌렀을 때만 완료된다. (finishProfile)
// - "시작하기": draft를 검증해 저장한 뒤 가입을 완료한다.
// - "건너뛰기": draft를 버리고 이미 저장된 값은 그대로 둔 채 가입을 완료한다.
// 시트에서 "완료"를 누르면 draft에만 반영된다. 완료에 성공했을 때만 다음 화면으로 이동한다.
// 이동할 곳은 resolveNextPath로 받는다. 생략하면 임시 경로(resolveProfileNextPath)이며, 온보딩 완료 처리는 이 화면에서 하지 않는다. (Issue #42 D-2)

export interface BodyScreenProps {
  // 가입을 완료한 뒤 이동할 경로. 누르는 시점에 부른다.
  resolveNextPath?: () => string
}

type SheetKind = 'height' | 'weight'

export function BodyScreen({ resolveNextPath = resolveProfileNextPath }: BodyScreenProps) {
  const navigate = useNavigate()
  // 이미 저장된 값이 있으면 그 값에서 시작한다. 렌더링마다 읽지 않도록 처음 한 번만 읽는다.
  const [draft, setDraft] = useState<BodyDraft>(() => createBodyDraft(profileStore.getState().profile))
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const handleBack = useStepBack(PROFILE_ROUTES.demographics)
  const closeSheet = useCallback(() => setSheet(null), [])

  // 완료해 이동한 뒤에는 다시 실행하지 않는다. 빠르게 여러 번 눌러도 저장, 완료 기록, 이동은 한 번만 일어난다.
  const leavingRef = useRef(false)

  // 완료하지 못하면(선택 범위 밖의 값, 필수 동의나 닉네임 없음) 이동하지 않고 이 화면에 머문다.
  function finish(bodyDraft: BodyDraft | null) {
    if (leavingRef.current) return
    if (finishProfile(profileStore.getState(), bodyDraft)) {
      leavingRef.current = true
      navigate(resolveNextPath(), { replace: true })
    }
  }

  function handleStart() {
    finish(draft)
  }

  function handleSkip() {
    finish(null)
  }

  function handleConfirm(value: number) {
    // 열려 있던 시트에 맞는 항목만 바꾼다. 다른 항목의 draft는 그대로 둔다.
    setDraft((current) => (sheet === 'height' ? { ...current, heightCm: value } : { ...current, weightKg: value }))
    setSheet(null)
  }

  return (
    <>
      <ProfileStepLayout
        step={3}
        required={false}
        title={
          <>
            키와 몸무게를
            <br />
            알려주세요.
          </>
        }
        description="소모 칼로리와 보폭 추정에 써요."
        onBack={handleBack}
        ctaLabel="시작하기"
        onCta={handleStart}
        onSkip={handleSkip}
      >
        <ValueRow label="키" hint="선택 항목" value={draft.heightCm} unit="cm" onClick={() => setSheet('height')} />
        <div className="h-px bg-[#dedee5]" />
        <ValueRow label="몸무게" hint="선택 항목" value={draft.weightKg} unit="kg" onClick={() => setSheet('weight')} />
        <div className="h-px bg-[#dedee5]" />

        <p className="mt-[28px] text-[15px] font-normal leading-[23px] text-[#626174]">
          둘 다 입력하지 않아도 시작할 수 있어요.
          <br />
          입력한 정보는 마이의 프로필에서
          <br />
          언제든 고치거나 지울 수 있어요.
        </p>

        <div className="mt-[28px] flex items-start gap-[12px]">
          <img src={shieldCheck} alt="" aria-hidden="true" className="size-[22px] shrink-0" />
          <p className="min-w-0 flex-1 text-[14px] font-normal leading-[21px] text-[#626174]">선택한 값을 확인한 뒤에만 저장돼요.</p>
        </div>
      </ProfileStepLayout>

      {sheet === 'height' && (
        <PickerSheet
          title="키"
          options={HEIGHT_OPTIONS}
          initialValue={resolveInitialValue(draft.heightCm, HEIGHT_OPTIONS, HEIGHT_DEFAULT_CM)}
          unit="cm"
          onConfirm={handleConfirm}
          onClose={closeSheet}
        />
      )}
      {sheet === 'weight' && (
        <PickerSheet
          title="몸무게"
          options={WEIGHT_OPTIONS}
          initialValue={resolveInitialValue(draft.weightKg, WEIGHT_OPTIONS, WEIGHT_DEFAULT_KG)}
          unit="kg"
          onConfirm={handleConfirm}
          onClose={closeSheet}
        />
      )}
    </>
  )
}

export default BodyScreen
