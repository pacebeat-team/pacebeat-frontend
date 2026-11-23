import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { MY_ROUTES } from '../../features/my/routes'
import { buildPostureReport, postureOneSidePath } from '../../features/posture/postureReport'
import type { PostureReportModel } from '../../features/posture/postureReport'
import { formatMonthDay } from '../../features/posture/fromRecords'
import { readPostureInputs, usePostureBack } from '../../features/posture/postureAccess'

// Figma `POSTURE / No data`: CTA는 고정 푸터가 아니라 본문 안에 있다.
function PostureNoData({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="성장" onBack={onBack} />
        <h2 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.02px]">자세 리포트</h2>
        <p className="mt-4 text-[30px] font-light leading-[36px] tracking-[-0.9px]">
          측정 기록이
          <br />
          아직 없어요.
        </p>
        <p className="mt-4 text-[16px] leading-[22px]">스마트 인솔을 연결한 뒤 달리면 지원되는 자세 데이터를 확인할 수 있어요.</p>
        <div className="mt-7">
          <PrimaryButton label="인솔 연결 확인" onClick={() => navigate(MY_ROUTES.device)} />
        </div>
      </div>
    </div>
  )
}

function PressureRow({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex h-16 items-center gap-3">
      <span className="w-[54px] shrink-0 text-[14px] leading-5">{label}</span>
      <div aria-hidden="true" className="h-[7px] min-w-0 flex-1 overflow-clip rounded-[4px] bg-soft">
        <div className="h-[7px] rounded-[4px] bg-lime" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-[60px] shrink-0 text-right text-[14px] font-medium leading-5">{percent}%</span>
    </div>
  )
}

const SIDE_LABEL = { left: '왼쪽', right: '오른쪽' } as const

// Figma `POSTURE / Report`. 모델에 값이 있는 구역만 그린다(값이 없으면 숨긴다).
function PostureReport({ model, onBack }: { model: PostureReportModel; onBack: () => void }) {
  const { balance, pressure, comparison, excluded } = model
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="자세 리포트" onBack={onBack} />
        <h2 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          좌우 밸런스를
          <br />
          살펴볼까요.
        </h2>
        <p className="mt-4 text-[14px] leading-5 text-muted">
          최근 {model.windowWeeks}주 · {model.measuredRuns}회 측정
        </p>

        {balance !== null && (
          <section className="mt-4 flex flex-col rounded-[32px] border border-solid border-[rgba(219,224,209,0.32)] bg-[linear-gradient(147deg,#000_22%,#1a1a1a_103%)] p-6 text-app-bg shadow-[inset_0_-5px_8px_rgba(0,0,0,0.65),inset_0_2px_3px_rgba(255,255,242,0.22)]">
            <h3 className="text-[18px] font-medium leading-[25px]">좌우 균형 비율</h3>
            <p className="mt-[18px] whitespace-nowrap text-[64px] font-light leading-[78px] tracking-[-1.92px]">
              {balance.left} : {balance.right}
            </p>
            <div aria-hidden="true" className="mt-5 flex h-4 overflow-clip rounded-[8px]">
              <div className="h-4 bg-app-bg" style={{ width: `${balance.left}%` }} />
              <div className="h-4 bg-lime" style={{ width: `${balance.right}%` }} />
            </div>
            <div className="mt-[10px] flex justify-between text-[14px] leading-5">
              <span>L {balance.left}%</span>
              <span>R {balance.right}%</span>
            </div>
            {model.rightAboveEven !== null && (
              <p className="mt-[18px] text-[14px] leading-5 opacity-[0.74]">
                오른쪽 비중 {balance.right}% · 균등한 50%보다 {model.rightAboveEven}%p 높아요.
              </p>
            )}
          </section>
        )}

        {pressure !== null && (
          <>
            <h3 className="mt-7 text-[20px] font-medium leading-[28px]">착지 압력 분포</h3>
            <div className="mt-2 flex flex-col">
              <PressureRow label="뒤꿈치" percent={pressure.heel} />
              <PressureRow label="중간" percent={pressure.mid} />
              <PressureRow label="앞꿈치" percent={pressure.forefoot} />
            </div>
          </>
        )}

        {comparison !== null && (
          <>
            <h3 className="mt-7 text-[20px] font-medium leading-[28px]">지난주와 비교</h3>
            <p className="mt-[10px] text-[24px] font-light leading-[29px]">
              오른쪽 비중 {comparison.previousRight}% → {comparison.currentRight}%
            </p>
            <p className="mt-2 text-[14px] leading-5 text-muted">측정 비중의 변화예요. 자세의 좋고 나쁨을 뜻하지 않아요.</p>
          </>
        )}

        {pressure !== null && model.heelDominant && (
          <>
            <h3 className="mt-7 text-[20px] font-medium leading-[28px]">이번 측정에서 보이는 점</h3>
            <p className="mt-[10px] text-[18px] font-medium leading-[25px]">뒤꿈치에 압력이 많이 모였어요.</p>
          </>
        )}

        {excluded !== null && (
          <>
            {(balance !== null || pressure !== null) && <div aria-hidden="true" className="mt-5 h-px w-full bg-line" />}
            <p className={`${balance !== null || pressure !== null ? 'mt-4' : 'mt-7'} text-[14px] leading-5 text-muted`}>
              {formatMonthDay(excluded.startedAt)}은 {SIDE_LABEL[excluded.side]}만 측정되어 좌우 비교에서 제외했어요.
            </p>
            <Link to={postureOneSidePath(excluded.recordId)} className="mt-3 flex h-[44px] w-full items-center justify-center text-[14px] leading-5 text-muted">
              한쪽만 측정된 상태 보기
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

// 자세 리포트: 최근 4주 안에 자세 요약이 있으면 Report, 없으면 No data. 예시 값은 어디에도 쓰지 않는다.
export function PosturePage() {
  const goBack = usePostureBack()
  const [now] = useState(() => Date.now())
  const model = useMemo(() => buildPostureReport(readPostureInputs(), now), [now])
  return model === null ? <PostureNoData onBack={goBack} /> : <PostureReport model={model} onBack={goBack} />
}

export default PosturePage
