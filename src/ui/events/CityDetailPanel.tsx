"use client";

import type { CityDetail } from "@/workers/protocol";
import { CAUSE_LABELS, crisisLevel, CRISIS_COLORS } from "@/ui/map/crisis";

export interface CitySeriesPoint {
  tick: number;
  population: number;
  foodStock: number;
}

function Sparkline({ values, color, testId }: { values: number[]; color: string; testId: string }) {
  if (values.length < 2) {
    return <p className="text-sm text-text-muted">시계열은 시간 진행 후 표시됩니다</p>;
  }
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
    <svg
      data-testid={testId}
      viewBox="0 0 100 28"
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="추이"
    >
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 도시 상세 (§27.4 요약본) — 요약 → 원인 분해(§2.1) → 시계열 → 활성 사건 */
export function CityDetailPanel({
  detail,
  series,
  onSelectEvent,
  onClose,
}: {
  detail: CityDetail | null;
  series: CitySeriesPoint[];
  onSelectEvent: (eventId: string) => void;
  onClose: () => void;
}) {
  if (!detail) {
    return (
      <section aria-label="도시 상세" className="rounded-lg border border-border bg-surface p-md shadow-panel">
        <h2 className="text-sm font-semibold text-text">도시 상세</h2>
        <p className="mt-xs text-sm text-text-muted">지도에서 도시를 클릭하면 상세가 나타납니다</p>
      </section>
    );
  }

  const totalChange = detail.causeBreakdown.reduce((sum, cause) => sum + cause.amount, 0);
  const maxAbs = Math.max(1, ...detail.causeBreakdown.map((c) => Math.abs(c.amount)));
  const crisis = crisisLevel(detail.foodMonthsRemaining);

  return (
    <section
      data-testid="city-detail"
      aria-label="도시 상세"
      className="rounded-lg border border-border bg-surface p-md shadow-panel"
    >
      <div className="flex items-baseline justify-between gap-md">
        <h2 className="text-base font-bold text-text">
          {detail.name}
          <span className="ml-sm text-sm font-normal text-text-muted">
            {detail.status === "ruined" ? "폐허" : "활성"}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-sm py-xs text-sm text-text-muted hover:bg-accent hover:text-text"
        >
          닫기
        </button>
      </div>

      <dl className="mt-sm grid grid-cols-2 gap-x-md gap-y-xs text-sm">
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">인구</dt>
          <dd className="font-numeric tnum text-text">{detail.population.toLocaleString("ko-KR")}</dd>
        </div>
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">식량 재고</dt>
          <dd className="font-numeric tnum text-text">
            <span style={{ color: CRISIS_COLORS[crisis] }}>{detail.foodMonthsRemaining.toFixed(1)}개월</span>
          </dd>
        </div>
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">안정도</dt>
          <dd className="font-numeric tnum text-text">{detail.stability.toFixed(0)}/100</dd>
        </div>
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">질병 수준</dt>
          <dd className="font-numeric tnum text-text">{(detail.diseaseLevel * 100).toFixed(0)}%</dd>
        </div>
      </dl>

      <div className="mt-sm">
        <h3 className="text-sm font-semibold text-text">인구 변화 원인 (최근 5년 · 원장 §8.3)</h3>
        {detail.causeBreakdown.length === 0 ? (
          <p className="mt-xs text-sm text-text-muted">기록된 변화가 없습니다</p>
        ) : (
          <ul data-testid="cause-breakdown" className="mt-xs space-y-xs">
            {detail.causeBreakdown.map((cause) => (
              <li key={cause.cause} className="flex items-center gap-sm text-sm">
                <span className="w-16 shrink-0 text-text-muted">{CAUSE_LABELS[cause.cause] ?? cause.cause}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-background">
                  <span
                    className={cause.amount < 0 ? "h-full bg-error" : "h-full bg-primary"}
                    style={{ width: `${(Math.abs(cause.amount) / maxAbs) * 100}%`, display: "block" }}
                  />
                </span>
                <span className="font-numeric tnum w-16 shrink-0 text-right text-text">
                  {cause.amount > 0 ? "+" : ""}
                  {cause.amount.toLocaleString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-xs font-numeric tnum text-sm text-text-muted">
          총변화 {totalChange > 0 ? "+" : ""}
          {totalChange.toLocaleString("ko-KR")}명
        </p>
      </div>

      <div className="mt-sm">
        <h3 className="text-sm font-semibold text-text">인구·식량 추이 (최근 관측)</h3>
        <Sparkline values={series.map((p) => p.population)} color="#2563EB" testId="city-chart-population" />
        <Sparkline values={series.map((p) => p.foodStock)} color="#0EA5E9" testId="city-chart-foodstock" />
      </div>

      {detail.activeEvents.length > 0 && (
        <div className="mt-sm">
          <h3 className="text-sm font-semibold text-text">활성 사건</h3>
          <ul className="mt-xs space-y-xs">
            {detail.activeEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(event.id)}
                  className="flex w-full items-baseline justify-between gap-md rounded-md px-sm py-xs text-sm hover:bg-accent"
                >
                  <span className="text-text">{event.name}</span>
                  <span className="font-numeric tnum text-text-muted">
                    진행 {Math.max(1, detail.currentTick - event.startedTick)}개월
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
