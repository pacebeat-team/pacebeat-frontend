import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import splashVideo from '../assets/videos/splash-original.mp4'
import splashPoster from '../assets/videos/splash-poster.png'
import { getEntryPath } from '../lib/entryPath'
import { useOnboardingStore } from '../stores/onboardingStore'

export function SplashPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasNavigatedRef = useRef(false)
  const [step, setStep] = useState<'video' | 'logo'>('video')

  // Splash 02에서만 호출한다. 이동 시점의 온보딩 진행 상태로 첫 화면을 정한다.
  const handleNavigateToEntry = useCallback(() => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    navigate(getEntryPath(useOnboardingStore.getState()), { replace: true })
  }, [navigate])

  const handleVideoEnded = useCallback(() => {
    // 1단계(영상 재생) 완료 시 피그마 명세에 따라 2단계(SPLASH / 02 완성형 로고)로 전환
    setStep('logo')
  }, [])

  const handleClick = useCallback(() => {
    // Splash 01에서는 이동하지 않고 Splash 02로만 넘긴다. Splash 02에서는 기다리지 않고 바로 이동한다.
    if (step === 'video') {
      setStep('logo')
      return
    }
    handleNavigateToEntry()
  }, [step, handleNavigateToEntry])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // 브라우저 autoplay 정책 대응 (muted 보장)
    video.muted = true
    video.defaultMuted = true

    const playPromise = video.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay 차단 또는 미디어 오류 시 즉시 로고 단계로 fallback
        setStep('logo')
      })
    }
  }, [])

  useEffect(() => {
    if (step === 'logo') {
      // 피그마 인터랙션 명세: SPLASH / 02 표시 후 0.8초 대기 후 다음 화면으로 전환
      const timer = setTimeout(() => {
        handleNavigateToEntry()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [step, handleNavigateToEntry])

  return (
    <div
      onClick={handleClick}
      className="relative w-full h-full flex-1 flex items-center justify-center bg-[#FEFEFE] cursor-pointer select-none"
      role="button"
      tabIndex={0}
      aria-label="스플래시 화면"
    >
      {step === 'video' ? (
        <div className="w-[100px] h-[100px] flex items-center justify-center transition-opacity duration-300">
          <video
            ref={videoRef}
            src={splashVideo}
            poster={splashPoster}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={handleVideoEnded}
            onError={handleVideoEnded}
            className="w-full h-full object-contain"
            aria-label="P!PACE 스플래시 인트로 영상"
          />
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2.5 transition-all duration-300 animate-in fade-in">
          <img
            src={splashPoster}
            alt="P!PACE Mascot"
            className="w-[48px] h-[48px] object-contain"
          />
          <span className="text-[32px] font-black tracking-tight text-neutral-950 font-sans">
            P!PACE
          </span>
        </div>
      )}
    </div>
  )
}

export default SplashPage
