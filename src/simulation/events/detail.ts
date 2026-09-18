/**
 * 사건 상세 조립 (Step 10 관찰 UI 데이터) — §27 사건 상세 화면의 원천.
 *
 * 발생 위치(대상)·직접 영향(효과 라벨)·발생 확률 근거(§13.1)·
 * 예상 후속 사건의 현재 상태 기준 조건부 확률(§2.2)을 한 번에 모은다.
 * 순수 함수 — UI가 필요할 때 Worker가 이 함수로 데이터를 만들어 전달한다.
 */
import { clamp } from "../core/numeric";
import type { WorldState } from "../core/worldState";
import type { TemplateRegistry } from "./effects";
import { causalChain } from "./engine";
import { evaluateCondition } from "./conditions";
import { resolveMetric } from "./metrics";
import { computeProbability } from "./probability";
import type { EventCategory, EventKind, ProbabilityModifier } from "./types";

export interface EventFollowUpEstimate {
  templateId: string;
  name: string;
  /** 현재 상태 기준 조건부 확률 (§2.2 — 예측이 아님) */
  probability: number;
  eligible: boolean;
  modifiers: ProbabilityModifier[];
}

export interface EventEffectLabel {
  label: string;
}

export interface EventDetailData {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: EventCategory;
  kind: EventKind;
  targetId: string;
  targetName: string;
  startedTick: number;
  endedTick: number | null;
  status: "active" | "ended";
  importance: number;
  /** 인과 경로 루트 → 이 사건 (§14) */
  causalChain: Array<{ id: string; name: string }>;
  /** 발생 당시 확률 평가 — 통지형은 없다 */
  evaluation: {
    baseProbability: number;
    finalProbability: number;
    modifiers: ProbabilityModifier[];
    randomValue: number;
  } | null;
  effects: EventEffectLabel[];
  followUps: EventFollowUpEstimate[];
}

const METRIC_LABELS: Record<string, string> = {
  "settlement.foodProduction": "농업 생산",
  "settlement.foodStock": "식량 재고",
  "settlement.stability": "안정도",
  "settlement.diseaseLevel": "질병 수준",
  "settlement.migrationPressure": "이주 압력",
  "route.capacity": "교역로 용량",
};

function effectLabel(metric: string, operation: string, value: number, phase: string): string {
  const name = METRIC_LABELS[metric] ?? metric;
  const op = operation === "add" ? (value >= 0 ? "+" : "") : "×";
  return `${name} ${op}${operation === "add" ? value : value} (${phase})`;
}

export function describeEvent(
  state: WorldState,
  registry: TemplateRegistry,
  eventId: string,
): EventDetailData | null {
  const active = state.activeEvents.find((e) => e.id === eventId);
  const endedRecord = active ? null : state.eventHistory.find((e) => e.id === eventId);
  const historical = active ?? endedRecord;
  if (!historical) return null;
  const endedTick = endedRecord?.endedTick ?? null;

  const template = registry.get(historical.templateId);
  const settlement = state.settlements[historical.targetId];
  const targetName = settlement?.name ?? historical.targetId;
  const name = template?.name ?? historical.templateId;
  const description = (template?.descriptionTemplate ?? "")
    .replaceAll("{settlement}", targetName)
    .replaceAll("{target}", targetName);

  // 발생 당시 평가 기록 (§13.1) — startedTick·대상 일치로 역추적
  let evaluation: EventDetailData["evaluation"] = null;
  for (let i = state.probabilityEvaluations.length - 1; i >= 0; i--) {
    const record = state.probabilityEvaluations[i];
    if (
      record &&
      record.eventTemplateId === historical.templateId &&
      record.targetId === historical.targetId &&
      record.tick === historical.startedTick
    ) {
      evaluation = {
        baseProbability: record.baseProbability,
        finalProbability: record.finalProbability,
        modifiers: record.modifiers,
        randomValue: record.randomValue,
      };
      break;
    }
  }

  const effects: EventEffectLabel[] = [];
  if (template) {
    for (const effect of template.immediateEffects) {
      effects.push({ label: effectLabel(effect.targetMetric, effect.operation, effect.value, "즉시") });
    }
    for (const effect of template.ongoingEffects) {
      effects.push({ label: effectLabel(effect.targetMetric, effect.operation, effect.value, "지속") });
    }
    for (const effect of template.resolutionEffects) {
      effects.push({ label: effectLabel(effect.targetMetric, effect.operation, effect.value, "종료 시") });
    }
  }

  const followUps: EventFollowUpEstimate[] = [];
  if (template && template.kind === "effect") {
    const target =
      template.scope === "route"
        ? ({ kind: "route", id: historical.targetId } as const)
        : ({ kind: "settlement", id: historical.targetId } as const);
    for (const candidate of template.followUpCandidates) {
      const child = registry.get(candidate.eventTemplateId);
      if (!child) continue;
      let eligible = true;
      try {
        for (const condition of child.preconditions) {
          if (!evaluateCondition(condition, resolveMetric(state, target, condition.metric))) {
            eligible = false;
            break;
          }
        }
        if (eligible) {
          for (const condition of candidate.conditions) {
            if (!evaluateCondition(condition, resolveMetric(state, target, condition.metric))) {
              eligible = false;
              break;
            }
          }
        }
      } catch {
        eligible = false; // 알 수 없는 메트릭 — 후보는 비활성 표시
      }
      const computation = safeCompute(state, child, target);
      const probability = clamp(
        (computation?.finalProbability ?? 0) * candidate.baseWeight,
        0,
        child.probability.max ?? 1,
      );
      followUps.push({
        templateId: child.id,
        name: child.name,
        probability: child.kind === "notification" ? (eligible ? 1 : 0) : probability,
        eligible,
        modifiers: computation?.modifiers ?? [],
      });
    }
  }

  return {
    id: historical.id,
    templateId: historical.templateId,
    name,
    description,
    category: template?.category ?? "social",
    kind: template?.kind ?? "effect",
    targetId: historical.targetId,
    targetName,
    startedTick: historical.startedTick,
    endedTick,
    status: active ? "active" : "ended",
    importance: historical.importance,
    causalChain: causalChain(state, eventId).map((node) => ({
      id: node.id,
      name: registry.get(node.templateId)?.name ?? node.templateId,
    })),
    evaluation,
    effects,
    followUps,
  };
}

function safeCompute(
  state: WorldState,
  template: { id: string; probability: { base: number; max?: number; factors: unknown[] } },
  target: { kind: "settlement" | "route"; id: string },
) {
  try {
    return computeProbability(
      state,
      template as Parameters<typeof computeProbability>[1],
      target,
    );
  } catch {
    return null;
  }
}
