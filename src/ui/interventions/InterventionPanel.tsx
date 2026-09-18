"use client";

import { useState } from "react";
import { HandHeart } from "lucide-react";
import { INTERVENTION_TYPES } from "@/simulation/systems/interventions";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";

export interface InterventionLogEntry {
  id: string;
  ok: boolean;
  description: string;
  tick: number;
}

interface InterventionPanelProps {
  settlements: Array<{ id: string; name: string; status: "active" | "ruined" }>;
  interventionPoints: number;
  currentTick: number;
  log: InterventionLogEntry[];
  onIntervene: (intervention: {
    id: string;
    tick: number;
    type: string;
    targetIds: string[];
    parameters: Record<string, number | string | boolean>;
  }) => void;
}

const TYPES = ["foodAid", "disasterResponse", "migrationPolicy", "tradePriority", "irrigation", "triggerEvent"] as const;

/** 개입 패널 (§24 / Step 14) — 비용·효과 설명·기록 표시 */
export function InterventionPanel({
  settlements,
  interventionPoints,
  currentTick,
  log,
  onIntervene,
}: InterventionPanelProps) {
  const [type, setType] = useState<(typeof TYPES)[number]>("foodAid");
  const [targetId, setTargetId] = useState("");
  const [months, setMonths] = useState(3);
  const [openness, setOpenness] = useState(1);
  const [priority, setPriority] = useState(1);
  const [templateId, setTemplateId] = useState("drought");

  const active = settlements.filter((s) => s.status === "active");
  const effectiveTarget = active.some((s) => s.id === targetId) ? targetId : (active[0]?.id ?? "");
  const definition = INTERVENTION_TYPES[type];
  const costPreview =
    type === "foodAid" && definition ? definition.baseCost * months : (definition?.baseCost ?? 0);

  const handleRun = () => {
    if (!effectiveTarget) return;
    const parameters: Record<string, number | string | boolean> = {};
    if (type === "foodAid") parameters.months = months;
    if (type === "migrationPolicy") parameters.openness = openness;
    if (type === "tradePriority") parameters.priority = priority;
    if (type === "triggerEvent") parameters.templateId = templateId;
    onIntervene({
      id: `itv:${type}:${currentTick}:${log.length + 1}`,
      tick: currentTick,
      type,
      targetIds: [effectiveTarget],
      parameters,
    });
  };

  return (
    <section
      data-testid="intervention-panel"
      aria-label="개입"
      className="rounded-lg border border-border bg-surface p-md shadow-panel"
    >
      <div className="flex flex-wrap items-baseline gap-md">
        <h2 className="text-sm font-semibold text-text">개입 (What-if 실험)</h2>
        <span className="font-numeric tnum text-sm text-text-muted">
          예산 <span data-testid="intervention-points">{interventionPoints.toLocaleString("ko-KR")}</span> ·
          개입 비용 <span className="font-numeric tnum">{costPreview}</span>
        </span>
      </div>

      <div className="mt-sm flex flex-wrap items-end gap-md">
        <label className="min-w-0">
          <span className="mb-xs block text-sm text-text-muted">개입 종류</span>
          <select
            data-testid="intervention-type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
            className="rounded-md border border-border bg-surface px-md py-sm text-sm text-text"
          >
            {TYPES.map((item) => (
              <option key={item} value={item}>
                {INTERVENTION_TYPES[item]?.label ?? item}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-xs block text-sm text-text-muted">대상 도시</span>
          <select
            data-testid="intervention-target"
            value={effectiveTarget}
            onChange={(e) => setTargetId(e.target.value)}
            className="rounded-md border border-border bg-surface px-md py-sm text-sm text-text"
          >
            {active.map((settlement) => (
              <option key={settlement.id} value={settlement.id}>
                {settlement.name}
              </option>
            ))}
          </select>
        </label>

        {type === "foodAid" && (
          <label>
            <span className="mb-xs block text-sm text-text-muted">지원 개월</span>
            <input
              type="number"
              min={1}
              max={12}
              value={months}
              onChange={(e) => setMonths(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              data-testid="intervention-months"
              className="w-20 rounded-md border border-border bg-surface px-md py-sm font-numeric tnum text-sm text-text"
            />
          </label>
        )}
        {type === "migrationPolicy" && (
          <label>
            <span className="mb-xs block text-sm text-text-muted">개방도 ({openness.toFixed(1)})</span>
            <input
              type="range"
              min={0.2}
              max={1.8}
              step={0.1}
              value={openness}
              onChange={(e) => setOpenness(Number(e.target.value))}
              className="accent-primary"
            />
          </label>
        )}
        {type === "tradePriority" && (
          <label>
            <span className="mb-xs block text-sm text-text-muted">우선순위 ({priority.toFixed(1)})</span>
            <input
              type="range"
              min={0.2}
              max={1.8}
              step={0.1}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="accent-primary"
            />
          </label>
        )}
        {type === "triggerEvent" && (
          <label className="min-w-0">
            <span className="mb-xs block text-sm text-text-muted">사건</span>
            <select
              data-testid="intervention-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-md border border-border bg-surface px-md py-sm text-sm text-text"
            >
              {BUILTIN_TEMPLATES.filter((t) => t.kind === "effect" && t.scope === "settlement").map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          data-testid="intervention-run"
          onClick={handleRun}
          disabled={!effectiveTarget || interventionPoints < costPreview}
          className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-sm font-medium text-on-primary hover:bg-blue-700 disabled:opacity-50"
        >
          <HandHeart size={14} aria-hidden />
          개입 실행
        </button>
      </div>

      <p className="mt-sm text-sm text-text-muted">
        개입 없이 계속 관찰할 수도 있습니다 — 개입 후 스냅숏 분기 비교로 효과를 수치로 확인하세요 (§2.3)
      </p>

      {log.length > 0 && (
        <ul data-testid="intervention-log" className="mt-sm max-h-36 space-y-xs overflow-y-auto">
          {[...log].reverse().map((entry) => (
            <li
              key={entry.id}
              className={
                entry.ok
                  ? "rounded-md bg-accent px-md py-xs text-sm text-text"
                  : "rounded-md bg-[#FFF7ED] px-md py-xs text-sm text-warning"
              }
            >
              {entry.ok ? (
                <>
                  <span className="font-numeric tnum text-text-muted">
                    {Math.floor(entry.tick / 12) + 1}년 {(entry.tick % 12) + 1}월
                  </span>{" "}
                  — {entry.description}
                </>
              ) : (
                <>적용 실패 — {entry.description}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
