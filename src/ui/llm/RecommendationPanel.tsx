"use client";

import { Sparkles, Check } from "lucide-react";
import type { ChainGatewayCandidate, ChainGatewayResult, GatewayCandidate, GatewayResult } from "@/llm/gateway/gateway";

export type LLMAutomation = "manual" | "semi" | "auto";

interface RecommendationPanelProps {
  status: "idle" | "loading" | "ok" | "fallback";
  result: GatewayResult | null;
  approvedTemplateIds: Set<string>;
  providerMode: "mock" | "byok";
  onProviderModeChange: (mode: "mock" | "byok") => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  automation: LLMAutomation;
  onAutomationChange: (mode: LLMAutomation) => void;
  chainStatus: "idle" | "loading" | "ok" | "fallback";
  chainResult: ChainGatewayResult | null;
  chainParentName: string | null;
  onChainApprove: (candidate: ChainGatewayCandidate) => void;
  onRequest: () => void;
  onApprove: (candidate: GatewayCandidate) => void;
}

/** LLM 추천 패널 (§15/§21 — 추천 + 연쇄, 자동화 수준 선택) */
export function RecommendationPanel({
  status,
  result,
  approvedTemplateIds,
  providerMode,
  onProviderModeChange,
  apiKey,
  onApiKeyChange,
  automation,
  onAutomationChange,
  chainStatus,
  chainResult,
  chainParentName,
  onChainApprove,
  onRequest,
  onApprove,
}: RecommendationPanelProps) {
  return (
    <section
      data-testid="llm-panel"
      aria-label="LLM 이벤트 추천"
      className="rounded-lg border border-border bg-surface p-md shadow-panel"
    >
      <div className="flex flex-wrap items-center gap-md">
        <h2 className="text-sm font-semibold text-text">LLM 이벤트 추천</h2>
        <select
          data-testid="llm-provider-mode"
          value={providerMode}
          onChange={(e) => onProviderModeChange(e.target.value as "mock" | "byok")}
          className="rounded-md border border-border bg-surface px-sm py-xs text-sm text-text"
          aria-label="LLM 제공자"
        >
          <option value="mock">모의 제공자</option>
          <option value="byok">직접 입력 (BYOK)</option>
        </select>
        <select
          data-testid="llm-automation"
          value={automation}
          onChange={(e) => onAutomationChange(e.target.value as LLMAutomation)}
          className="rounded-md border border-border bg-surface px-sm py-xs text-sm text-text"
          aria-label="자동 승인 수준 (§21.2)"
        >
          <option value="manual">자동 승인 끔(수동)</option>
          <option value="semi">반자동 — 낮은 영향만 자동</option>
          <option value="auto">자동 — 검증된 후보 전부</option>
        </select>
        <button
          type="button"
          data-testid="llm-request-button"
          onClick={onRequest}
          disabled={status === "loading"}
          className="ml-auto flex items-center gap-xs rounded-md bg-primary px-md py-xs text-sm font-medium text-on-primary hover:bg-blue-700 disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden />
          {status === "loading" ? "요청 중…" : "추천 요청"}
        </button>
      </div>

      {providerMode === "byok" && (
        <label className="mt-sm block">
          <span className="text-sm text-text-muted">
            API 키 — 세션 메모리에만 유지되며 저장되지 않습니다 (§30)
          </span>
          <input
            type="password"
            data-testid="llm-api-key"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk-…"
            className="mt-xs w-full rounded-md border border-border bg-surface px-md py-sm text-sm text-text"
          />
        </label>
      )}

      {status === "fallback" && result?.error && (
        <p data-testid="llm-fallback" className="mt-sm rounded-md bg-[#FFF7ED] px-md py-sm text-sm text-warning">
          {result.error}
        </p>
      )}

      {status === "ok" && result && result.candidates.length === 0 && (
        <p className="mt-sm text-sm text-text-muted">지금 상태엔 제안이 없음</p>
      )}

      {result && result.candidates.length > 0 && (
        <ul data-testid="llm-candidates" className="mt-sm space-y-sm">
          {result.candidates.map((candidate) => {
            const template = candidate.validation.template;
            const approved = template ? approvedTemplateIds.has(template.id) : false;
            return (
              <li key={candidate.recommendation.temporaryId} className="rounded-md border border-border p-md">
                <div className="flex items-baseline justify-between gap-md">
                  <h3 className="text-sm font-semibold text-text">
                    {candidate.recommendation.name}
                    <span className="ml-sm font-normal text-text-muted">
                      {candidate.recommendation.category}
                    </span>
                  </h3>
                  <span className="font-numeric tnum text-sm text-text-muted">
                    기본 확률{" "}
                    {((template?.probability.base ?? 0) * 100).toFixed(1)}% · 지속{" "}
                    {template?.duration.minTicks ?? "?"}개월
                  </span>
                </div>
                <p className="mt-xs text-sm text-text">{candidate.recommendation.summary}</p>
                <p className="mt-xs text-sm text-text-muted">
                  대상: {candidate.recommendation.targetIds.join(", ")}
                </p>
                {candidate.validation.warnings.length > 0 && (
                  <ul className="mt-xs list-inside list-disc text-sm text-warning">
                    {candidate.validation.warnings.map((warning) => (
                      <li key={warning}>보정됨 — {warning}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-xs text-sm text-text-muted">{candidate.recommendation.reasoningSummary}</p>
                <div className="mt-sm flex items-center gap-sm">
                  {approved ? (
                    <span data-testid={`llm-approved-${template?.id}`} className="flex items-center gap-xs text-sm font-medium text-text">
                      <Check size={14} aria-hidden /> 등록됨 — 발생 여부는 규칙 엔진이 결정합니다
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onApprove(candidate)}
                      className="rounded-md border border-border bg-surface px-md py-xs text-sm font-medium text-text hover:bg-accent"
                    >
                      승인
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {chainParentName && (
        <div className="mt-lg border-t border-border pt-md">
          <h3 className="text-sm font-semibold text-text">
            연쇄 후보{chainParentName ? ` — ${chainParentName}에서 파생` : ""}
          </h3>
          {chainStatus === "loading" && <p className="mt-xs text-sm text-text-muted">요청 중…</p>}
          {chainStatus === "fallback" && chainResult?.error && (
            <p className="mt-xs rounded-md bg-[#FFF7ED] px-md py-sm text-sm text-warning">{chainResult.error}</p>
          )}
          {chainStatus === "ok" && chainResult && chainResult.candidates.length === 0 && (
            <p className="mt-xs text-sm text-text-muted">지금 상태엔 제안이 없음</p>
          )}
          {chainResult && chainResult.candidates.length > 0 && (
            <ul data-testid="llm-chain-candidates" className="mt-sm space-y-sm">
              {chainResult.candidates.map((candidate) => {
                const template = candidate.validation.template;
                const scheduled = candidate.validation.scheduled;
                const approved = template ? approvedTemplateIds.has(template.id) : false;
                return (
                  <li key={candidate.recommendation.temporaryId} className="rounded-md border border-border p-md">
                    <div className="flex items-baseline justify-between gap-md">
                      <h4 className="text-sm font-semibold text-text">{candidate.recommendation.name}</h4>
                      <span className="font-numeric tnum text-sm text-text-muted">
                        {scheduled?.minDelayTicks}~{scheduled?.maxDelayTicks}개월 후 · 가중치 ×
                        {scheduled?.chainWeight.toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-xs text-sm text-text">{candidate.recommendation.summary}</p>
                    <p className="mt-xs text-sm text-text-muted">
                      대상: {candidate.recommendation.targetIds.join(", ")}
                    </p>
                    {candidate.validation.warnings.length > 0 && (
                      <ul className="mt-xs list-inside list-disc text-sm text-warning">
                        {candidate.validation.warnings.map((warning) => (
                          <li key={warning}>보정됨 — {warning}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-sm flex items-center gap-sm">
                      {approved ? (
                        <span data-testid={`llm-approved-${template?.id}`} className="flex items-center gap-xs text-sm font-medium text-text">
                          <Check size={14} aria-hidden /> 후보 등록됨 — 발생 확률은 규칙 엔진이 계산합니다
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onChainApprove(candidate)}
                          className="rounded-md border border-border bg-surface px-md py-xs text-sm font-medium text-text hover:bg-accent"
                        >
                          후보로 등록
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
