/**
 * LLM 연쇄 사건 추천 (Step 12) — 활성 사건 기반 후속 후보 생성.
 *
 * 부모 사건 + 대상 도시 + 주변(연결) 도시 상태를 문맥으로 전달하고,
 * 후보는 인과관계 검증(§20.4 — 부모 대상 또는 연결 도시만)을 통과한 뒤
 * 안전한 이벤트 DSL + 예정 후보(지연·만료·가중치)로 변환된다.
 * 실제 발생 확률은 규칙 엔진이 계산한다(§6/§13).
 */
import { clamp } from "@/simulation/core/numeric";
import { EVENT_EDITABLE_METRICS } from "@/simulation/events/metrics";
import {
  RecommendationResponseSchema,
  RecommendationSchema,
  type LLMRecommendation,
} from "../schemas/recommendation";
import { validateCandidate, type CandidateValidation } from "../validation/safety";
import { fnv1a32 } from "@/world/random/seed";
import { z } from "zod";
import type { WorldState } from "@/simulation/core/worldState";
import type { TemplateRegistry } from "@/simulation/events/effects";

export const CHAIN_PROMPT_VERSION = "llm-chain-v1";

export interface ChainSettlementSummary {
  id: string;
  population: number;
  foodMonthsRemaining: number;
  stability: number;
  migrationPressure: number;
  relation: "target" | "neighbor";
}

export interface ChainContextInput {
  parent: {
    eventId: string;
    templateId: string;
    name: string;
    targetId: string;
    targetName: string;
    startedTick: number;
    importance: number;
    effects: string[];
  };
  settlement: ChainSettlementSummary;
  nearby: ChainSettlementSummary[];
  recentHistory: Array<{ type: string; tick: number }>;
  allowedMetrics: string[];
}

export const ChainRecommendationSchema = RecommendationSchema.extend({
  suggestedMinDelayTicks: z.number().int().min(0).max(120),
  suggestedMaxDelayTicks: z.number().int().min(0).max(120),
  suggestedChainWeight: z.number().min(0.01).max(50),
});

export type ChainRecommendation = z.infer<typeof ChainRecommendationSchema>;

/** 연쇄 추천 응답 — recommendations 배열이 연쇄 필드를 포함한 형태로 바뀐다 */
export const ChainResponseSchema = RecommendationResponseSchema.extend({
  recommendations: z.array(ChainRecommendationSchema).min(3).max(5),
});

const DELAY_RANGE: [number, number] = [0, 36];
const CHAIN_WEIGHT_RANGE: [number, number] = [0.1, 5];

export function summarizeChainContext(
  state: WorldState,
  registry: TemplateRegistry,
  eventId: string,
): ChainContextInput | null {
  const event = state.activeEvents.find((e) => e.id === eventId);
  if (!event) return null;
  const template = registry.get(event.templateId);
  const settlement = state.settlements[event.targetId];
  if (!settlement) return null;

  const summarize = (id: string, relation: "target" | "neighbor"): ChainSettlementSummary | null => {
    const target = state.settlements[id];
    if (!target || target.status !== "active") return null;
    return {
      id: target.id,
      population: target.population,
      foodMonthsRemaining: Number(target.foodMonthsRemaining.toFixed(2)),
      stability: Math.round(target.stability),
      migrationPressure: Number(target.migrationPressure.toFixed(2)),
      relation,
    };
  };

  const nearby: ChainSettlementSummary[] = [];
  for (const neighborId of settlement.connectedSettlementIds) {
    const summary = summarize(neighborId, "neighbor");
    if (summary) nearby.push(summary);
  }

  const effects = template
    ? [
        ...template.ongoingEffects.map((e) => `${e.targetMetric} ×${e.value}`),
        ...template.immediateEffects.map((e) => `${e.targetMetric} ${e.operation === "add" ? "+" : "×"}${e.value}`),
      ]
    : [];

  const targetSummary = summarize(event.targetId, "target");
  if (!targetSummary) return null;

  return {
    parent: {
      eventId: event.id,
      templateId: event.templateId,
      name: template?.name ?? event.templateId,
      targetId: event.targetId,
      targetName: settlement.name,
      startedTick: event.startedTick,
      importance: event.importance,
      effects,
    },
    settlement: targetSummary,
    nearby: nearby.slice(0, 5),
    recentHistory: state.eventHistory
      .slice(-6)
      .reverse()
      .map((record) => ({ type: `${record.templateId}_occurred`, tick: record.startedTick })),
    // 연쇄 후보도 정착지 스코프 — 부모 효과에 route.*이 있어도 제안 목록에는 담지 않는다 (§20.2)
    allowedMetrics: [...new Set([...(template ? template.ongoingEffects.map((e) => e.targetMetric) : []), "settlement.stability", "settlement.migrationPressure", "settlement.diseaseLevel", "settlement.foodProduction"])].filter((metric) =>
      EVENT_EDITABLE_METRICS.has(metric),
    ),
  };
}

