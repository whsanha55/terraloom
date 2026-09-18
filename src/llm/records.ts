/**
 * LLM 생성 기록과 승인 등록 (§23 / T12).
 *
 * 승인된 LLM 결과를 그대로 저장해 재실행 시 재사용한다(재호출 없음).
 * 늦은 응답 규칙: 요청 시점 입력 해시와 현재 해시가 다르면 폐기·재요청 —
 * 같은 출력이 다른 틱·분기에서 다른 결과를 내는 것을 방지한다.
 * BYOK 키는 어디에도 기록되지 않는다(§30).
 */
import { EventEngine } from "@/simulation/events/engine";
import type { EventTemplate } from "@/simulation/events/types";
import type { WorldState } from "@/simulation/core/worldState";
import { summarizeForLLM, computeInputHash } from "./gateway/summary";
import {
  computeChainContextHash,
  summarizeChainContext,
  type ChainScheduledSpec,
} from "./gateway/chain";
import { validateCandidate, registeredTemplateNames } from "./validation/safety";
import type { LLMRecommendation } from "./schemas/recommendation";

/** 토큰·비용 기록 (Step 12) — 추정치. BYOK 요금이 적용된 실측은 Step 12 범위 밖 */
export interface LLMUsage {
  promptTokens: number;
  outputTokens: number;
  estimatedCost?: number;
}

export interface ResolvedUsage {
  promptTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

/** 1K 토큰당 추정 단가(USD) — 참고용 상수 */
const ESTIMATED_COST_PER_1K_TOKENS = 0.0005;

function normalizeUsage(usage: LLMUsage | undefined): ResolvedUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    estimatedCost:
      usage.estimatedCost ??
      Number((((usage.promptTokens + usage.outputTokens) / 1000) * ESTIMATED_COST_PER_1K_TOKENS).toFixed(6)),
  };
}

export interface LLMGenerationRecord {
  id: string;
  createdAtTick: number;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  rawOutput: string;
  parsedOutput: unknown;
  validatedEventTemplateIds: string[];
  approvedBy: "user" | "automatic";
  appliedAtTick: number;
  branchId: string;
  registrationOrder: number;
  requestSnapshotId: string;
  usage?: ResolvedUsage;
}

export interface RegisterLLMPayload {
  template: EventTemplate;
  inputHash: string;
  rawOutput: string;
  provider: string;
  model: string;
  promptVersion: string;
  usage?: LLMUsage;
}

export interface RegisterChainPayload extends RegisterLLMPayload {
  scheduled: ChainScheduledSpec;
  approvedBy: "user" | "automatic";
}

export interface RegisterResult {
  ok: boolean;
  templateId?: string;
  reason?: string;
}

/** 현재 상태의 입력 해시 — 늦은 응답 판정 기준 */
export function computeCurrentInputHash(state: WorldState): string {
  return computeInputHash(summarizeForLLM(state));
}

/**
 * 사용자가 승인한 후보를 템플릿으로 등록한다 (Worker 내 실행 — §6:
 * LLM은 제안만 하고, 검증·등록은 규칙 엔진 측에서 수행된다).
 */
