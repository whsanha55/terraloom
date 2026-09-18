/**
 * 안정도 계산 (§9.3.10 — 질병은 Step 8 이벤트와 함께 추가).
 *
 * 매월 목표치를 향해 30%씩 완만히 이동한다:
 *   목표 = 20 + 60×식량안정 − 25×과밀  (clamp [0,100])
 */
import { clamp } from "../core/numeric";
import type { WorldState } from "../core/worldState";
import { foodSecurity, overcrowding } from "./metrics";

const CONVERGENCE = 0.3;

export function runStability(state: WorldState): void {
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.status !== "active") continue;
    const target = clamp(
      20 + 60 * foodSecurity(settlement) - 25 * overcrowding(settlement),
      0,
      100,
    );
    settlement.stability = clamp(
      settlement.stability + CONVERGENCE * (target - settlement.stability),
      0,
      100,
    );
  }
}
