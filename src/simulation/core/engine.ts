/**
 * 시뮬레이션 엔진 (Step 5+, §9.3 틱 처리 순서).
 *
 * tick()은 순수 상태 전이 — 스케줄링(배속·타이머)과 무결하므로
 * 어떤 배치 패턴으로 틱을 실행해도 같은 상태 해시에 도달한다(§7).
 * §9.3 — 6. 식량 정산(§9.4, 교역 포함) → 8. 인구 변화(원장 기록)
 *        → 9. 이주 공동 정산(§9.6) → 10. 질병·안정도
 *        → 11~14. 사건 평가·발생·종료(Step 8) → 15. 통계 집계
 */
import { runFoodSettlement } from "../systems/food";
import { runMigration, type MigrationFlow } from "../systems/migration";
import { runPopulationChange } from "../systems/population";
import { runStability } from "../systems/stability";
import { EventEngine, type EventNotice } from "../events/engine";
import { ongoingMultiplier } from "../events/effects";
import { BUILTIN_TEMPLATES } from "../events/templates/builtin";
import { computeStateHash } from "./stateHash";
import type { WorldState } from "./worldState";

export const TICKS_PER_YEAR = 12;

export class SimulationEngine {
  /** 규칙 기반 이벤트 엔진 (Step 8) — 템플릿 레지스트리 소유 */
  public readonly eventEngine = new EventEngine(BUILTIN_TEMPLATES);
  /** 직전 틱의 이주 흐름 — UI 시각화(이주 경로 화살표)용 */
  public lastMigrationFlows: MigrationFlow[] = [];
  /** 직전 틱에 발생·기록된 사건 — 타임라인·자동 일시 정지 판정용 */
  public lastTickNotices: EventNotice[] = [];

  constructor(public readonly state: WorldState) {}

  tick(): void {
    const clock = this.state.clock;
    clock.currentTick += 1;
    clock.year = Math.floor(clock.currentTick / TICKS_PER_YEAR);
    clock.month = clock.currentTick % TICKS_PER_YEAR;

    const registry = this.eventEngine.registry;
    const multiplier = (targetId: string, metric: string): number =>
      ongoingMultiplier(registry, this.state.activeEvents, targetId, metric);

    runFoodSettlement(this.state, {
      eventMultiplier: (id) => multiplier(id, "settlement.foodProduction"),
      routeCapacityMultiplier: (routeId) => multiplier(routeId, "route.capacity"),
    });
    runPopulationChange(this.state);
    this.lastMigrationFlows = runMigration(this.state);
    runStability(this.state, {
      stabilityMultiplier: (id) => multiplier(id, "settlement.stability"),
    });

    this.eventEngine.run(this.state);
    this.lastTickNotices = this.eventEngine.lastTickNotices;

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