export function registerLLMTemplate(
  state: WorldState,
  eventEngine: EventEngine,
  payload: RegisterLLMPayload,
): RegisterResult {
  const currentHash = computeCurrentInputHash(state);
  if (payload.inputHash !== currentHash) {
    return {
      ok: false,
      reason: "늦은 응답 폐기 — 요청 이후 세계 상태가 변했습니다. 다시 추천을 요청하세요 (§23)",
    };
  }
  if (eventEngine.registry.has(payload.template.id)) {
    return { ok: false, reason: `이미 등록된 템플릿입니다: ${payload.template.id}` };
  }
  // 방어 심화 — 등록 시점에 안전 검증을 다시 통과시킨다 (§20)
  const summary = summarizeForLLM(state);
  const probe: LLMRecommendation = {
    temporaryId: "revalidate",
    name: payload.template.name,
    category: payload.template.category === "political" ? "social" : payload.template.category,
    summary: payload.template.descriptionTemplate,
    scope: "settlement",
    targetIds: summary.settlements.map((s) => s.id).slice(0, 1),
    preconditions: payload.template.preconditions.map((condition) => ({
      metric: condition.metric,
      operator: condition.operator === "between" ? "lt" : condition.operator,
      value: condition.value as number,
    })),
    suggestedBaseProbability: payload.template.probability.base,
    suggestedDurationTicks: payload.template.duration.minTicks,
    effects: [
      ...payload.template.immediateEffects,
      ...payload.template.ongoingEffects,
    ].map((effect) => ({
      targetMetric: effect.targetMetric,
      operation: effect.operation === "clamp" ? "add" : effect.operation,
      value: effect.value,
    })),
    followUps: [],
    reasoningSummary: "재검증",
  };
  const safety = validateCandidate(probe, summary, registeredTemplateNames(eventEngine.registry));
  if (safety.rejected) {
    return { ok: false, reason: `안전 검증 실패: ${safety.rejected}` };
  }
  try {
    eventEngine.registry.set(payload.template.id, payload.template);
    state.llmTemplates.push(payload.template); // 스냅숏·복원 대상(§23)
  } catch {
    return { ok: false, reason: "템플릿 등록 실패" };
  }

  const order = state.llmRecords.length + 1;
  const record: LLMGenerationRecord = {
    id: `llmrec:${state.clock.currentTick}:${order}`,
    createdAtTick: state.clock.currentTick,
    provider: payload.provider,
    model: payload.model,
    promptVersion: payload.promptVersion,
    inputHash: payload.inputHash,
    rawOutput: payload.rawOutput,
    parsedOutput: null,
    validatedEventTemplateIds: [payload.template.id],
    approvedBy: "user", // Step 11 — 추천 전용 모드: 수동 승인만
    appliedAtTick: state.clock.currentTick,
    branchId: "main",
    registrationOrder: order,
    requestSnapshotId: payload.inputHash,
    usage: normalizeUsage(payload.usage),
  };
  state.llmRecords.push(record);
  return { ok: true, templateId: payload.template.id };
}

/**
 * 승인된 연쇄 후보 등록 (Step 12) — 템플릿 등록 + 예정 후보(지연·만료·가중치) 등록.
 * 부모 사건이 종료돼 문맥 해시를 재현할 수 없으면 폐기한다(§23 늦은 응답).
 * 실제 발생 확률은 규칙 엔진이 계산한다 — 여기서는 후보만 만든다.
 */
export function registerChainTemplate(
  state: WorldState,
  eventEngine: EventEngine,
  payload: RegisterChainPayload,
): RegisterResult {
  const ctx = summarizeChainContext(state, eventEngine.registry, payload.scheduled.causedByEventId);
  if (!ctx) {
    return { ok: false, reason: "늦은 응답 폐기 — 근거 사건이 이미 종료되었습니다 (§23)" };
  }
  if (payload.inputHash !== computeChainContextHash(ctx)) {
    return { ok: false, reason: "늦은 응답 폐기 — 문맥이 변했습니다. 다시 추천을 요청하세요 (§23)" };
  }
  if (eventEngine.registry.has(payload.template.id)) {
    return { ok: false, reason: `이미 등록된 템플릿입니다: ${payload.template.id}` };
  }
  const result = registerLLMTemplate(state, eventEngine, {
    template: payload.template,
    inputHash: computeCurrentInputHash(state),
    rawOutput: payload.rawOutput,
    provider: payload.provider,
    model: payload.model,
    promptVersion: payload.promptVersion,
    usage: payload.usage,
  });
  if (!result.ok) return result;
  // approvedBy 갱신 — 연쇄 자동 등록은 "automatic" (§21.2)
  const record = state.llmRecords[state.llmRecords.length - 1];
  if (record) record.approvedBy = payload.approvedBy;

  const parent = state.activeEvents.find((e) => e.id === payload.scheduled.causedByEventId);
  state.scheduledEvents.push({
    id: `sch:${payload.scheduled.causedByEventId}:llm:${payload.template.id}`,
    templateId: payload.template.id,
    targetId: payload.scheduled.targetId,
    activateAtTick: state.clock.currentTick + payload.scheduled.minDelayTicks,
    expiresAtTick: state.clock.currentTick + payload.scheduled.maxDelayTicks,
    baseWeight: payload.scheduled.chainWeight,
    chainDepth: (parent?.chainDepth ?? 0) + 1,
    causedByEventId: payload.scheduled.causedByEventId,
    conditions: [],
  });
  return { ok: true, templateId: payload.template.id };
}
