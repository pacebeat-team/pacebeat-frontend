import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import runningMascot from '../../assets/images/mascot-running.png'
import { BottomNavigation } from '../../components/common/BottomNavigation'
import { BackHeader, Brand, PrimaryButton, StatusBar } from '../../components/running/RunningUI'
import { formatClock, formatPace } from '../../features/running/runningFormat'
import { type RunningTrack, useRunningStore } from '../../features/running/runningStore'

const TRACKS: { name: RunningTrack; bpm: number }[] = [
  { name: 'Morning Stride', bpm: 158 },
  { name: 'City Loop', bpm: 156 },
  { name: 'Easy Tempo', bpm: 160 },
  { name: 'Night Pace', bpm: 150 },
]

export function RunningMusicPage() {
  const navigate = useNavigate()
  const { track, previewingTrack, setTrack, setPreviewingTrack } = useRunningStore()
  return (
    <div className="flex h-full flex-col bg-[#FEFEFE]">
      <StatusBar />
      <main className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-7">
        <BackHeader title="음악 고르기" onBack={() => navigate('/running')} />
        <h1 className="mt-5 text-[34px] font-light leading-[44px] tracking-[-1.02px]">가볍게,<br />나의 리듬으로.</h1>
        <p className="mt-5 text-[15px] text-[#626174]">기준 케이던스&nbsp; <span className="font-poppins text-[18px] font-medium text-[#111]">158 spm</span></p>
        <div className="mt-6">
          {TRACKS.map(({ name, bpm }) => {
            const selected = track === name
            const previewing = previewingTrack === name
            return (
              <button
                type="button"
                key={name}
                data-testid={`track-${name.toLowerCase().replace(' ', '-')}`}
                onClick={() => { setTrack(name); setPreviewingTrack(previewing ? null : name) }}
                className="flex h-[73px] w-full items-center border-b border-[#D9D9E0] text-left"
              >
                <span className={`flex size-12 shrink-0 items-center justify-center rounded-full text-[23px] ${selected ? 'bg-[#B9FA32]' : 'bg-[#F4F4F6] text-[#747287]'}`}>{previewing ? 'Ⅱ' : '▷'}</span>
                <span className="ml-3 flex-1 font-poppins text-[18px] font-medium">{name}{previewing && <small className="mt-0.5 block font-sans text-[12px] font-normal text-[#626174]">15초 미리 듣기</small>}</span>
                <span className="text-right font-poppins text-[16px]">{bpm}<small className="block text-[12px] text-[#626174]">BPM</small></span>
              </button>
            )
          })}
        </div>
        <p className="mt-7 text-[13px] text-[#626174]">박자 자동 조절은 준비 중이에요.</p>
        <div className="mt-auto">
          <PrimaryButton testId="music-next" onClick={() => navigate('/running/ready')}>다음 · 준비 확인</PrimaryButton>
          <button type="button" onClick={() => { setTrack(null); navigate('/running/ready') }} className="mt-3 w-full text-[14px] text-[#747287]">음악 없이 달리기</button>
        </div>
      </main>
    </div>
  )
}

export function RunningReadyPage() {
  const navigate = useNavigate()
  const { distanceGoal, targetMinutes, track, startDemoRun } = useRunningStore()
  const pace = targetMinutes / distanceGoal
  return (
    <div className="flex h-full flex-col bg-[#FEFEFE]">
      <StatusBar />
      <main className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-7">
        <BackHeader title="출발 준비" onBack={() => navigate('/running/music')} />
        <h1 className="mt-5 text-[30px] font-light leading-[44px] tracking-[-0.9px]">달릴 준비가 됐어요.</h1>
        <div className="mt-4 flex h-[82px] items-center gap-3">
          <div className="flex-1 font-poppins"><span className="text-[56px] font-light leading-[64px]">{distanceGoal.toFixed(1)}</span><span className="ml-1.5 text-[19px]">km</span></div>
          <div className="w-[154px]"><div className="font-poppins text-[23px]">{targetMinutes}:00</div><div className="mt-1 text-[14px] text-[#626174]">목표 {formatPace(pace)} /km</div></div>
        </div>
        <div className="mt-4 space-y-1">
          {[['▥', 'GPS 신호', '양호 · 거리와 페이스를 기록할 수 있어요.'], ['♧', '이어폰과 볼륨', '연결됨 · 볼륨 60%'], ['◖))', '음성 안내', '켜짐 · 진동은 이 기기에서 지원하지 않아요.'], ['♧', '스마트 인솔', '연결 안 됨 · 인솔 없이도 달릴 수 있어요.']].map(([icon, title, copy]) => (
            <div key={title} className="flex min-h-[60px] items-center gap-3.5"><span className="w-[22px] text-center text-[20px]">{icon}</span><div><div className="text-[16px] font-medium">{title}</div><div className="mt-0.5 text-[13px] text-[#626174]">{copy}</div></div></div>
          ))}
        </div>
        <div className="mt-3 border-t border-[#D8D8DE] pt-5 text-[16px]">♪&nbsp;&nbsp;{track ?? '음악 없이 달리기'}{track && <span className="font-poppins"> · 158 BPM</span>}</div>
        <p className="mt-3 text-[13px] text-[#747287]">시작을 누르면 3초 후 러닝을 시작해요.</p>
        <div className="mt-auto">
          <PrimaryButton testId="ready-start" onClick={() => { startDemoRun(); navigate('/running/countdown') }}>러닝 시작</PrimaryButton>
          <p className="mt-3 text-center text-[14px] text-[#747287]">GPS 없이 시간만 기록</p>
        </div>
      </main>
    </div>
  )
}

