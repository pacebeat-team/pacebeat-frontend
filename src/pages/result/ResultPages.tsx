import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import finishMascot from '../../assets/images/mascot-goal.png'
import { Brand, PrimaryButton, StatusBar } from '../../components/result/ResultUI'
import { formatClock, formatPace } from '../../features/result/resultFormat'
import { type ReflectionDifficulty, type ReflectionReason, useResultStore } from '../../features/result/resultStore'

const DIFFICULTIES: ReflectionDifficulty[] = ['쉬웠어요', '적당했어요', '힘들었어요']
const REASONS: ReflectionReason[] = ['숨이 참', '다리 피로', '지루함', '시간 부족']
const DEFAULT_REFLECTION = {
  difficulty: '적당했어요' as ReflectionDifficulty,
  reasons: ['숨이 참'] as ReflectionReason[],
  memo: '오늘의 페이스를 기억해요.',
}

const CONFETTI = [
  { key: 1, from: [42.22, 330.81, 55.55], to: [35, 258, 35], width: 16.378, color: '#C2F51F' },
  { key: 2, from: [106.45, 377.35, -62.57], to: [107.16, 290.45, -25], width: 13.649, color: '#FF59A6' },
  { key: 3, from: [323, 281, -45], to: [332.05, 223.43, -45], width: 16.378, color: '#C2F51F' },
  { key: 4, from: [344.35, 391, 25], to: [351, 296.43, 25], width: 13.649, color: '#C2F51F' },
  { key: 5, from: [83.13, 406.87, -40], to: [77.13, 332.87, -40], width: 10.919, color: '#FF59A6' },
  { key: 6, from: [294, 444.12, -20], to: [300.66, 349.56, -20], width: 12.284, color: '#C2F51F' },
]

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

function useDissolveNavigate() {
  const navigate = useNavigate()

  return (path: string) => {
    const transitionDocument = document as ViewTransitionDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (transitionDocument.startViewTransition && !reduceMotion) {
      transitionDocument.startViewTransition(() => navigate(path))
      return
    }

    navigate(path)
  }
}

function DifficultyChoices() {
  const { difficulty, setDifficulty } = useResultStore()

  return (
    <div className="grid h-11 grid-cols-3 gap-3">
      {DIFFICULTIES.map((item) => (
        <button
          type="button"
          key={item}
          onClick={() => setDifficulty(item)}
          className={`rounded-full text-[14px] font-medium leading-5 transition-colors ${difficulty === item ? 'bg-[#B7FA25]' : 'bg-[#F4F4F6]'}`}
        >
          {item}
        </button>
      ))}
    </div>
  )
}

