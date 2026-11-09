import { useNavigate } from 'react-router-dom'
import { BottomNavigation } from '../components/common/BottomNavigation'
import { Brand, PrimaryButton, StatusBar } from '../components/running/RunningUI'
import { formatPace } from '../features/running/runningFormat'
import { useRunningStore } from '../features/running/runningStore'

export function RunningPage() {
  const navigate = useNavigate()
  const { distanceGoal, targetMinutes, setDistanceGoal, setTargetMinutes } = useRunningStore()
  const pace = targetMinutes / distanceGoal

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#FEFEFE]">
      <StatusBar />
      <div className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-[112px]">
        <Brand />
        <h1 className="mt-4 text-[32px] font-light leading-[44px] tracking-[-0.96px]">어떻게 달릴까요?</h1>

        <section className="mt-4 rounded-[34px] bg-[radial-gradient(circle_at_70%_20%,#DFFF8E_0%,#C4FA3F_62%,#B4EF25_100%)] p-5 shadow-[0_8px_18px_rgba(86,110,23,0.18)]">
          <div className="grid grid-cols-3 gap-2">
            {[1, 3, 5].map((distance) => (
              <button
                type="button"
                key={distance}
                data-testid={`goal-${distance}`}
                onClick={() => setDistanceGoal(distance as 1 | 3 | 5)}
                className={`h-11 rounded-full font-poppins text-[16px] ${distanceGoal === distance ? 'bg-[#111] text-white' : 'bg-white/90 text-[#111]'}`}
              >
                {distance} km
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-baseline gap-2 font-poppins">
            <span className="text-[70px] font-light leading-[81px] tracking-[-2.1px]">{distanceGoal.toFixed(1)}</span>
            <span className="text-[24px]">km</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[15px] font-medium">완주 시간</span>
            <div className="flex items-center gap-3 font-poppins">
              <button type="button" aria-label="완주 시간 줄이기" onClick={() => setTargetMinutes(targetMinutes - 1)} className="size-11 rounded-full bg-white/90 text-[25px]">−</button>
              <span className="min-w-[70px] text-center text-[29px] font-medium">{targetMinutes}:00</span>
              <button type="button" aria-label="완주 시간 늘리기" onClick={() => setTargetMinutes(targetMinutes + 1)} className="size-11 rounded-full bg-white/90 text-[25px]">＋</button>
            </div>
          </div>
          <div className="mt-4 text-[17px] font-medium">목표 페이스&nbsp; <span className="font-poppins">{formatPace(pace)} /km</span></div>
        </section>

        <p className="mt-4 text-[15px] font-medium">내 기존보다 20초 빠른 목표예요.</p>
        <p className="mt-1 text-[13px] text-[#626174]">처음에는 22분부터 시작해도 좋아요.</p>
        <button type="button" onClick={() => setTargetMinutes(Math.round(distanceGoal * 22 / 3))} className="mt-3 text-[14px] text-[#747287]">추천 목표 3 km · 22:00으로 바꾸기</button>
        <div className="mt-auto">
          <PrimaryButton testId="goal-next" onClick={() => navigate('/running/music')}>다음 · 음악 고르기</PrimaryButton>
          <p className="mt-4 text-[14px] font-medium">최근 목표</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[15px] font-medium">
            <button type="button" onClick={() => { setDistanceGoal(3); setTargetMinutes(22) }} className="rounded-full bg-[#F3F3F5] py-3">3 km · 22:00</button>
            <button type="button" onClick={() => { setDistanceGoal(1); setTargetMinutes(7) }} className="rounded-full bg-[#F3F3F5] py-3">1 km · 7:30</button>
          </div>
        </div>
      </div>
      <BottomNavigation />
    </div>
  )
}

export default RunningPage


