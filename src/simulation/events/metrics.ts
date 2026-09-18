/**
 * 메트릭 리졸버 (§12.1 / §20.2) — 템플릿 조건·효과가 참조하는 상태 값의 단일 소스.
 *
 * KNOWN_METRICS는 조건·효과가 참근할 수 있는 전체 목록이고,
 * EVENT_EDITABLE_METRICS는 LLM 후보가 수정 효과로 건드릴 수 있는 허용 목록(§20.2, Step 11)이다.
 */
import { UnknownMetricError } from "../errors";
import type { WorldState } from "../core/worldState";

export type MetricTarget =
  | { kind: "settlement"; id: string }
  | { kind: "route"; id: string }
  | { kind: "world" };

/** 루트 기준 용량 — 이벤트 수정자가 곱해지기 전의 base (§4.1) */
export const BASE_ROUTE_CAPACITY = 2000;

export const SETTLEMENT_METRICS = [
  "settlement.population",
  "settlement.carryingCapacity",
  "settlement.foodProduction",
  "settlement.foodConsumption",
  "settlement.foodStock",
  "settlement.foodPriceIndex",
  "settlement.foodMonthsRemaining",
  "settlement.stability",
  "settlement.diseaseLevel",
  "settlement.migrationPressure",
  "settlement.unmetRatio",
  "settlement.waterSupply",
  "settlement.areaFertility",
  "settlement.areaRiverVolume",
  "settlement.overcrowdingRatio",
  "settlement.lastOutMigrationRatio",
] as const;

export const ROUTE_METRICS = ["route.capacity"] as const;

export const WORLD_METRICS = ["world.tick", "world.month", "world.year"] as const;

export const KNOWN_METRICS: ReadonlySet<string> = new Set<string>([
  ...SETTLEMENT_METRICS,
  ...ROUTE_METRICS,
  ...WORLD_METRICS,
]);

/** LLM이 효과로 수정할 수 있는 메트릭 허용 목록 (§20.2) */
export const EVENT_EDITABLE_METRICS: ReadonlySet<string> = new Set<string>([
  "settlement.foodProduction",
  "settlement.foodStock",
  "settlement.stability",
  "settlement.migrationPressure",
  "settlement.diseaseLevel",
  "route.capacity",
]);

export function resolveMetric(state: WorldState, target: MetricTarget, metric: string): number {
  // world.* 메트릭은 대상과 무관하게 항상 해석 가능하다 (계절 인자 등)
  if (metric.startsWith("world.")) {
    switch (metric) {
      case "world.tick":
        return state.clock.currentTick;
      case "world.month":
        return state.clock.month;
      case "world.year":
        return state.clock.year;
      default:
        throw new UnknownMetricError(metric, "world");
    }
  }
  if (target.kind === "settlement") {
    return resolveSettlementMetric(state, target.id, metric);
  }
  if (target.kind === "route") {
    if (metric === "route.capacity") {
      if (!state.routes[target.id]) {
        throw new UnknownMetricError(metric, `route:${target.id}`);
      }
      return BASE_ROUTE_CAPACITY;
    }
    throw new UnknownMetricError(metric, `route:${target.id}`);
  }
  throw new UnknownMetricError(metric, target.kind);
}

function resolveSettlementMetric(state: WorldState, id: string, metric: string): number {
  const settlement = state.settlements[id];
  if (!settlement) {
    throw new UnknownMetricError(metric, `settlement:${id}`);
  }
  switch (metric) {
    case "settlement.population":
      return settlement.population;
    case "settlement.carryingCapacity":
      return settlement.carryingCapacity;
    case "settlement.foodProduction":
      return settlement.foodProduction;
    case "settlement.foodConsumption":
      return settlement.foodConsumption;
    case "settlement.foodStock":
      return settlement.foodStock;
    case "settlement.foodPriceIndex":
      return settlement.foodPriceIndex;
    case "settlement.foodMonthsRemaining":
      return settlement.foodMonthsRemaining;
    case "settlement.stability":
      return settlement.stability;
    case "settlement.diseaseLevel":
      return settlement.diseaseLevel;
    case "settlement.migrationPressure":
      return settlement.migrationPressure;
    case "settlement.unmetRatio":
      return settlement.unmetRatio;
    case "settlement.waterSupply":
      return settlement.waterSupply;
    case "settlement.areaFertility":
      return settlement.areaFertility;
    case "settlement.areaRiverVolume":
      return settlement.areaRiverVolume;
    case "settlement.overcrowdingRatio":
      return settlement.carryingCapacity > 0 ? settlement.population / settlement.carryingCapacity : 1;
    case "settlement.lastOutMigrationRatio": {
      const entries = state.changeLedger.bySettlement(id, state.clock.currentTick, state.clock.currentTick);
      let out = 0;
      for (const entry of entries) {
        if (entry.cause === "migration_out") out += -entry.amount;
      }
      return out / Math.max(settlement.population, 1);
    }
    default:
      throw new UnknownMetricError(metric, `settlement:${id}`);
  }
}
