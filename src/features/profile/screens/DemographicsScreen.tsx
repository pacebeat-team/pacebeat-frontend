import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GenderChoice } from '../components/GenderChoice.tsx'
import { PickerSheet } from '../components/PickerSheet.tsx'
import { ProfileStepLayout } from '../components/ProfileStepLayout.tsx'
import { ValueRow } from '../components/ValueRow.tsx'
import {
  BIRTH_YEAR_DEFAULT,
  createDemographicsDraft,
  getBirthYearOptions,
  getCurrentYear,
  submitDemographics,
} from '../demographics.ts'
import type { DemographicsDraft } from '../demographics.ts'
import { resolveInitialValue } from '../pickerOptions.ts'
import { profileStore } from '../profileStore.ts'
import { PROFILE_ROUTES } from '../routes.ts'
import type { Gender } from '../types.ts'
import { useStepBack } from '../useStepBack.ts'

// 출생연도·성별 입력 화면 (Figma PROFILE / Demographics, 2/3, 선택).
// 선택 상태는 이 화면의 draft로만 들고 있다가, "다음"을 눌렀을 때만 submitDemographics로 Store에 저장한다.
// 시트에서 "완료"를 누르면 draft에만 반영되고, "건너뛰기"는 draft를 버리고 Store를 그대로 둔 채 이동한다.
export function DemographicsScreen() {
  const navigate = useNavigate()
  // 이미 저장된 값이 있으면 그 값에서 시작한다. 렌더링마다 읽지 않도록 처음 한 번만 읽는다.
  const [draft, setDraft] = useState<DemographicsDraft>(() => createDemographicsDraft(profileStore.getState().profile))
  const [sheetOpen, setSheetOpen] = useState(false)
  const handleBack = useStepBack(PROFILE_ROUTES.nickname)

  // 화면을 연 시점의 현재 연도로 선택지를 만든다. (연도가 바뀐 뒤 다시 열면 상한이 갱신된다.)
  const [currentYear] = useState(getCurrentYear)
  const yearOptions = useMemo(() => getBirthYearOptions(currentYear), [currentYear])
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  // 저장하거나 건너뛰어 이동한 뒤에는 다시 실행하지 않는다. 빠르게 여러 번 눌러도 이동은 한 번만 일어난다.
  const leavingRef = useRef(false)

  function handleNext() {
    if (leavingRef.current) return
    if (submitDemographics(profileStore.getState(), draft, currentYear)) {
      leavingRef.current = true
      navigate(PROFILE_ROUTES.body)
    }
  }

  function handleSkip() {
    if (leavingRef.current) return
    leavingRef.current = true
    navigate(PROFILE_ROUTES.body)
  }

  function handleConfirmYear(year: number) {
    setDraft((current) => ({ ...current, birthYear: year }))
    setSheetOpen(false)
  }

  function handleGenderChange(gender: Gender) {
    setDraft((current) => ({ ...current, gender }))
  }

  return (
    <>
      <ProfileStepLayout
        step={2}
        required={false}
        title={
          <>
            나이와 성별을
            <br />
            알려주세요.
          </>
        }
        description="소모 칼로리 계산에만 써요."
        onBack={handleBack}
        ctaLabel="다음"
        onCta={handleNext}
        onSkip={handleSkip}
      >
        <ValueRow label="출생연도" hint="선택 항목" value={draft.birthYear} unit="년" onClick={() => setSheetOpen(true)} />
        <div className="h-px bg-[#dedee5]" />
        <p className="mt-[10px] text-[13px] font-normal leading-[20px] text-[#626174]">생년월일 대신 출생연도만 입력해요.</p>

        <p className="mt-[30px] text-[16px] font-medium leading-[24px] text-[#111111]">성별</p>
        <div className="mt-[12px]">
          <GenderChoice value={draft.gender} onChange={handleGenderChange} />
        </div>

        <div className="mt-[32px] h-px bg-[#dedee5]" />
        <p className="mt-[24px] text-[16px] font-medium leading-[24px] text-[#111111]">왜 필요한가요?</p>
        <p className="mt-[8px] text-[15px] font-normal leading-[23px] text-[#626174]">
          칼로리는 나이·성별·체중으로 계산해요.
          <br />
          입력하지 않으면 칼로리 대신
          <br />
          거리와 시간만 보여 드려요.
        </p>
      </ProfileStepLayout>

      {sheetOpen && (
        <PickerSheet
          title="출생연도"
          options={yearOptions}
          initialValue={resolveInitialValue(draft.birthYear, yearOptions, BIRTH_YEAR_DEFAULT)}
          unit="년"
          onConfirm={handleConfirmYear}
          onClose={closeSheet}
        />
      )}
    </>
  )
}

export default DemographicsScreen