export function computeChainContextHash(ctx: ChainContextInput): string {
  const canonical = JSON.stringify({
    p: [ctx.parent.templateId, ctx.parent.targetId, ctx.parent.startedTick],
    s: [ctx.settlement.id, ctx.settlement.population, ctx.settlement.stability, ctx.settlement.foodMonthsRemaining],
    n: ctx.nearby.map((s) => [s.id, s.stability, s.foodMonthsRemaining]),
    h: ctx.recentHistory.map((e) => [e.type, e.tick]),
  });
  return fnv1a32(canonical).toString(16);
}

export function buildChainRecommendationPrompt(ctx: ChainContextInput): string {
  const nearby = ctx.nearby
    .map((s) => `- ${s.id} (이웃): 인구 ${s.population}, 식량잔여 ${s.foodMonthsRemaining}개월, 안정도 ${s.stability}`)
    .join("\n");
  const history = ctx.recentHistory.map((e) => `- ${e.type} (틱 ${e.tick})`).join("\n");
  return `당신은 세계 시뮬레이션의 사건 기획자입니다. [프롬프트 버전 ${CHAIN_PROMPT_VERSION}]

진행 중인 사건:
- ${ctx.parent.name} (중요도 ${ctx.parent.importance}, 틱 ${ctx.parent.startedTick} 시작)
- 대상: ${ctx.parent.targetName} (${ctx.parent.targetId})
- 효과: ${ctx.parent.effects.length > 0 ? ctx.parent.effects.join(", ") : "없음"}

대상 도시:
- ${ctx.settlement.id}: 인구 ${ctx.settlement.population}, 식량잔여 ${ctx.settlement.foodMonthsRemaining}개월, 안정도 ${ctx.settlement.stability}, 이주압력 ${ctx.settlement.migrationPressure}

주변 도시:
${nearby.length > 0 ? nearby : "- 없음"}

최근 역사:
${history.length > 0 ? history : "- 기록 없음"}

이 사건에서 파생될 수 있는 후속 사건 후보 3~5개를 추천하세요.

규칙:
1. 후보는 인과관계가 성립하는 도시만 대상으로 할 수 있습니다 — 대상 도시 또는 주변(연결) 도시.
2. 오직 아래 허용 메트릭만 효과로 수정할 수 있습니다:
${ctx.allowedMetrics.map((metric) => `   - ${metric}`).join("\n")}
3. 안정도 -15~15, 질병 -0.2~0.2, 이주 압력 -0.3~0.3, 생산 배율 0.5~1.5 범위 내에서 제안하세요.
4. 연쇄 지연은 0~36틱, 연쇄 가중치는 0.1~5로 제안하세요.

출력 JSON 형식 (다른 필드 금지):
{
  "recommendations": [
    {
      "temporaryId": "candidate_1",
      "name": "후속 사건 이름",
      "category": "natural | health | social | economic",
      "summary": "한 줄 설명",
      "scope": "settlement",
      "targetIds": ["도시id"],
      "preconditions": [],
      "suggestedBaseProbability": 0.05,
      "suggestedDurationTicks": 6,
      "effects": [{ "targetMetric": "settlement.stability", "operation": "add", "value": -4 }],
      "followUps": [],
      "reasoningSummary": "이 사건에서 파생되는 이유",
      "suggestedMinDelayTicks": 2,
      "suggestedMaxDelayTicks": 8,
      "suggestedChainWeight": 1.5
    }
  ]
}

주의: 후보의 실제 발생 여부와 확률은 규칙 엔진이 계산합니다. 당신은 후보만 제안합니다.`;
}

