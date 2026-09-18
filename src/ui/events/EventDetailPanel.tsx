"use client";

import type { EventDetailData } from "@/simulation/events/detail";

/** 확률 퍼센트 — tnum으로 흔들림 없이 (DESIGN.md 수치 규칙) */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 사건 상세 패널 (§27) — 원인 → 영향 → 조건부 확률 */
export function EventDetailPanel({
  detail,
  onClose,
}: {
  detail: EventDetailData | null;
  onClose: () => void;
}) {
  if (!detail) {
    return (
      <section aria-label="사건 상세" className="rounded-lg border border-border bg-surface p-md shadow-panel">
        <h2 className="text-sm font-semibold text-text">사건 상세</h2>
        <p className="mt-xs text-sm text-text-muted">타임라인에서 사건을 선택하면 상세가 나타납니다</p>
      </section>
    );
  }

  return (
    <section
      data-testid="event-detail"
      aria-label="사건 상세"
      className="rounded-lg border border-border bg-surface p-md shadow-panel"
    >
      <div className="flex items-baseline justify-between gap-md">
        <h2 className="text-base font-bold text-text">
          {detail.name}
          <span className="ml-sm text-sm font-normal text-text-muted">
            {detail.status === "active" ? "진행 중" : "종료"}
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
      <p className="mt-xs text-sm text-text-muted">{detail.description}</p>
      <dl className="mt-sm grid grid-cols-2 gap-x-md gap-y-xs text-sm">
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">발생 시점</dt>
          <dd className="font-numeric tnum text-text">
            세계력 {Math.floor(detail.startedTick / 12) + 1}년 {(detail.startedTick % 12) + 1}월
          </dd>
        </div>
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">발생 위치</dt>
          <dd className="text-text">{detail.targetName}</dd>
        </div>
        <div className="flex justify-between gap-sm">
          <dt className="text-text-muted">중요도</dt>
          <dd className="font-numeric tnum text-text">{detail.importance}</dd>
        </div>
        {detail.endedTick !== null && (
          <div className="flex justify-between gap-sm">
            <dt className="text-text-muted">종료 시점</dt>
            <dd className="font-numeric tnum text-text">
              세계력 {Math.floor(detail.endedTick / 12) + 1}년 {(detail.endedTick % 12) + 1}월
            </dd>
          </div>
        )}
      </dl>

      {detail.causalChain.length > 1 && (
        <div className="mt-sm">
          <h3 className="text-sm font-semibold text-text">인과 경로</h3>
          <p className="mt-xs text-sm text-text">{detail.causalChain.map((n) => n.name).join(" → ")}</p>
        </div>
      )}

      {detail.effects.length > 0 && (
        <div className="mt-sm">
          <h3 className="text-sm font-semibold text-text">직접 영향</h3>
          <ul className="mt-xs list-inside list-disc text-sm text-text">
            {detail.effects.map((effect) => (
              <li key={effect.label}>{effect.label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-sm">
        <h3 className="text-sm font-semibold text-text">발생 확률 근거</h3>
        {detail.evaluation ? (
          <div data-testid="probability-rationale" className="mt-xs text-sm">
            <p className="font-numeric tnum text-text">
              기본 {percent(detail.evaluation.baseProbability)}
              {detail.evaluation.modifiers.length > 0 && " ×"}
            </p>
            <ul className="mt-xs space-y-xs">
              {detail.evaluation.modifiers.map((modifier) => (
                <li key={modifier.source} className="flex items-baseline justify-between gap-md">
                  <span className="text-text-muted">{modifier.explanation}</span>
                  <span className="font-numeric tnum text-text">×{modifier.value}</span>
                </li>
              ))}
            </ul>
            <p className="mt-xs font-numeric tnum font-medium text-text">
              최종 {percent(detail.evaluation.finalProbability)} · 판정값{" "}
              {detail.evaluation.randomValue.toFixed(4)}
            </p>
          </div>
        ) : (
          <p className="mt-xs text-sm text-text-muted">
            통지형 사건 — 확률 판정 없이 임계값 통과로 기록되었습니다 (§12.4)
          </p>
        )}
      </div>

      {detail.followUps.length > 0 && (
        <div className="mt-sm">
          <h3 className="text-sm font-semibold text-text">예상 후속 사건</h3>
          <p className="mt-xs text-xs text-text-muted">현재 상태 기준 이번 달 조건부 확률 — 예측이 아닙니다 (§2.2)</p>
          <ul className="mt-xs space-y-xs text-sm">
            {detail.followUps.map((followUp) => (
              <li key={followUp.templateId} className="flex items-baseline justify-between gap-md">
                <span className="text-text">
                  {followUp.name}
                  {!followUp.eligible && <span className="text-text-muted"> (조건 미충족)</span>}
                </span>
                <span className="font-numeric tnum text-text">{percent(followUp.probability)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
