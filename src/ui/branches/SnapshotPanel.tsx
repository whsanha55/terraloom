"use client";

import { GitBranch, RotateCcw, Save } from "lucide-react";
import type { BranchComparison, LLMPolicy } from "@/simulation/core/branch";

export interface SnapshotEntry {
  id: string;
  tick: number;
  branchId: string;
  label: string;
}

interface SnapshotPanelProps {
  snapshots: SnapshotEntry[];
  llmPolicy: LLMPolicy;
  onLLMPolicyChange: (policy: LLMPolicy) => void;
  lastSavedAt: number | null;
  onSave: () => void;
  onRefresh: () => void;
  onRestore: (snapshotId: string, asBranch: boolean) => void;
  comparison: BranchComparison | null;
  compareAId: string;
  compareBId: string;
  onCompareAChange: (id: string) => void;
  onCompareBChange: (id: string) => void;
  onCompare: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  totalPopulation: "총인구",
  totalFoodStock: "식량 재고",
  deaths: "사망(기아·질병·자연)",
  migrationOut: "이주(유출)",
  eventCount: "발생 사건 수",
  ruinedCities: "폐허 도시",
};

function tickLabel(tick: number): string {
  return `${Math.floor(tick / 12) + 1}년 ${(tick % 12) + 1}월`;
}

function elapsedLabel(at: number | null): string {
  if (at === null) return "기록 없음";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  return `${Math.floor(seconds / 60)}분 전`;
}

/** 스냅숏·분기 패널 (§25 하단 / §28~29) — 복원, 분기 생성, 두 역사 비교 */
export function SnapshotPanel({
  snapshots,
  llmPolicy,
  onLLMPolicyChange,
  lastSavedAt,
  onSave,
  onRefresh,
  onRestore,
  comparison,
  compareAId,
  compareBId,
  onCompareAChange,
  onCompareBChange,
  onCompare,
}: SnapshotPanelProps) {
  return (
    <section
      data-testid="snapshot-panel"
      aria-label="스냅숏과 분기"
      className="rounded-lg border border-border bg-surface p-md shadow-panel"
    >
      <div className="flex flex-wrap items-center gap-md">
        <h2 className="text-sm font-semibold text-text">스냅숏 · 분기</h2>
        <button
          type="button"
          data-testid="save-button"
          onClick={onSave}
          className="flex items-center gap-xs rounded-md border border-border px-md py-xs text-sm font-medium text-text hover:bg-accent"
        >
          <Save size={14} aria-hidden />
          수동 저장
        </button>
        <span data-testid="last-saved" className="font-numeric tnum text-sm text-text-muted">
          마지막 저장 {elapsedLabel(lastSavedAt)}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-md px-sm py-xs text-sm text-text-muted hover:bg-accent hover:text-text"
        >
          목록 갱신
        </button>
      </div>

      <label className="mt-sm flex flex-wrap items-center gap-sm text-sm text-text-muted">
        분기 생성 시 LLM 결과
        <select
          data-testid="llm-policy"
          value={llmPolicy}
          onChange={(e) => onLLMPolicyChange(e.target.value as LLMPolicy)}
          className="rounded-md border border-border bg-surface px-sm py-xs text-text"
          aria-label="LLM 결과 정책 (§23)"
        >
          <option value="reuse">재사용</option>
          <option value="fresh">새로 생성</option>
          <option value="off">규칙 기반만</option>
        </select>
      </label>

      {snapshots.length === 0 ? (
        <p className="mt-sm text-sm text-text-muted">스냅숏이 없습니다 — 시간을 진행하거나 저장하세요</p>
      ) : (
        <ul data-testid="snapshot-list" className="mt-sm max-h-44 overflow-y-auto rounded-md border border-border">
          {[...snapshots].reverse().map((snapshot) => (
            <li
              key={snapshot.id}
              className="flex flex-wrap items-baseline gap-md border-b border-border px-md py-xs text-sm last:border-b-0"
            >
              <span className="font-numeric tnum text-text">{tickLabel(snapshot.tick)}</span>
              <span className="text-text-muted">{snapshot.branchId}</span>
              <span className="rounded-full bg-accent px-sm text-xs text-text-muted">{snapshot.label}</span>
              <span className="ml-auto flex items-center gap-xs">
                <button
                  type="button"
                  onClick={() => onRestore(snapshot.id, false)}
                  className="flex items-center gap-xs rounded-md px-sm py-xs text-text-muted hover:bg-accent hover:text-text"
                  aria-label={`${tickLabel(snapshot.tick)} 복원`}
                >
                  <RotateCcw size={13} aria-hidden />
                  복원
                </button>
                <button
                  type="button"
                  data-testid={`branch-from-${snapshot.id}`}
                  onClick={() => onRestore(snapshot.id, true)}
                  className="flex items-center gap-xs rounded-md border border-border px-sm py-xs text-text hover:bg-accent"
                  aria-label={`${tickLabel(snapshot.tick)}에서 분기`}
                >
                  <GitBranch size={13} aria-hidden />
                  이 시점에서 분기
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-md border-t border-border pt-md">
        <h3 className="text-sm font-semibold text-text">두 역사 비교</h3>
        {snapshots.length < 2 ? (
          <p className="mt-xs text-sm text-text-muted">
            비교할 다른 분기가 없습니다 — 과거 시점에서 분기를 만들어보세요
          </p>
        ) : (
          <>
            <div className="mt-xs flex flex-wrap items-center gap-sm text-sm">
              <select
                data-testid="compare-a"
                value={compareAId}
                onChange={(e) => onCompareAChange(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-sm py-xs text-text"
                aria-label="비교 A 스냅숏"
              >
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    A: {snapshot.branchId} · {tickLabel(snapshot.tick)}
                  </option>
                ))}
              </select>
              <select
                data-testid="compare-b"
                value={compareBId}
                onChange={(e) => onCompareBChange(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-sm py-xs text-text"
                aria-label="비교 B 스냅숏"
              >
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    B: {snapshot.branchId} · {tickLabel(snapshot.tick)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="compare-button"
                onClick={onCompare}
                className="rounded-md bg-primary px-md py-xs text-sm font-medium text-on-primary hover:bg-blue-700"
              >
                비교
              </button>
            </div>
            {comparison && (
              <table data-testid="branch-comparison" className="mt-sm w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="py-xs font-medium">지표</th>
                    <th className="py-xs text-right font-medium">A ({comparison.a.branchId})</th>
                    <th className="py-xs text-right font-medium">B ({comparison.b.branchId})</th>
                    <th className="py-xs text-right font-medium">차이(A−B)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(comparison.metrics).map(([key, metric]) => (
                    <tr key={key} className="border-t border-border">
                      <td className="py-xs text-text">{METRIC_LABELS[key] ?? key}</td>
                      <td className="font-numeric tnum py-xs text-right text-text">
                        {metric.a.toLocaleString("ko-KR")}
                      </td>
                      <td className="font-numeric tnum py-xs text-right text-text">
                        {metric.b.toLocaleString("ko-KR")}
                      </td>
                      <td className="font-numeric tnum py-xs text-right text-text-muted">
                        {metric.diff > 0 ? "+" : ""}
                        {Math.round(metric.diff).toLocaleString("ko-KR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  );
}
