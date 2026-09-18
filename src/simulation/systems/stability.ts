/**
 * 질병·안정도 계산 (§9.3.10).
 *
 * 안정도는 매월 목표치를 향해 30%씩 완만히 이동한다:
 *   목표 = (20 + 60×식량안정 − 25×과밀 − 20×질병수준) × Π(이벤트 수정자)
 * 질병 수준은 유행이 없으면 매월 감쇠한다(전염병 immediate 효과가 올리고
 * 이 감쇠가 자연히 회복시킨다 — §12.2.1 add는 영구, 회복은 기본 계산 담당).
 */
import { clamp } from "../core/numeric";
import type { WorldState } from "../core/worldState";
import { foodSecurity, overcrowding } from "./metrics";

const CONVERGENCE = 0.3;
const DISEASE_DECAY = 0.85;

export interface StabilitySystemOptions {
  /** 활성 이벤트의 안정도 수정자 (§12.2.1) */
  stabilityMultiplier?: (settlementId: string) => number;
}

export function runStability(state: WorldState, options: StabilitySystemOptions = {}): void {
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.status !== "active") continue;
    const multiplier = options.stabilityMultiplier?.(settlement.id) ?? 1;
    const target = clamp(
      (20 + 60 * foodSecurity(settlement) - 25 * overcrowding(settlement) - 20 * settlement.diseaseLevel) *
        multiplier,
      0,
      100,
    );
    settlement.stability = clamp(
      settlement.stability + CONVERGENCE * (target - settlement.stability),
      0,
      100,
    );
    settlement.diseaseLevel = clamp(settlement.diseaseLevel * DISEASE_DECAY, 0, 1);
  }
}
