import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NicknameField, NicknameSuggestions } from '../components/NicknameField.tsx'
import { ProfileStepLayout } from '../components/ProfileStepLayout.tsx'
import { getNicknameFeedback, submitNickname } from '../nickname.ts'
import { profileStore } from '../profileStore.ts'
import { PROFILE_ROUTES } from '../routes.ts'
import { useStepBack } from '../useStepBack.ts'

// 닉네임 입력 화면 (Figma PROFILE / Nickname, 1/3, 필수).
// 입력값은 이 화면의 draft로만 들고 있다가, "다음"을 눌렀을 때만 submitNickname으로 Store에 저장한다.
export function NicknameScreen() {
  const navigate = useNavigate()
  // 이미 저장된 닉네임이 있으면 그 값에서 시작한다. 렌더링마다 읽지 않도록 처음 한 번만 읽는다.
  const [value, setValue] = useState(() => profileStore.getState().profile.nickname)
  const feedback = getNicknameFeedback(value)
  const handleBack = useStepBack(PROFILE_ROUTES.consent)

  // 저장에 성공한 뒤에는 다시 실행하지 않는다. 빠르게 여러 번 눌러도 저장과 이동은 한 번만 일어난다.
  const submittedRef = useRef(false)

  function handleNext() {
    if (submittedRef.current) return
    if (submitNickname(profileStore.getState(), value)) {
      submittedRef.current = true
      navigate(PROFILE_ROUTES.demographics)
    }
  }

  return (
    <ProfileStepLayout
      step={1}
      required
      title={
        <>
          뭐라고
          <br />
          불러드릴까요?
        </>
      }
      description="러닝 안내와 기록에 표시돼요."
      onBack={handleBack}
      ctaLabel="다음"
      ctaDisabled={!feedback.canSubmit}
      onCta={handleNext}
    >
      <NicknameField value={value} onChange={setValue} feedback={feedback} onEnter={handleNext} />
      <NicknameSuggestions onSelect={setValue} />
    </ProfileStepLayout>
  )
}

export default NicknameScreen