export function RunningCountdownPage() {
  const navigate = useNavigate()
  const [count, setCount] = useState(3)
  useEffect(() => {
    const timer = window.setInterval(() => setCount((value) => value - 1), 800)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (count <= 0) navigate('/running/active', { replace: true })
  }, [count, navigate])
  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_50%_42%,#E6FFA0_0%,#C4FA3F_68%,#B6F12B_100%)]">
      <StatusBar />
      <div className="flex flex-1 flex-col items-center justify-center pb-20">
        <Brand />
        <div data-testid="countdown-value" className="mt-16 font-poppins text-[180px] font-light leading-none tracking-[-8px]">{Math.max(1, count)}</div>
        <p className="mt-10 text-[22px]">호흡을 고르고, 출발해요.</p>
      </div>
    </div>
  )
}

export function RunningActivePage() {
  const navigate = useNavigate()
  const { distanceGoal, elapsedSeconds, distanceKm, targetMinutes, tick } = useRunningStore()
  useEffect(() => {
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [tick])
  const progress = Math.min(100, Math.round((distanceKm / distanceGoal) * 100))
  const currentPace = distanceKm > 0 ? elapsedSeconds / 60 / distanceKm : targetMinutes / distanceGoal
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_46%_40%,#E5FFA1_0%,#C4FA3F_58%,#B1EF27_100%)]">
      <StatusBar />
      <main className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-[108px]">
        <Brand />
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3"><img src={runningMascot} alt="달리는 피페이스 캐릭터" className="h-[96px] w-[78px] object-contain" /><p className="text-[23px] leading-[34px]">목표 페이스로<br />달리고 있어요.</p></div>
          <button type="button" aria-label="음성 안내" className="size-12 rounded-full border border-white/90 bg-white/45 text-[22px]">◖))</button>
        </div>
        <div className="mt-2 font-poppins"><span className="text-[108px] font-light leading-[122px] tracking-[1px]">{distanceKm.toFixed(2)}</span><span className="ml-2 text-[38px] font-light">km</span></div>
        <div className="mt-2 flex justify-between text-[20px] font-medium"><span>목표 {distanceGoal.toFixed(1)} km</span><span className="font-poppins">{progress}%</span></div>
        <div className="relative mt-2 h-2 rounded-full bg-black/15"><div className="h-2 rounded-full bg-[#111]" style={{ width: `${progress}%` }} /><span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-[#111]" style={{ left: `calc(${progress}% - 6px)` }} /></div>
        <p className="mt-2 text-[16px]">{Math.max(0, distanceGoal - distanceKm).toFixed(2)} km 남았어요.</p>
        <div className="mt-7 grid grid-cols-2 divide-x divide-[#111]">
          <div><div className="text-[14px]">경과 시간</div><div className="mt-1 font-poppins text-[42px] leading-[58px]">{formatClock(elapsedSeconds)}</div></div>
          <div className="pl-7"><div className="text-[14px]">현재 페이스</div><div className="mt-1 font-poppins text-[42px] leading-[58px]">{formatPace(currentPace)} <span className="text-[20px]">/km</span></div></div>
        </div>
        <div className="mt-auto mx-auto flex h-[114px] w-[308px] items-center justify-center divide-x divide-[#111] rounded-full border border-white bg-white/35">
          <button type="button" data-testid="pause-run" onClick={() => navigate('/running/paused')} className="flex w-1/2 flex-col items-center gap-2"><span className="flex size-[70px] items-center justify-center rounded-full bg-white text-[28px]">Ⅱ</span><span>일시정지</span></button>
          <button type="button" onClick={() => navigate('/running/end')} className="flex w-1/2 flex-col items-center gap-2"><span className="flex size-[70px] items-center justify-center rounded-full bg-[#111] text-[24px] text-white">■</span><span>종료</span></button>
        </div>
      </main>
      <BottomNavigation />
    </div>
  )
}