function ReflectionSheet({ onClose }: { onClose: () => void }) {
  const storedReflection = useResultStore()
  const [visible, setVisible] = useState(false)
  const [difficulty, setDifficulty] = useState<ReflectionDifficulty>(storedReflection.difficulty ?? DEFAULT_REFLECTION.difficulty)
  const [reasons, setReasons] = useState<ReflectionReason[]>(storedReflection.reasons.length ? storedReflection.reasons : DEFAULT_REFLECTION.reasons)
  const [memo, setMemo] = useState(storedReflection.memo || DEFAULT_REFLECTION.memo)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const close = () => {
    setVisible(false)
    window.setTimeout(onClose, 150)
  }

  const toggleReason = (reason: ReflectionReason) => {
    setReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason])
  }

  const save = () => {
    storedReflection.saveReflection({ difficulty, reasons, memo })
    close()
  }

  return (
    <div className={`absolute inset-0 z-[80] transition-opacity duration-150 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`} role="dialog" aria-modal="true" aria-label="오늘 러닝 리포트">
      <button type="button" aria-label="리포트 닫기" onClick={close} className="absolute inset-0 bg-[#111]/32" />
      <section className="absolute inset-x-0 bottom-0 h-[724px] rounded-t-[28px] bg-[#FEFEFE] px-6 pt-6 pb-7">
        <div className="mx-auto h-1 w-9 rounded-full bg-[#DEDEE5]" />
        <h2 className="mt-5 text-[28px] font-medium leading-9">오늘 러닝 리포트</h2>
        <p className="mt-1 font-poppins text-[14px] leading-5 text-[#626174]">오늘의 러닝 리포트</p>

        <p className="mt-6 text-[16px] font-medium leading-[22px]">체감 난이도</p>
        <div className="mt-3 grid h-11 grid-cols-3 gap-3">
          {DIFFICULTIES.map((item) => (
            <button type="button" key={item} onClick={() => setDifficulty(item)} className={`rounded-full text-[14px] font-medium leading-5 ${difficulty === item ? 'bg-[#B7FA25]' : 'bg-[#F4F4F6]'}`}>
              {item}
            </button>
          ))}
        </div>

        <p className="mt-6 text-[16px] font-medium leading-[22px]">힘들었던 이유 · 선택</p>
        <div className="mt-3 grid h-11 grid-cols-4 gap-3">
          {REASONS.map((item) => (
            <button type="button" key={item} onClick={() => toggleReason(item)} className={`rounded-full text-[14px] font-medium leading-5 ${reasons.includes(item) ? 'bg-[#B7FA25]' : 'bg-[#F4F4F6]'}`}>
              {item}
            </button>
          ))}
        </div>

        <label className="mt-6 block text-[16px] font-medium leading-[22px]" htmlFor="result-memo">메모 · 선택</label>
        <textarea
          id="result-memo"
          value={memo}
          maxLength={100}
          onChange={(event) => setMemo(event.target.value)}
          className="mt-3 h-[72px] w-full resize-none rounded-2xl bg-[#F4F4F6] px-4 py-4 text-[16px] leading-6 outline-none focus:ring-2 focus:ring-[#B7FA25]"
        />
        <p className="mt-1.5 text-right font-poppins text-[13px] leading-[18px] text-[#626174]">{memo.length} / 100</p>
        <div className="mt-5"><PrimaryButton testId="save-reflection" onClick={save}>저장</PrimaryButton></div>
      </section>
    </div>
  )
}

function MetricSummary() {
  const metrics = [['3.00', '거리 · km'], ['21:12', '러닝 시간'], ['7:04', '페이스 · /km']]
  return (
    <div className="grid h-[70px] grid-cols-3 gap-3">
      {metrics.map(([value, label]) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <strong className="font-poppins text-[32px] font-semibold leading-[43px]">{value}</strong>
          <span className="text-[13px] leading-[18px] text-[#626174]">{label}</span>
        </div>
      ))}
    </div>
  )
}

function AchievementCard({ distance, duration, pace }: { distance: string; duration: string; pace: string }) {
  return (
    <section className="relative mt-5 h-[226px] shrink-0 overflow-hidden rounded-[34px] bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,224,0.38),transparent_55%),linear-gradient(150deg,#C7FB29_1%,#D8FF7F_99%)] p-6 shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]">
      <div className="flex h-[76px] items-baseline gap-1.5 font-poppins">
        <span className="text-[66px] font-light leading-[76px] tracking-[-1.98px]">{distance}</span>
        <span className="text-[22px] leading-[31px]">km</span>
      </div>
      <p className="text-[14px] leading-[22px]">목표 3.00 km · 21:00</p>
      <div className="mt-[18px] grid h-[62px] grid-cols-2 gap-[18px]">
        <div><p className="text-[13px] leading-[18px]">러닝 시간</p><p className="font-poppins text-[28px] leading-[34px]">{duration}</p></div>
        <div><p className="text-[13px] leading-[18px]">평균 페이스</p><p className="font-poppins text-[28px] leading-[34px]">{pace}</p></div>
      </div>
    </section>
  )
}

function FixedResultFooter({ onSave, testId }: { onSave: () => void; testId?: string }) {
  return (
    <footer className="h-[108px] shrink-0 bg-[#FEFEFE] px-3 pt-2 pb-[9px]">
      <PrimaryButton testId={testId} onClick={onSave}>저장하고 홈으로</PrimaryButton>
      <div className="mx-auto mt-4 h-[5px] w-[134px] rounded-full bg-[#111]" />
    </footer>
  )
}