export interface ChainScheduledSpec {
  targetId: string;
  minDelayTicks: number;
  maxDelayTicks: number;
  chainWeight: number;
  causedByEventId: string;
}

export interface ChainCandidateValidation extends CandidateValidation {
  scheduled: ChainScheduledSpec | null;
}

export function validateChainCandidate(
  recommendation: ChainRecommendation,
  ctx: ChainContextInput,
  registeredNames: ReadonlySet<string>,
): ChainCandidateValidation {
  // 인과관계 검증 (§20.4) — 부모 대상 또는 연결 이웃만 허용
  const causalIds = new Set([ctx.settlement.id, ...ctx.nearby.map((s) => s.id)]);
  for (const targetId of recommendation.targetIds) {
    if (!causalIds.has(targetId)) {
      return {
        template: null,
        scheduled: null,
        warnings: [],
        rejected: `인과관계 위반 — ${targetId}은(는) ${ctx.parent.name}의 영향 범위 밖입니다`,
      };
    }
  }

  const base = validateCandidate(recommendation as unknown as LLMRecommendation, chainContextAsInput(ctx), registeredNames);
  if (base.rejected || !base.template) {
    return { ...base, scheduled: null };
  }

  const warnings = [...base.warnings];
  const minDelay = clamp(recommendation.suggestedMinDelayTicks, DELAY_RANGE[0], DELAY_RANGE[1]);
  const maxDelay = clamp(
    Math.max(recommendation.suggestedMaxDelayTicks, minDelay),
    DELAY_RANGE[0],
    DELAY_RANGE[1],
  );
  if (minDelay !== recommendation.suggestedMinDelayTicks || maxDelay !== recommendation.suggestedMaxDelayTicks) {
    warnings.push(`연쇄 지연 ${recommendation.suggestedMinDelayTicks}~${recommendation.suggestedMaxDelayTicks} → ${minDelay}~${maxDelay}틱 (0~36으로 보정)`);
  }
  const chainWeight = clamp(recommendation.suggestedChainWeight, CHAIN_WEIGHT_RANGE[0], CHAIN_WEIGHT_RANGE[1]);
  if (chainWeight !== recommendation.suggestedChainWeight) {
    warnings.push(`연쇄 가중치 ${recommendation.suggestedChainWeight} → ${chainWeight} (0.1~5로 보정)`);
  }

  return {
    template: base.template,
    warnings,
    rejected: undefined,
    scheduled: {
      targetId: recommendation.targetIds[0] ?? ctx.settlement.id,
      minDelayTicks: minDelay,
      maxDelayTicks: maxDelay,
      chainWeight,
      causedByEventId: ctx.parent.eventId,
    },
  };
}

/** 안전 검증 재사용을 위한 LLMInput 변환 */
function chainContextAsInput(ctx: ChainContextInput): import("./summary").LLMInput {
  return {
    world: {
      year: Math.floor(ctx.parent.startedTick / 12),
      season: "summer",
      globalPopulation: ctx.settlement.population,
      activeMajorEvents: [ctx.parent.templateId],
    },
    settlements: [ctx.settlement, ...ctx.nearby],
    recentHistory: ctx.recentHistory,
    allowedMetrics: ctx.allowedMetrics,
  };
}
