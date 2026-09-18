"use client";

import type { StatsPoint } from "@/workers/protocol";

interface SparklineProps {
  points: StatsPoint[];
  extract: (point: StatsPoint) => number;
  color: string;
  testId: string;
  label: string;
  formatValue: (value: number) => string;
}

function Sparkline({ points, extract, color, testId, label, formatValue }: SparklineProps) {
  if (points.length < 2) {
    return (
      <figure>
        <figcaption className="font-medium text-text">{label}</figcaption>
        <p className="mt-xs text-text-muted">기록이 없습니다 — 시간을 진행하면 채워집니다</p>
      </figure>
    );
  }
  const values = points.map(extract);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${28 - ((value - min) / range) * 26 - 1}`,
    )
    .join(" ");
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between">
        <span className="font-medium text-text">{label}</span>
        <span className="font-numeric tnum text-text-muted">
          {formatValue(values[values.length - 1]!)}
        </span>
      </figcaption>
      <svg
        data-testid={testId}
        viewBox="0 0 100 28"
        className="mt-xs h-14 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} 추이`}
      >
        <polyline
          points={coords}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

/** 세계 통계 미니 차트 (Step 6 — 인구·식량 재고) */
export function StatsChart({ history }: { history: StatsPoint[] }) {
  return (
    <div className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2">
      <Sparkline
        points={history}
        extract={(point) => point.totalPopulation}
        color="#2563EB"
        testId="chart-population"
        label="총인구"
        formatValue={(value) => value.toLocaleString("ko-KR")}
      />
      <Sparkline
        points={history}
        extract={(point) => point.totalFoodStock}
        color="#0EA5E9"
        testId="chart-foodstock"
        label="식량 재고"
        formatValue={(value) => Math.round(value).toLocaleString("ko-KR")}
      />
    </div>
  );
}
