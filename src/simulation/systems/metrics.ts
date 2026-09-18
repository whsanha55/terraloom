/**
 * 도시 상태 지표 — 이주·안정도 시스템이 공유하는 파생값.
 * 모든 값은 safeDiv/clamp를 통과한다(§8.1 / T8).
 */
import { safeDiv } from "../core/numeric";
import type { SettlementState } from "../core/worldState";

/** 식량 안정도 — 잔여 4개월 이상이면 1 */
export function foodSecurity(settlement: SettlementState): number {
  return Math.min(1, safeDiv(settlement.foodMonthsRemaining, 4, 0));
}

/** 과밀도 — 수용력 초과 비율 (0 = 여유) */
export function overcrowding(settlement: SettlementState): number {
  if (settlement.carryingCapacity <= 0) return 1;
  return Math.max(0, settlement.population / settlement.carryingCapacity - 1);
}
