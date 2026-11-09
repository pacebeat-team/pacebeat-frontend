import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import splashVideo from '../assets/videos/splash-original.mp4'
import splashPoster from '../assets/videos/splash-poster.png'

export function SplashPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasNavigatedRef = useRef(false)

  const handleNavigateToHome = useCallback(() => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    navigate('/home', { replace: true })
  }, [navigate])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // 브라우저 autoplay 정책(특히 iOS WebKit / 모바일 환경) 대응
    video.muted = true
    video.defaultMuted = true

    const playPromise = video.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // 브라우저 정책으로 autoplay가 차단되거나 오류 발생 시 fallback 이동
        handleNavigateToHome()
      })
    }
  }, [handleNavigateToHome])

  return (
    <div className="relative w-full max-w-[390px] h-dvh min-h-dvh mx-auto bg-black overflow-hidden flex items-center justify-center">
      <video
        ref={videoRef}
        src={splashVideo}
        poster={splashPoster}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={handleNavigateToHome}
        onError={handleNavigateToHome}
        className="w-full h-full object-cover"
        aria-label="P!PACE 스플래시 인트로 영상"
      />
    </div>
  )
}

export default SplashPage
