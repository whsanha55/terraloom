"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import type { SimSpeed, WorldSummary } from "@/workers/protocol";

const SEASON_LABELS: Record<WorldSummary["season"], string> = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};

const SPEEDS: Array<{ value: Exclude<SimSpeed, 0>; label: string }> = [
  { value: 1, label: "1x" },
  { value: 10, label: "10x" },
  { value: 100, label: "100x" },
  { value: "MAX", label: "MAX" },
];

interface TimeControlsProps {
  summary: WorldSummary;
  onSetSpeed: (speed: SimSpeed) => void;
  onStep: (ticks: 1 | 12) => void;
}

/** 시간 제어 패널 (§25 상단 그룹의 Step 5 버전) */
export function TimeControls({ summary, onSetSpeed, onStep }: TimeControlsProps) {
  const resumeSpeed: Exclude<SimSpeed, 0> = summary.speed === 0 ? 1 : summary.speed;

  return (
    <div className="mt-lg flex flex-wrap items-center gap-md rounded-md border border-border bg-accent p-md">
      <p data-testid="world-clock" className="font-numeric tnum font-medium text-text">
        세계력 {summary.year + 1}년 {summary.month + 1}월 ({SEASON_LABELS[summary.season]})
      </p>
      <p className="font-numeric tnum text-text-muted">
        인구{" "}
        <span data-testid="total-population">
          {summary.totalPopulation.toLocaleString("ko-KR")}
        </span>
      </p>
      <p className="font-numeric tnum text-text-muted">
        이주 <span data-testid="migration-total">{summary.migrationTotal}</span>명
      </p>

      <div className="ml-auto flex items-center gap-sm">
        <button
          type="button"
          onClick={() => onSetSpeed(summary.paused ? resumeSpeed : 0)}
          aria-label={summary.paused ? "재생" : "일시 정지"}
          className="flex items-center gap-xs rounded-md bg-primary px-md py-xs font-medium text-on-primary hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {summary.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          {summary.paused ? "재생" : "일시 정지"}
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          className="flex items-center gap-xs rounded-md border border-border bg-surface px-md py-xs text-text hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <SkipForward size={14} aria-hidden />
          1개월
        </button>
        <button
          type="button"
          onClick={() => onStep(12)}
          className="flex items-center gap-xs rounded-md border border-border bg-surface px-md py-xs text-text hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <SkipForward size={14} aria-hidden />
          1년
        </button>
      </div>

      <div
        role="group"
        aria-label="배속"
        className="flex overflow-hidden rounded-md border border-border"
      >
        {SPEEDS.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={summary.speed === item.value && !summary.paused}
            onClick={() => onSetSpeed(item.value)}
            className={
              summary.speed === item.value && !summary.paused
                ? "bg-primary px-md py-xs font-medium text-on-primary"
                : "px-md py-xs text-text-muted hover:bg-accent hover:text-text"
            }
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
