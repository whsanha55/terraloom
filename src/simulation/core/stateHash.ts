/**
 * 상태 해시 직렬화 표준 (§7.2 / T2).
 *
 * "배속이 달라도 결과가 같다"를 검증하는 해시 — 비결정적 요소 없이 계산한다.
 * - 직렬화 순서: 아래 스키마 순서로 고정 (도시·루트는 id 정렬)
 * - float: Float64 비트 패턴(16진) — 엔진 간 문자열化 오차 없음
 * - 지도 레이어 제외(시드로 재생성 보장), speed/paused 제외(배속은 결과가 아님)
 */
import { fnv1a32 } from "@/world/random/seed";
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
      stableNumber(s.areaFertility),
      stableNumber(s.areaRiverVolume),
      s.areaBiomeCounts.map(stableNumber).join(","),
    );
  }

  for (const id of Object.keys(state.routes).sort()) {
    parts.push(state.routes[id].settlementIds.join("->"));
  }

  parts.push(
    `events:${state.activeEvents.length}/${state.scheduledEvents.length}/${state.eventHistory.length}`,
    state.globalStatistics.totalPopulation.map(stableNumber).join(","),
  );

  return fnv1a32(parts.join("")).toString(16).padStart(8, "0");
}
