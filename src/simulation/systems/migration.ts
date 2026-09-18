/**
 * 이주 공동 정산 (§9.6 / T13).
 *
 * 1. 월초 인구 스냅숏 기준으로 모든 도시의 이주 압력·희망 이동량 산정
 * 2. 목적지별 신청 합산 → 수용력 초과 시 비례 축소
 * 3. 확정된 이동만 적용 — 도착 인구는 같은 달 재이동 금지 (단일 패스)
 * 4. 불변식: 출발 감소 총합 = 도착 증가 총합 (세계 총인구 보존, §33)
 *
 * 산정과 적용의 2단계 분리로 도시 처리 순서가 결과에 영향주지 않는다.
 * 폐허 도시는 출발지·목적지 모두에서 제외된다(§8.2).
 * 목적지 가중치 = 매력도 / 도로 비용(제곱 거리) — 연결된 이웃만 후보.
 */
import { clamp, safeDiv } from "../core/numeric";
import type { SettlementState, WorldState } from "../core/worldState";
import { foodSecurity, overcrowding } from "./metrics";

export const MIGRATION_RATE = 0.05; // 압력 1일 때 월 인구의 5%까지 유출
export const CAPACITY_HEADROOM = 1.1; // 수용력의 110%까지 수용

export interface MigrationFlow {
  fromId: string;
  toId: string;
  amount: number;
}

/** 이주 압력 — 식량 부족·낮은 안정도·과밀의 가중 합 [0,1] */
export function computeMigrationPressure(settlement: SettlementState): number {
  const foodPressure = Math.max(0, 1 - safeDiv(settlement.foodMonthsRemaining, 2, 0));
  const stabilityPressure = Math.max(0, safeDiv(50 - settlement.stability, 50, 0));
  return clamp(0.4 * foodPressure + 0.3 * stabilityPressure + 0.3 * overcrowding(settlement), 0, 1);
}

/** 매력도 — 식량 안정·안정도가 높고 과밀이 낮은 도시 [0.02,1] */
export function computeAttractiveness(settlement: SettlementState): number {
  return clamp(
    0.6 * foodSecurity(settlement) +
      0.4 * safeDiv(settlement.stability, 100, 0) -
      0.3 * overcrowding(settlement),
    0.02,
    1,
  );
}

/** 배분 키 — 명시적 구분자(제어 문자 회피) */
const allocKey = (fromId: string, toId: string): string => `${fromId}->${toId}`;
const toIdOf = (key: string): string => key.slice(key.indexOf("->") + 2);
const fromIdOf = (key: string): string => key.slice(0, key.indexOf("->"));

/** 목적지 가중치 — 매력도 / 도로 비용(제곱 거리 정규화) */
function destinationWeight(
  origin: SettlementState,
  destination: SettlementState,
  attractiveness: number,
  referenceScale2: number,
): number {
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const cost = 1 + (dx * dx + dy * dy) / referenceScale2;
  return attractiveness / cost;
}