export function ResultGoalPage({ initialReflectionOpen = false }: { initialReflectionOpen?: boolean }) {
  const dissolveNavigate = useDissolveNavigate()
  const [reflectionOpen, setReflectionOpen] = useState(initialReflectionOpen)
  const { reflectionSaved, difficulty, saveResult } = useResultStore()

  return (
    <div className="result-screen relative flex h-full flex-col overflow-hidden bg-[linear-gradient(102deg,#050505_0%,#1C1C1A_100%)]">
      <StatusBar dark />
      <section className="relative h-[354px] shrink-0 bg-[linear-gradient(144deg,#000_22%,#1A1A1A_103%)] px-6 pt-3 text-white">
        <Brand />
        <h1 className="mt-5 text-[38px] font-bold leading-[51px]">완주했어요!</h1>
        <p className="mt-5 text-[18px] font-medium leading-[26px]">지금처럼만 하면 돼요.</p>
      </section>

      <div className="pointer-events-none absolute left-[153px] top-[310px] z-10 h-[143px] w-[156px] bg-[radial-gradient(circle,#A7FF00_0%,rgba(167,255,0,0.28)_25%,transparent_68%)]" />
      <img
        src={finishMascot}
        alt="완주한 피페이스 캐릭터"
        className="result-mascot-reveal pointer-events-none absolute left-[158px] top-[199px] z-10 h-[223px] w-[169px] object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.25)]"
      />
      {CONFETTI.map((piece) => (
          <i
            key={piece.key}
            className="result-confetti-reveal pointer-events-none absolute z-10 block h-[6.824px] rounded-[1.365px]"
            style={{
              '--confetti-from-left': `${piece.from[0]}px`,
              '--confetti-from-top': `${piece.from[1]}px`,
              '--confetti-from-rotation': `${piece.from[2]}deg`,
              '--confetti-to-left': `${piece.to[0]}px`,
              '--confetti-to-top': `${piece.to[1]}px`,
              '--confetti-to-rotation': `${piece.to[2]}deg`,
              width: piece.width,
              backgroundColor: piece.color,
            } as CSSProperties}
          />
      ))}

      <main className="relative z-20 flex h-[446px] shrink-0 flex-col rounded-t-[28px] bg-[#FEFEFE] px-6 pt-[30px] pb-[14px]">
        <MetricSummary />
        <div className="mt-[18px] h-10">
          <div className="flex h-5 justify-between text-[14px] font-medium leading-[19px]"><span>거리 목표 달성</span><span className="font-poppins">100%</span></div>
          <div className="mt-2.5 h-1.5 rounded-full bg-[#C4FA3F]" />
        </div>
        <button type="button" onClick={() => dissolveNavigate('/result/details')} className="mt-[14px] flex h-9 items-center justify-between text-[14px] font-medium leading-[19px]"><span>구간별 기록 보기</span><span className="text-[27px] font-light leading-none">›</span></button>
        <button type="button" data-testid="open-reflection" onClick={() => setReflectionOpen(true)} className="mt-3 flex h-16 items-center gap-4 text-left">
          <span className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-[#B7FA25] text-[25px]">✎</span>
          <span><strong className="block text-[18px] font-semibold leading-6">러닝 리포트하기</strong><small className="mt-1.5 block text-[14px] leading-[19px] text-[#626174]">{reflectionSaved ? `${difficulty ?? '리포트'} · 저장됨` : '오늘 러닝은 어떠셨나요?'}</small></span>
        </button>
        <div className="mt-auto"><PrimaryButton testId="save-result" onClick={() => { saveResult(true); dissolveNavigate('/home') }}>저장하고 홈으로</PrimaryButton></div>
        <div className="mx-auto mt-3 h-[5px] w-[134px] rounded-full bg-[#111]" />
      </main>
      {reflectionOpen && <ReflectionSheet onClose={() => setReflectionOpen(false)} />}
    </div>
  )
}

export function ResultDetailsPage() {
  const dissolveNavigate = useDissolveNavigate()
  const saveResult = useResultStore((state) => state.saveResult)

  return (
    <div className="result-screen relative flex h-full flex-col bg-[#FEFEFE]">
      <StatusBar />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6">
        <Brand />
        <h1 className="mt-4 font-poppins text-[34px] font-light leading-[44px] tracking-[-1.02px]">3 km, 끝까지!</h1>
        <p className="mt-4 text-[15px] leading-6 text-[#626174]">거리 완주 · 목표 21:00보다 12초 더 달렸어요.</p>
        <AchievementCard distance="3.00" duration="21:12" pace="7:04" />

        <div className="mt-6 flex h-[52px] items-center justify-between"><span className="text-[16px] leading-6">목표 페이스 유지</span><span className="font-poppins text-[30px] font-light leading-9 tracking-[-0.9px]">82%</span></div>
        <p className="text-[13px] leading-[19px] text-[#626174]">목표 범위 안에서 달린 시간의 비율</p>
        <h2 className="mt-[22px] text-[17px] font-medium leading-6">구간별 페이스</h2>
        <div className="mt-2">
          {[['1 km', '6:58 /km'], ['2 km', '7:02 /km'], ['3 km', '7:12 /km']].map(([label, value]) => <div key={label} className="flex h-[42px] items-center justify-between"><span className="font-poppins text-[14px] leading-5 text-[#626174]">{label}</span><span className="font-poppins text-[16px] leading-[22px]">{value}</span></div>)}
        </div>

        <h2 className="mt-[18px] text-[19px] font-medium leading-[27px]">오늘 러닝은 어땠나요?</h2>
        <div className="mt-3"><DifficultyChoices /></div>
        <button type="button" onClick={() => dissolveNavigate('/home')} className="mt-[22px] flex h-16 w-full items-center gap-3 text-left">
          <span className="flex-1 text-[16px] leading-6">다음 목표</span>
          <span className="text-[14px] leading-[22px] text-[#626174]"><span className="font-poppins">3 km</span> · <span className="font-poppins">21:00</span> 한 번 더</span>
          <span className="text-[25px] font-light">›</span>
        </button>
      </main>
      <FixedResultFooter onSave={() => { saveResult(true); dissolveNavigate('/home') }} />
    </div>
  )
}

export function ResultPartialPage() {
  const dissolveNavigate = useDissolveNavigate()
  const saveResult = useResultStore((state) => state.saveResult)

  return (
    <div className="result-screen relative flex h-full flex-col bg-[#FEFEFE]">
      <StatusBar />
      <main className="min-h-0 flex-1 overflow-hidden px-6 pt-3 pb-6">
        <Brand />
        <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">오늘의 한 걸음.</h1>
        <p className="mt-4 text-[15px] leading-6 text-[#626174]">목표까지 1.58 km를 남기고 마쳤어요.</p>
        <AchievementCard distance="1.42" duration={formatClock(591)} pace={formatPace(591 / 60 / 1.42)} />

        <h2 className="mt-6 text-[17px] font-medium leading-6">구간별 페이스</h2>
        <div className="mt-2">
          {[['1 km', '6:58 /km'], ['마지막 0.42 km', '6:52 /km']].map(([label, value]) => <div key={label} className="flex h-[42px] items-center justify-between"><span className="text-[14px] leading-5 text-[#626174]">{label}</span><span className="font-poppins text-[16px] leading-[22px]">{value}</span></div>)}
        </div>

        <h2 className="mt-[18px] text-[19px] font-medium leading-[27px]">오늘 러닝은 어땠나요?</h2>
        <div className="mt-3"><DifficultyChoices /></div>
      </main>
      <FixedResultFooter testId="save-partial-result" onSave={() => { saveResult(false); dissolveNavigate('/home') }} />
    </div>
  )
}

