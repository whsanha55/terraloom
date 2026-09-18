/**
 * 효과 적용 모델 (§12.2 / §12.2.1 / T4) — 수정자 스택.
 *
 *   metric = clamp(base × Π(modifiers), minimum, maximum)
 *
 * - multiply 지속 효과: 사건 시작 시 스택에 push, 종료 시 pop — 원복 자동 보장.
 *   스택은 activeEvents에서 파생 계산한다(이중 저장·동기화 버그 방지).
 * - add/clamp 효과: 발생(immediate)·종료(resolution) 시 1회 적용되는 영구 변경.
 */
import { clamp } from "../core/numeric";
import { UnknownMetricError } from "../errors";
import type { WorldState } from "../core/worldState";
import type { ActiveWorldEvent, EventEffect, EventTemplate } from "./types";

export type TemplateRegistry = Map<string, EventTemplate>;

/** 대상의 활성 수정자 곱 — Π(modifiers) */
export function ongoingMultiplier(
  registry: TemplateRegistry,
  activeEvents: readonly ActiveWorldEvent[],
  targetId: string,
  metric: string,
): number {
  let result = 1;
  for (const event of activeEvents) {
    if (event.targetId !== targetId) continue;
    const template = registry.get(event.templateId);
    if (!template) continue;
    for (const effect of template.ongoingEffects) {
      if (effect.targetMetric === metric && effect.operation === "multiply") {
        result *= effect.value;
      }
    }
  }
  return result;
}

/**
 * 즉시·종료 효과 1회 적용 — add/multiply/clamp를 현재 상태 값에 반영한다.
 * 존재하지 않는 대상·메트릭은 건너뛴다(InvalidEffectTarget 격리, §22.1).
 */
export function applyEffect(
  state: WorldState,
  target: { kind: "settlement" | "route"; id: string },
  effect: EventEffect,
): void {
  if (target.kind !== "settlement") return; // 루트 대상 즉시 효과는 Step 8 내장에 없다
  const settlement = state.settlements[target.id];
  if (!settlement) return;

  const current = readSettlementMetric(settlement, effect.targetMetric);
  if (current === null) throw new UnknownMetricError(effect.targetMetric, "applyEffect");

  const minimum = effect.minimum ?? METRIC_BOUNDS[effect.targetMetric]?.[0] ?? -Infinity;
  const maximum = effect.maximum ?? METRIC_BOUNDS[effect.targetMetric]?.[1] ?? Infinity;
  let next: number;
  switch (effect.operation) {
    case "add":
      next = current + effect.value;
      break;
    case "multiply":
      next = current * effect.value;
      break;
    case "clamp":
      next = current;
      break;
  }
  writeSettlementMetric(settlement, effect.targetMetric, clamp(next, minimum, maximum));
}

/** 메트릭별 기본 경계 (§8.1 clamp) */
const METRIC_BOUNDS: Record<string, [number, number]> = {
  "settlement.stability": [0, 100],
  "settlement.diseaseLevel": [0, 1],
  "settlement.migrationPressure": [0, 1],
  "settlement.foodStock": [0, Infinity],
};

interface EffectWritableSettlement {
  stability: number;
  foodStock: number;
  diseaseLevel: number;
  migrationPressure: number;
}

function readSettlementMetric(settlement: EffectWritableSettlement, metric: string): number | null {
  switch (metric) {
    case "settlement.stability":
      return settlement.stability;
    case "settlement.foodStock":
      return settlement.foodStock;
    case "settlement.diseaseLevel":
      return settlement.diseaseLevel;
    case "settlement.migrationPressure":
      return settlement.migrationPressure;
    default:
      return null;
  }
}

function writeSettlementMetric(settlement: EffectWritableSettlement, metric: string, value: number): void {
  switch (metric) {
    case "settlement.stability":
      settlement.stability = value;
      break;
    case "settlement.foodStock":
      settlement.foodStock = value;
      break;
    case "settlement.diseaseLevel":
      settlement.diseaseLevel = value;
      break;
    case "settlement.migrationPressure":
      settlement.migrationPressure = value;
      break;
    default:
      break;
  }
}
