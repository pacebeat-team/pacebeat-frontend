import type { ReactNode } from 'react'
import toggleOff from '../../assets/my/toggle-off.svg'
import toggleOn from '../../assets/my/toggle-on.svg'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import {
  FREQUENCY_LABEL,
  GUIDANCE_FREQUENCIES,
} from '../../features/my/guidanceSettings'
import { guidanceSettingsStore, useGuidanceSettings } from '../../features/my/guidanceSettingsStore'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'

function RowText({ title, description }: { title: string; description: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
      <span className="text-[16px] font-medium leading-[24px] text-ink">{title}</span>
      <span className="text-[13px] leading-[19px] text-muted">{description}</span>
    </span>
  )
}

function Toggle({ on }: { on: boolean }) {
  return <img src={on ? toggleOn : toggleOff} alt="" aria-hidden="true" className="h-[28px] w-[44px] shrink-0" />
}

// 켜고 끌 수 있는 행
function SwitchRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-[76px] w-full cursor-pointer items-center gap-4"
    >
      <RowText title={title} description={description} />
      <Toggle on={checked} />
    </button>
  )
}

// 지금은 바꿀 수 없는 행(준비 중·미지원). 항상 꺼진 상태로 보여 주고 누를 수 없다.
function FixedOffRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-[76px] w-full items-center gap-4">
      <RowText title={title} description={description} />
      <button type="button" role="switch" aria-checked={false} disabled aria-label={title} className="shrink-0">
        <Toggle on={false} />
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-7 first:mt-4">
      <h2 className="text-[20px] font-medium leading-[28px]">{title}</h2>
      <div className="mt-[10px]">{children}</div>
    </section>
  )
}

// Figma `SETTINGS / Guidance`. 설정 값만 저장한다. 러닝 중 음성·박자·자동 일시정지에는 아직 연결하지 않는다.
export function GuidanceSettingsPage() {
  const goBack = useMyBack(MY_ROUTES.root)
  const settings = useGuidanceSettings((state) => state)
  const { setBeatGuide, setVoiceGuide, setFrequency, setAutoPause } = guidanceSettingsStore.getState()

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg px-6 pb-6 pt-3 font-pace text-ink [&>*]:shrink-0">
      <ScreenHeader title="마이" onBack={goBack} />
      <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">안내 설정</h1>

      <Section title="음악">
        <SwitchRow title="음악 박자 안내" description="목표에 맞는 박자의 곡을 골라요" checked={settings.beatGuide} onChange={setBeatGuide} />
        <div className="h-px bg-line" aria-hidden="true" />
        <FixedOffRow title="박자 자동 조절" description="준비 중 · 현재는 곡의 박자가 유지돼요" />
      </Section>

      <Section title="음성">
        <SwitchRow title="음성 안내" description="페이스가 벗어나면 말로 알려줘요" checked={settings.voiceGuide} onChange={setVoiceGuide} />
        <p className="mt-[14px] text-[14px] leading-[20px] text-muted" id="guidance-frequency">
          안내 빈도
        </p>
        <div role="group" aria-labelledby="guidance-frequency" className="mt-[10px] flex h-[44px] gap-3">
          {GUIDANCE_FREQUENCIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={settings.frequency === value}
              onClick={() => setFrequency(value)}
              className={`flex h-[44px] w-[106px] cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-[20px] text-ink ${settings.frequency === value ? 'bg-lime' : 'bg-soft'}`}
            >
              {FREQUENCY_LABEL[value]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="진동">
        <FixedOffRow title="진동 안내" description="이 기기에서는 지원되지 않아요" />
      </Section>

      <Section title="러닝">
        <SwitchRow title="자동 일시정지" description="멈추면 기록을 잠시 멈춰요" checked={settings.autoPause} onChange={setAutoPause} />
      </Section>
    </div>
  )
}

export default GuidanceSettingsPage
