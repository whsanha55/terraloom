/**
 * 상태 해시 직렬화 표준 (§7.2 / T2).
 *
 * "배속이 달라도 결과가 같다"를 검증하는 해시 — 비결정적 요소 없이 계산한다.
 * - 직렬화 순서: 아래 스키마 순서로 고정 (도시·루트는 id 정렬)
 * - float: Float64 비트 패턴(16진) — 엔진 간 문자열化 오차 없음
 * - 지도 레이어 제외(시드로 재생성 보장), speed/paused 제외(배속은 결과가 아님)
 */
import { fnv1a32 } from "@/world/random/seed";
import { POPULATION_CHANGE_CAUSES } from "@/simulation/systems/ledger";
import type { WorldState } from "./worldState";

const floatView = new Float64Array(1);
const floatBits = new Uint32Array(floatView.buffer);

function stableNumber(value: number): string {
  if (Number.isInteger(value)) return `i${value}`;
  floatView[0] = value;
  return `f${floatBits[0].toString(16)}-${floatBits[1].toString(16).padStart(8, "0")}`;
}

export function computeStateHash(state: WorldState): string {
  const parts: string[] = [
    "v1",
    state.seed,
    state.simulationVersion,
    state.generatorVersion,
    `tick:${state.clock.currentTick}`,
  ];

  for (const id of Object.keys(state.settlements).sort()) {
    const s = state.settlements[id];
    if (!s) continue;
    parts.push(
      s.id,
      s.name,
      s.status,
      stableNumber(s.population),
      stableNumber(s.carryingCapacity),
      stableNumber(s.foodProduction),
      stableNumber(s.foodConsumption),
      stableNumber(s.foodStock),
      stableNumber(s.foodPriceIndex),
      stableNumber(s.waterSupply),
      stableNumber(s.stability),
      stableNumber(s.diseaseLevel),
      stableNumber(s.migrationPressure),
      s.connectedSettlementIds.slice().sort().join(","),
      s.activeEventIds.slice().sort().join(","),
      stableNumber(s.unmetRatio),
      stableNumber(s.foodMonthsRemaining),
      stableNumber(s.areaFertility),
      stableNumber(s.areaRiverVolume),
      s.areaBiomeCounts.map(stableNumber).join(","),
    );
  }

  for (const id of Object.keys(state.routes).sort()) {
    parts.push(state.routes[id].settlementIds.join("->"));
  }

  // 이벤트 상태 — 활성 사건·쿨다운·이력·평가 수 (§12, §13.1)
  for (const event of [...state.activeEvents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    parts.push(
      `a:${event.id}:${event.templateVersion}:${event.startedTick}:${event.endsAtTick}:${event.chainDepth}:${event.causedByEventId ?? ""}`,
    );
  }
  for (const scheduled of [...state.scheduledEvents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    parts.push(`s:${scheduled.id}:${scheduled.activateAtTick}:${scheduled.expiresAtTick}`);
  }
  const cooldownKeys = Object.keys(state.eventCooldowns).sort();
  for (const key of cooldownKeys) {
    parts.push(`c:${key}:${stableNumber(state.eventCooldowns[key] ?? 0)}`);
  }
  const lastHistory = state.eventHistory[state.eventHistory.length - 1];
  parts.push(
    `h:${state.eventHistory.length}:${lastHistory ? `${lastHistory.id}:${lastHistory.endedTick}` : ""}`,
    `e:${state.probabilityEvaluations.length}`,
    `llm:${state.llmRecords.length}`,
    statsDigest(state),
    ledgerDigest(state),
  );

  return fnv1a32(parts.join("")).toString(16).padStart(8, "0");
}

/** 통계 요약 — 같은 틱에서는 마지막 값과 길이만으로 충분하다 (전체 열거 비용 회피) */
function statsDigest(state: WorldState): string {
  const population = state.globalStatistics.totalPopulation;
  const food = state.globalStatistics.totalFoodStock;
  return `stats:${population.length}:${stableNumber(population[population.length - 1] ?? 0)}/${food.length}:${stableNumber(food[food.length - 1] ?? 0)}`;
}

/** 원장 요약 — 원인별 전체 합 (O(1), §8.3 집계 유지) */
function ledgerDigest(state: WorldState): string {
  const totals = state.changeLedger.totalsByCause();
  return POPULATION_CHANGE_CAUSES.map((cause) => stableNumber(totals[cause])).join(",");
}
