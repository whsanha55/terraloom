/**
 * 월간 식량 정산 (§9.4 / T3) — 단일 순서.
 *
 * 1. 생산 — 계절 배율 × 바이옴 배율 × 수용력 기반
 * 2. 교역 — 연결 도시 간 잉여→부족 월 1회 이동(§4.1). 같은 달 공급에 포함돼
 *    "같은 달 도착한 교역이 주민을 구한다"(§9.4)를 만족한다
 * 3. 수요 — 인구 × 1인당 소비
 * 4. 재고·미충족 확정 — 부족분을 재고 0 보정으로 묻지 않고 미충족으로 기록
 * 5. foodMonthsRemaining 갱신 — 이벤트 조건(§12.1)의 입력
 *
 * 기아 사망은 population 시스템이 미충족 확정 후 적용한다(§9.3.8).
 * 폐허 도시는 생산·소비·교역 대상에서 제외된다(§8.2).
 */
import { Biome } from "@/world/generation/biome";
import { clamp, safeDiv } from "../core/numeric";
import type { WorldState } from "../core/worldState";

export const FOOD_PER_PERSON = 1;
export const TRADE_FRACTION = 0.5; // 잉여 중 교역으로 보내는 비율
export const ROUTE_CAPACITY = 2000; // 루트당 월 이동 상한 (§4.1 용량 가중치의 기준값)
export const FOOD_MONTHS_REMAINING_CAP = 99;

/** 계절별 생산 배율 — 월 0-based (0-2 봄, 3-5 여름, 6-8 가을, 9-11 겨울) */
export function seasonalFactor(month: number): number {
  const m = ((month % 12) + 12) % 12;
  if (m <= 2) return 0.9;
  if (m <= 5) return 1.1;
  if (m <= 8) return 1.6;
  return 0.2;
}

const BIOME_FACTORS: Record<number, number> = {
  [Biome.Ocean]: 0.4, // 어업
  [Biome.Ice]: 0,
  [Biome.Tundra]: 0.35,
  [Biome.Forest]: 1.0,
  [Biome.Grassland]: 1.25, // 농업에 가장 적합
  [Biome.Desert]: 0.35,
  [Biome.Mountain]: 0.25,
};

/** 영역 바이옴 구성비로 생산 배율 — 빈 분포는 1 (분모 가드) */
export function biomeFactor(biomeCounts: number[]): number {
  let total = 0;
  let weighted = 0;
  for (let biome = 0; biome < biomeCounts.length; biome++) {
    const count = biomeCounts[biome] ?? 0;
    total += count;
    weighted += count * (BIOME_FACTORS[biome] ?? 0.5);
  }
  return safeDiv(weighted, total, 1);
}

export interface FoodSystemOptions {
  /** 외부 주입 생산 배율 (가뭄 등 — worked example·시나리오 테스트용) */
  productionMultiplier?: (settlementId: string) => number;
}

export function runFoodSettlement(state: WorldState, options: FoodSystemOptions = {}): void {
  const month = state.clock.month;
  const active = Object.values(state.settlements).filter((s) => s.status === "active");

  // 1. 생산
  const production = new Map<string, number>();
  for (const settlement of active) {
    const multiplier = options.productionMultiplier?.(settlement.id) ?? 1;
    const value =
      settlement.carryingCapacity *
      seasonalFactor(month) *
      biomeFactor(settlement.areaBiomeCounts) *
      multiplier;
    settlement.foodProduction = Math.max(0, value);
    production.set(settlement.id, settlement.foodProduction);
  }

  // 2. 교역 — 잉여/부족 산정 후 루트 id 순서로 이동 (결정론)
  const surplus = new Map<string, number>();
  const deficit = new Map<string, number>();
  for (const settlement of active) {
    const demand = settlement.population * FOOD_PER_PERSON;
    const available = settlement.foodStock + (production.get(settlement.id) ?? 0) - demand;
    if (available > 0) {
      surplus.set(settlement.id, available);
    } else {
      deficit.set(settlement.id, -available);
    }
  }
  const tradeIn = new Map<string, number>();
  const tradeOut = new Map<string, number>();
  for (const routeId of Object.keys(state.routes).sort()) {
    const route = state.routes[routeId];
    const [aId, bId] = route.settlementIds;
    let donorId: string | null = null;
    let receiverId: string | null = null;
    if ((surplus.get(aId) ?? 0) > 0 && (deficit.get(bId) ?? 0) > 0) {
      donorId = aId;
      receiverId = bId;
    } else if ((surplus.get(bId) ?? 0) > 0 && (deficit.get(aId) ?? 0) > 0) {
      donorId = bId;
      receiverId = aId;
    }
    if (donorId === null || receiverId === null) continue;
    const amount = Math.min(
      (surplus.get(donorId) ?? 0) * TRADE_FRACTION,
      deficit.get(receiverId) ?? 0,
      ROUTE_CAPACITY,
    );
    if (amount <= 0) continue;
    surplus.set(donorId, (surplus.get(donorId) ?? 0) - amount);
    deficit.set(receiverId, (deficit.get(receiverId) ?? 0) - amount);
    tradeOut.set(donorId, (tradeOut.get(donorId) ?? 0) + amount);
    tradeIn.set(receiverId, (tradeIn.get(receiverId) ?? 0) + amount);
  }

  // 3~5. 수요·공급·재고·미충족·잔여 개월
  for (const settlement of active) {
    const demand = settlement.population * FOOD_PER_PERSON;
    const supply =
      (production.get(settlement.id) ?? 0) +
      (tradeIn.get(settlement.id) ?? 0) -
      (tradeOut.get(settlement.id) ?? 0);
    settlement.foodConsumption = demand;
    const nextStock = settlement.foodStock + supply - demand;
    if (nextStock < 0) {
      settlement.foodStock = 0;
      settlement.unmetRatio = clamp(safeDiv(-nextStock, Math.max(demand, 1)), 0, 1);
    } else {
      settlement.foodStock = nextStock;
      settlement.unmetRatio = 0;
    }
    settlement.foodMonthsRemaining = Math.min(
      FOOD_MONTHS_REMAINING_CAP,
      safeDiv(settlement.foodStock, Math.max(demand, 1), FOOD_MONTHS_REMAINING_CAP),
    );
  }

  // 폐허 도시 — 명시적 초기화 (오염 방지)
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.status !== "active") {
      settlement.foodProduction = 0;
      settlement.foodConsumption = 0;
    }
  }
}