export function RunningPausedPage() {
  const navigate = useNavigate()
  const { elapsedSeconds, distanceKm, distanceGoal } = useRunningStore()
  const averagePace = distanceKm > 0 ? elapsedSeconds / 60 / distanceKm : 0
  const remaining = Math.max(0, distanceGoal - distanceKm)
  const neededPace = remaining > 0 ? Math.max(0, ((distanceGoal * 7) - elapsedSeconds / 60) / remaining) : 0
  return (
    <div className="flex h-full flex-col bg-[#FEFEFE]"><StatusBar /><main className="flex flex-1 flex-col px-6 pt-3 pb-7"><Brand />
      <h1 className="mt-4 text-[36px] font-light leading-[44px] tracking-[-1.08px]">잠시 쉬어가요.</h1>
      <div className="mt-7 font-poppins text-[82px] font-light leading-[94px] tracking-[-2.46px]">{formatClock(elapsedSeconds)}</div>
      <p className="font-poppins text-[17px]">{distanceKm.toFixed(2)} km · 평균 {formatPace(averagePace)} /km</p>
      <div className="mt-10 grid grid-cols-2 gap-10"><div><p className="text-[13px]">남은 거리</p><p className="mt-1 font-poppins text-[35px] font-light">{remaining.toFixed(2)} <span className="text-[14px]">km</span></p></div><div><p className="text-[13px]">재개 후 필요 페이스</p><p className="mt-1 font-poppins text-[35px] font-light">{formatPace(neededPace)} <span className="text-[14px]">/km</span></p></div></div>
      <h2 className="mt-9 text-[23px]">러닝을 잠시 멈췄어요.</h2><p className="mt-3 text-[15px] text-[#626174]">준비되면 계속 달릴 수 있어요.</p><p className="mt-7 text-[15px] leading-7 text-[#626174]">목표 전에 끝내도<br />달린 만큼의 기록은 남아요.</p>
      <div className="mt-auto"><PrimaryButton testId="continue-run" onClick={() => navigate('/running/active')}>계속 달리기</PrimaryButton><button type="button" data-testid="open-end" onClick={() => navigate('/running/end')} className="mt-3 w-full text-[14px] text-[#747287]">종료하고 기록 확인</button></div>
    </main></div>
  )
}

export function RunningEndPage() {
  const navigate = useNavigate()
  const { distanceKm, resetRun } = useRunningStore()
  return (
    <div className="flex h-full flex-col bg-[#FEFEFE]"><StatusBar /><main className="flex flex-1 flex-col px-6 pt-3 pb-7"><BackHeader title="러닝 종료" onBack={() => navigate('/running/paused')} />
      <h1 className="mt-5 text-[34px] font-light leading-[44px] tracking-[-1.02px]">여기까지<br />기록할까요?</h1>
      <div className="mt-7 font-poppins"><span className="text-[72px] font-light leading-[83px] tracking-[-2.16px]">{distanceKm.toFixed(2)}</span><span className="ml-2 text-[24px]">km</span></div>
      <p className="mt-5 text-[22px] leading-[34px]">오늘 달린 만큼도<br />충분히 의미 있는 한 걸음이에요.</p><p className="mt-6 text-[14px] text-[#747287]">종료하면 이번 러닝을 다시 이어갈 수 없어요.</p>
      <div className="mt-auto"><PrimaryButton testId="confirm-end" onClick={() => { resetRun(); navigate('/records') }}>종료하고 기록 남기기</PrimaryButton><button type="button" onClick={() => navigate('/running/active')} className="mt-3 w-full text-[14px] text-[#747287]">아직 더 달릴게요</button></div>
    </main></div>
  )
}