export function runMigration(state: WorldState): MigrationFlow[] {
  const active = Object.values(state.settlements)
    .filter((s) => s.status === "active")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const tick = state.clock.currentTick;

  // 1. 월초 스냅숏 기준 산정 — 압력 갱신 + 희망 이동량
  const pressure = new Map<string, number>();
  const attractiveness = new Map<string, number>();
  const desired = new Map<string, number>();
  for (const settlement of active) {
    const p = computeMigrationPressure(settlement);
    pressure.set(settlement.id, p);
    settlement.migrationPressure = p;
    attractiveness.set(settlement.id, computeAttractiveness(settlement));
    desired.set(settlement.id, Math.max(0, Math.round(settlement.population * p * MIGRATION_RATE)));
  }

  const byId = new Map(active.map((s) => [s.id, s]));
  const referenceScale2 = Math.max(1, (state.map.width * state.map.width) / 16);

  // 희망 배분 — 연결된 활성 이웃에 가중 분배 (실수)
  const allocations = new Map<string, number>(); // "fromId->toId" → units(실수)
  for (const origin of active) {
    const emigrants = desired.get(origin.id) ?? 0;
    if (emigrants <= 0) continue;
    let totalWeight = 0;
    const weights = new Map<string, number>();
    for (const neighborId of origin.connectedSettlementIds) {
      const neighbor = byId.get(neighborId);
      if (!neighbor) continue; // 폐허 또는 미존재
      const weight = destinationWeight(
        origin,
        neighbor,
        attractiveness.get(neighborId) ?? 0,
        referenceScale2,
      );
      weights.set(neighborId, weight);
      totalWeight += weight;
    }
    if (totalWeight <= 0) continue; // 갈 곳이 없다 — 이동 없음
    for (const [neighborId, weight] of weights) {
      allocations.set(allocKey(origin.id, neighborId), (emigrants * weight) / totalWeight);
    }
  }

  // 2. 목적지별 신청 합산 → 수용력 초과 시 비례 축소
  const incoming = new Map<string, number>();
  for (const [key, units] of allocations) {
    const toId = toIdOf(key);
    incoming.set(toId, (incoming.get(toId) ?? 0) + units);
  }
  for (const [toId, total] of incoming) {
    const destination = byId.get(toId);
    if (!destination) continue;
    const headroom = Math.max(
      0,
      destination.carryingCapacity * CAPACITY_HEADROOM - destination.population,
    );
    if (total > headroom && total > 0) {
      const scale = safeDiv(headroom, total, 0);
      for (const key of allocations.keys()) {
        if (toIdOf(key) === toId) {
          allocations.set(key, (allocations.get(key) ?? 0) * scale);
        }
      }
    }
  }

  // 3. 정수 확정 — 목적지별 floor 후 나머지를 큰 순서로 배분 (동률은 출발 id 순)
  const flows: MigrationFlow[] = [];
  const outTotals = new Map<string, number>();
  const inTotals = new Map<string, number>();
  for (const destination of active) {
    const cells = [...allocations.entries()]
      .filter(([key]) => toIdOf(key) === destination.id)
      .map(([key, units]) => ({
        fromId: fromIdOf(key),
        units,
      }));
    if (cells.length === 0) continue;
    let total = 0;
    for (const cell of cells) total += cell.units;
    const target = Math.floor(total);
    let assigned = 0;
    const intCells = cells.map((cell) => {
      const base = Math.floor(cell.units);
      assigned += base;
      return { fromId: cell.fromId, base, frac: cell.units - base };
    });
    let leftover = Math.max(0, target - assigned);
    intCells.sort((a, b) => b.frac - a.frac || (a.fromId < b.fromId ? -1 : 1));
    for (const cell of intCells) {
      if (leftover > 0) {
        cell.base += 1;
        leftover -= 1;
      }
    }
    for (const cell of intCells) {
      if (cell.base <= 0) continue;
      flows.push({ fromId: cell.fromId, toId: destination.id, amount: cell.base });
      outTotals.set(cell.fromId, (outTotals.get(cell.fromId) ?? 0) + cell.base);
      inTotals.set(destination.id, (inTotals.get(destination.id) ?? 0) + cell.base);
    }
  }

  // 4. 적용 — 확정된 이동만. 원장에 원인별 기록(§8.3)
  for (const [fromId, amount] of outTotals) {
    const origin = byId.get(fromId);
    if (!origin) continue;
    origin.population = Math.max(0, origin.population - amount);
    state.changeLedger.record({
      tick,
      settlementId: fromId,
      cause: "migration_out",
      amount: -amount,
    });
  }
  for (const [toId, amount] of inTotals) {
    const destination = byId.get(toId);
    if (!destination) continue;
    destination.population += amount;
    state.changeLedger.record({ tick, settlementId: toId, cause: "migration_in", amount });
  }

  return flows.sort((a, b) =>
    a.fromId === b.fromId ? (a.toId < b.toId ? -1 : 1) : a.fromId < b.fromId ? -1 : 1,
  );
}
