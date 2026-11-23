import { Link } from "react-router-dom";
import chevronRight from "../../assets/icons/chevron-right.svg";
import heroArrow from "../../assets/home/hero-arrow.svg";
import type { ChartView } from "../../features/growth/growthView";

const CHART_HEIGHT = 102; // 눈금 0 ~ 맨 위 눈금 사이 (Figma 6.8px/km × 15km)

// TODO: 기록 화면의 StateCard(#61)와 같은 모양이다. #61이 합쳐진 뒤 공통 컴포넌트를 쓴다.
export function StateCard({
  title,
  body,
  to,
  actionLabel,
}: {
  title: string;
  body: string;
  to: string;
  actionLabel: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[24px] bg-soft p-6">
      <h2 className="text-[20px] font-semibold leading-7">{title}</h2>
      <p className="text-[14px] leading-5 text-muted">{body}</p>
      <Link
        to={to}
        className="mt-3 flex h-16 w-full items-center gap-3 rounded-full bg-ink py-[10px] pl-7 pr-3 text-[18px] font-medium leading-[25px] text-app-bg"
      >
        <span className="min-w-0 flex-1">{actionLabel}</span>
        <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-lime">
          <img
            src={heroArrow}
            alt=""
            aria-hidden="true"
            className="size-6 brightness-0"
          />
        </span>
      </Link>
    </section>
  );
}

export function Metric({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <p className="flex items-baseline gap-[6px] whitespace-nowrap">
        <span className="text-[28px] font-light leading-8">{value}</span>
        {unit !== undefined && (
          <span className="text-[13px] leading-[18px]">{unit}</span>
        )}
      </p>
      <p className="text-[13px] leading-[18px] text-muted">{label}</p>
    </div>
  );
}

export function LinkRow({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex h-16 w-full items-center gap-3">
      <span className="min-w-0 flex-1 text-[16px] leading-6">{label}</span>
      <img src={chevronRight} alt="" aria-hidden="true" className="size-5" />
    </Link>
  );
}

// 어두운 카드 안의 막대 차트. 값은 저장된 기록의 합계이다.
export function BarChart({
  chart,
  label,
}: {
  chart: ChartView;
  label: string;
}) {
  const top = chart.guides.length - 1;
  return (
    <>
      <ul aria-label={label} className="sr-only">
        {chart.bars.map((bar) => (
          <li key={bar.key}>
            {bar.label}{" "}
            {bar.valueText === null ? "거리 기록 없음" : `${bar.valueText} km`}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="relative mt-4 h-[154px] w-full">
        {chart.guides.map((km, index) => (
          <div
            key={km}
            aria-hidden="true"
            className="absolute inset-x-0 flex h-4 items-center gap-2"
            style={{ top: 8 + ((top - index) * CHART_HEIGHT) / top }}
          >
            <span className="w-6 text-right text-[11px] leading-4 text-[#c4c5bf]">
              {km}
            </span>
            <span className="h-px flex-1 bg-[rgba(219,224,209,0.2)]" />
          </div>
        ))}
        <div className="absolute inset-0 flex items-start justify-around pl-8">
          {chart.bars.map((bar) => (
            <div
              key={bar.key}
              className="flex min-w-0 max-w-10 flex-1 flex-col items-center"
            >
              <div
                className="relative w-full"
                style={{ height: CHART_HEIGHT + 16 }}
              >
                {bar.valueText !== null && (
                  <>
                    <span
                      className="absolute inset-x-0 text-center text-[13px] leading-[18px] text-app-bg"
                      style={{ bottom: bar.ratio * CHART_HEIGHT + 4 }}
                    >
                      {bar.valueText}
                    </span>
                    <span
                      className={`absolute bottom-0 w-full rounded-t-[8px] ${bar.highlight ? "bg-[linear-gradient(#c4fa40,#597517)]" : "bg-[linear-gradient(#404040,#1f1f1f)]"}`}
                      style={{ height: Math.max(2, bar.ratio * CHART_HEIGHT) }}
                    />
                  </>
                )}
              </div>
              <span className="mt-1 h-[18px] whitespace-nowrap text-[13px] leading-[18px] text-[#c4c5bf]">
                {bar.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
