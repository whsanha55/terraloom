"use client";

import { Pause, Play, SkipForward, Eye } from "lucide-react";
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
  /** Watch Mode (§25) — 다음 중요 사건까지 자동 재생 → 자동 정지 반복 */
  watchMode: boolean;
  onWatchModeChange: (enabled: boolean) => void;
  /** 자동 정지 임계(중요도) — 설정에서 조절 (§25) */
  majorThreshold: number;
  onMajorThresholdChange: (threshold: number) => void;
}

/** 시간 제어 패널 (§25 상단 그룹의 Step 10 버전 — Watch Mode 포함) */
export function TimeControls({
  summary,
  onSetSpeed,
  onStep,
  watchMode,
  onWatchModeChange,
  majorThreshold,
  onMajorThresholdChange,
}: TimeControlsProps) {
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

      <label className="flex items-center gap-xs" aria-label="관찰 모드">
        <button
          type="button"
          data-testid="watch-mode-toggle"
          aria-pressed={watchMode}
          onClick={() => onWatchModeChange(!watchMode)}
          className={
            watchMode
              ? "flex items-center gap-xs rounded-md bg-primary px-md py-xs text-sm font-medium text-on-primary"
              : "flex items-center gap-xs rounded-md border border-border bg-surface px-md py-xs text-sm text-text-muted hover:bg-accent hover:text-text"
          }
        >
          <Eye size={14} aria-hidden />
          관찰 모드
        </button>
      </label>
      <label className="flex items-center gap-xs text-sm text-text-muted">
        <span className="whitespace-nowrap">자동 정지 임계</span>
        <select
          data-testid="major-threshold"
          value={majorThreshold}
          onChange={(e) => onMajorThresholdChange(Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-sm py-xs text-text"
          aria-label="자동 정지 임계(중요도)"
        >
          <option value={80}>중요도 80+</option>
          <option value={70}>중요도 70+</option>
          <option value={60}>중요도 60+</option>
        </select>
      </label>
    </div>
  );
}
