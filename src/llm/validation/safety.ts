/**
 * LLM 후보 안전 검증 (§20) — Event Safety Validator.
 *
 * 게이트웨이(UI)와 등록(Worker) 양쪽에서 같은 모듈을 쓴다(방어 심화).
 * - §20.2 허용 메트릭 목록 밖 효과 → 거부
 * - §20.3 수치 범위 위반 → 안전 범위로 보정 + 경고
 * - §20.4 존재하지 않는 도시 참조·중복 → 거부
 * 변환 규칙(§12.2.1): add 효과는 immediateEffects(영구), multiply는 ongoingEffects(수정자 스택).
 */
import { clamp } from "@/simulation/core/numeric";
import { EVENT_EDITABLE_METRICS, KNOWN_METRICS } from "@/simulation/events/metrics";
import type { EventEffect, EventTemplate } from "@/simulation/events/types";
import { fnv1a32 } from "@/world/random/seed";
import type { LLMRecommendation } from "../schemas/recommendation";
import type { LLMInput } from "../gateway/summary";

/** §20.3 — (메트릭, 연산)별 한 사건에서 허용되는 범위 */
const EFFECT_RANGES: Record<string, [number, number]> = {
  "settlement.foodProduction:multiply": [0.5, 1.5],
  "settlement.stability:add": [-15, 15],
  "settlement.diseaseLevel:add": [-0.2, 0.2],
  "settlement.migrationPressure:add": [-0.3, 0.3],
  "route.capacity:multiply": [0.3, 1.5],
};

const BASE_PROBABILITY_RANGE: [number, number] = [0.001, 0.05];
const DURATION_RANGE: [number, number] = [1, 36];

export interface CandidateValidation {
  template: EventTemplate | null;
  /** 보정 이력 — UI에 함께 표시된다 */
  warnings: string[];
  rejected?: string;
}

export function validateCandidate(
  recommendation: LLMRecommendation,
  input: LLMInput,
  registeredNames: ReadonlySet<string>,
): CandidateValidation {
  const warnings: string[] = [];

  if (registeredNames.has(recommendation.name)) {
    return { template: null, warnings, rejected: `중복 — '${recommendation.name}'은(는) 이미 등록된 사건입니다` };
  }
  const knownCities = new Set(input.settlements.map((s) => s.id));
  for (const targetId of recommendation.targetIds) {
    if (!knownCities.has(targetId)) {
      return { template: null, warnings, rejected: `존재하지 않는 도시 참조: ${targetId}` };
    }
  }
  for (const condition of recommendation.preconditions) {
    if (!KNOWN_METRICS.has(condition.metric)) {
      return { template: null, warnings, rejected: `조건 메트릭 허용 위반: ${condition.metric}` };
    }
  }

  const immediateEffects: EventEffect[] = [];
  const ongoingEffects: EventEffect[] = [];
  for (const effect of recommendation.effects) {
    if (!EVENT_EDITABLE_METRICS.has(effect.targetMetric)) {
      return {
        template: null,
        warnings,
        rejected: `허용 목록 밖 메트릭 효과: ${effect.targetMetric} (§20.2)`,
      };
    }
    const range = EFFECT_RANGES[`${effect.targetMetric}:${effect.operation}`];
    if (!range) {
      return {
        template: null,
        warnings,
        rejected: `허용되지 않는 효과 조합: ${effect.targetMetric} ${effect.operation} (§20.3)`,
      };
    }
    const clamped = clamp(effect.value, range[0], range[1]);
    if (clamped !== effect.value) {
      warnings.push(
        `${effect.targetMetric} ${effect.operation} ${effect.value} → ${clamped} (범위 ${range[0]}~${range[1]}로 보정, §20.3)`,
      );
    }
    const built: EventEffect = {
      targetMetric: effect.targetMetric,
      operation: effect.operation,
      value: clamped,
      minimum: effect.targetMetric === "settlement.stability" ? 0 : undefined,
      maximum: effect.targetMetric === "settlement.stability" ? 100 : undefined,
    };
    if (effect.operation === "add") {
      immediateEffects.push(built); // 영구 변경 (§12.2.1)
    } else {
      ongoingEffects.push(built); // 수정자 스택 (§12.2.1)
    }
  }

  const baseProbability = clamp(
    recommendation.suggestedBaseProbability,
    BASE_PROBABILITY_RANGE[0],
    BASE_PROBABILITY_RANGE[1],
  );
  if (baseProbability !== recommendation.suggestedBaseProbability) {
    warnings.push(
      `기본 확률 ${recommendation.suggestedBaseProbability} → ${baseProbability} (안전 범위 적용, §19)`,
    );
  }
  const duration = clamp(recommendation.suggestedDurationTicks, DURATION_RANGE[0], DURATION_RANGE[1]);
  if (duration !== recommendation.suggestedDurationTicks) {
    warnings.push(`지속 ${recommendation.suggestedDurationTicks} → ${duration}틱 (1~36으로 보정, §20.3)`);
  }
  if (recommendation.followUps && recommendation.followUps.length > 0) {
    warnings.push("후속 사건 제안은 연쇄 추천(Step 12)에서 등록됩니다 — 이번 등록에서는 제외");
  }

  const id = `llm:${fnv1a32(recommendation.name).toString(16).padStart(8, "0")}`;
  const template: EventTemplate = {
    id,
    version: 1,
    category: recommendation.category,
    kind: "effect",
    name: recommendation.name,
    descriptionTemplate: recommendation.summary,
    scope: "settlement",
    preconditions: recommendation.preconditions.map((condition) => ({
      metric: condition.metric,
      operator: condition.operator,
      value: condition.value,
    })),
    probability: { base: baseProbability, factors: [] },
    duration: { minTicks: duration, maxTicks: duration },
    immediateEffects,
    ongoingEffects,
    resolutionEffects: [],
    followUpCandidates: [],
    cooldownTicks: 12,
    maximumConcurrentInstances: 1,
    importance: 55,
    tags: ["llm"],
    source: "llm",
  };
  return { template, warnings };
}

/** 등록 중복 검사용 이름 집합 — 내장 + 이미 등록된 LLM/사용자 템플릿 */
export function registeredTemplateNames(registry: ReadonlyMap<string, { name: string }>): Set<string> {
  return new Set([...registry.values()].map((template) => template.name));
}

/**
 * 자동 승인 안전 등급 (§21.2) — 효과 크기를 범위 대비 비율로 정규화해 판정.
 *   low    : 모든 효과가 허용 범위의 절반 이내 — 반자동 모드에서 자동 등록 가능
 *   medium : 그 이상 — 설정에 따라
 *   high   : 범위의 80% 이상 — 항상 수동 승인
 */
export function classifySafety(template: EventTemplate): "low" | "medium" | "high" {
  let worst = 0;
  for (const effect of [...template.immediateEffects, ...template.ongoingEffects]) {
    const range = EFFECT_RANGES[`${effect.targetMetric}:${effect.operation}`];
    if (!range) return "high";
    const [min, max] = range;
    const span = max - min;
    if (span <= 0) continue;
    let normalized: number;
    if (effect.operation === "add") {
      const center = (min + max) / 2;
      normalized = Math.abs(effect.value - center) / (span / 2);
    } else {
      normalized =
        effect.value >= 1
          ? (effect.value - 1) / Math.max(max - 1, 1e-9)
          : (1 - effect.value) / Math.max(1 - min, 1e-9);
    }
    worst = Math.max(worst, normalized);
  }
  if (worst <= 0.5) return "low";
  if (worst <= 0.8) return "medium";
  return "high";
}
