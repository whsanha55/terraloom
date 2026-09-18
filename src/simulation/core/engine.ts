/**
 * 시뮬레이션 엔진 (Step 5).
 *
 * tick()은 순수 상태 전이 — 스케줄링(배속·타이머)과 무결하므로
 * 어떤 배치 패턴으로 틱을 실행해도 같은 상태 해시에 도달한다(§7).
 * 현재는 시계 전이만 존재 — 도시 시스템은 Step 6~7, 사건은 Step 8~9가 추가한다.
 */
import { runFoodSettlement } from "../systems/food";
import { runPopulationChange } from "../systems/population";
import { computeStateHash } from "./stateHash";
import type { WorldState } from "./worldState";

export const TICKS_PER_YEAR = 12;

export class SimulationEngine {
  constructor(public readonly state: WorldState) {}

  tick(): void {
    const clock = this.state.clock;
    clock.currentTick += 1;
    clock.year = Math.floor(clock.currentTick / TICKS_PER_YEAR);
    clock.month = clock.currentTick % TICKS_PER_YEAR;

    // §9.3 — 6. 식량 정산(§9.4, 교역 포함) → 8. 인구 변화(원장 기록)
    runFoodSettlement(this.state);
    runPopulationChange(this.state);

    // 15. 통계 집계
    let totalPopulation = 0;
    let totalFoodStock = 0;
    for (const settlement of Object.values(this.state.settlements)) {
      if (settlement.status === "active") {
        totalPopulation += settlement.population;
        totalFoodStock += settlement.foodStock;
      }
    }
    this.state.globalStatistics.totalPopulation.push(totalPopulation);
    this.state.globalStatistics.totalFoodStock.push(totalFoodStock);
  }

  applyTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.tick();
    }
  }

  get stateHash(): string {
    return computeStateHash(this.state);
  }
}
