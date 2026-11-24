import { Link } from "react-router-dom";
import chevronRight from "../../assets/icons/chevron-right.svg";
import type { ChartView } from "../../features/growth/growthView";

const CHART_HEIGHT = 102; // 눈금 0 ~ 맨 위 눈금 사이 (Figma 6.8px/km × 15km)

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
    // Figma `metric / …`: 위에 라벨(14/20, muted), 아래에 값(26/31)이며 단위는 값과 같은 크기의 한 줄이다. 간격 7px.
    <div className="flex flex-1 flex-col gap-[7px]">
      <p className="text-[14px] leading-5 text-muted">{label}</p>
      <p className="whitespace-nowrap text-[26px] font-light leading-[31px]">
        {value}
        {unit === "km" ? " " : ""}
        {unit}
      </p>
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
  large = false,
}: {
  chart: ChartView;
  label: string;
  // 주간 카드는 값이 더 커서(78px) 차트가 30px 아래에서 시작한다. 월간은 26px.
  large?: boolean;
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
      <div aria-hidden="true" className={`relative h-[154px] w-full ${large ? "mt-[30px]" : "mt-[26px]"}`}>
        {chart.guides.map((km, index) => (
          <div
            key={km}
            aria-hidden="true"
            className="absolute inset-x-0 flex h-4 items-center gap-2"
            style={{ top: 8 + ((top - index) * CHART_HEIGHT) / top }}
          >
            <span className="w-6 text-right text-[10px] leading-[14px] text-[#c4c5bf]">
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
