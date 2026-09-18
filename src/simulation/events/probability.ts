/**
 * 사건 발생 확률 (§13) — 계산과 결정론 판정.
 *
 * P(E) = clamp(P_base × M_condition × ... × M_cooldown, 0, P_max)
 * 모든 난수는 파생 시드(§7)로부터 나온다 — Math.random 금지.
 */
import { clamp } from "../core/numeric";
import { createRng } from "@/world/random/rng";
import { deriveSeed } from "@/world/random/seed";
import type { WorldState } from "../core/worldState";
import { evaluateCondition } from "./conditions";
import { resolveMetric, type MetricTarget } from "./metrics";
import type { EventTemplate, ProbabilityEvaluation, ProbabilityModifier } from "./types";

export interface ProbabilityComputation {
  baseProbability: number;
  modifiers: ProbabilityModifier[];
  finalProbability: number;
}

/** 조건 기반 확률 계산 — 충족된 인자만 곱하고 근거를 남긴다 (§13.1) */
export function computeProbability(
  state: WorldState,
  template: EventTemplate,
  target: MetricTarget,
): ProbabilityComputation {
  let probability = template.probability.base;
  const modifiers: ProbabilityModifier[] = [];
  for (const factor of template.probability.factors) {
    const value = resolveMetric(state, target, factor.condition.metric);
    if (evaluateCondition(factor.condition, value)) {
      probability *= factor.multiplier;
      modifiers.push({ source: factor.source, value: factor.multiplier, explanation: factor.explanation });
    }
  }
  const max = template.probability.max ?? 1;
  return {
    baseProbability: template.probability.base,
    modifiers,
    finalProbability: clamp(probability, 0, max),
  };
}

function eventRng(state: WorldState, purpose: string, templateId: string, targetId: string) {
  return createRng(
    deriveSeed({
      worldSeed: state.seed,
      simulationVersion: state.simulationVersion,
      tick: state.clock.currentTick,
      systemName: "event",
      entityId: targetId,
      purpose: `${purpose}:${templateId}`,
    }),
  );
}

/** 결정론적 확률 판정용 난수 [0,1) — purpose로 자연/연쇄 판정을 구분한다 */
export function rollEvent(
  state: WorldState,
  templateId: string,
  targetId: string,
  purpose = "roll",
): number {
  return eventRng(state, purpose, templateId, targetId).next();
}

/** 지속 기간 결정론 롤 — [minTicks, maxTicks] */
export function rollDuration(
  state: WorldState,
  template: EventTemplate,
  targetId: string,
): number {
  return eventRng(state, "duration", template.id, targetId).nextInt(
    template.duration.minTicks,
    template.duration.maxTicks + 1,
  );
}

/** 평가 완결 — 판정 포함 (§13.1 ProbabilityEvaluation) */
export function evaluateOccurrence(
  state: WorldState,
  template: EventTemplate,
  target: { kind: "settlement" | "route"; id: string },
): ProbabilityEvaluation {
  const computation = computeProbability(state, template, target);
  const randomValue = rollEvent(state, template.id, target.id);
  return {
    eventTemplateId: template.id,
    targetId: target.id,
    tick: state.clock.currentTick,
    baseProbability: computation.baseProbability,
    modifiers: computation.modifiers,
    finalProbability: computation.finalProbability,
    randomValue,
    occurred: randomValue < computation.finalProbability,
  };
}
