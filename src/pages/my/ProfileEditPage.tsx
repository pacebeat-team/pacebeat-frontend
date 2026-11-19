import { useRef, useState } from 'react'
import { useStore } from 'zustand'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { NicknameField } from '../../features/profile/components/NicknameField'
import { getNicknameFeedback, submitNickname } from '../../features/profile/nickname'
import { profileStore } from '../../features/profile/profileStore'

// 마이 → 프로필. 가입을 마친 사용자가 닉네임을 고친다.
// 가입 흐름(/profile/...)은 ProfileStepGuard가 완료한 사용자를 돌려보내므로, 그 가드를 건드리지 않고 별도 경로에서 같은 닉네임 입력·검증을 쓴다.
export function ProfileEditPage() {
  const saved = useStore(profileStore, (state) => state.profile.nickname)
  const [value, setValue] = useState(saved)
  const feedback = getNicknameFeedback(value)
  const doneRef = useRef(false)

  const goBack = useMyBack(MY_ROUTES.root)

  const save = () => {
    if (doneRef.current) return
    if (submitNickname(profileStore.getState(), value)) {
      doneRef.current = true
      goBack()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="프로필" onBack={goBack} />
        <h2 className="mt-[14px] text-[34px] font-light leading-[44px] tracking-[-1.02px]">닉네임</h2>
        <div className="mt-[26px]">
          <NicknameField value={value} onChange={setValue} feedback={feedback} onEnter={() => feedback.canSubmit && value.trim() !== saved && save()} />
        </div>
      </div>
      <div className="shrink-0 px-3 pb-[9px] pt-2">
        <PrimaryButton label="저장" disabled={!feedback.canSubmit || value.trim() === saved} onClick={save} />
      </div>
    </div>
  )
}

export default ProfileEditPage
