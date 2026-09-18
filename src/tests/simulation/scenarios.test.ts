import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState, type WorldState } from "@/simulation/core/worldState";
import { runFoodSettlement } from "@/simulation/systems/food";
import { runPopulationChange } from "@/simulation/systems/population";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

const config = (seed: string) => ({ ...createDefaultWorldConfig(seed), resolution: 128 });

/** 시스템을 직접 구성해 진행한다 (엔진 tick과 동일 순서 — 가뭄 주입용) */
function advance(state: WorldState, ticks: number, multiplier?: (id: string) => number): void {
  for (let t = 0; t < ticks; t++) {
    state.clock.currentTick += 1;
    state.clock.year = Math.floor(state.clock.currentTick / 12);
    state.clock.month = state.clock.currentTick % 12;
    runFoodSettlement(state, multiplier ? { productionMultiplier: multiplier } : {});
    runPopulationChange(state);
  }
}

describe("밸런스 시나리오 (§33 고정 시나리오)", () => {
  it("시나리오 1 — 평상시 유지: 50년(600틱) 동안 멸망·폭발 성장 없음", () => {
    const state = initializeWorldState(generateWorld(config("scenario-calm")));
    const engine = new SimulationEngine(state);
    engine.applyTicks(600);
    for (const settlement of Object.values(engine.state.settlements)) {
      expect(settlement.status).toBe("active");
      expect(settlement.population).toBeGreaterThan(0);
      // 수용력 초과 과밀 사망이 성장을 제한한다
      expect(settlement.population).toBeLessThan(settlement.carryingCapacity * 1.3 + 1);
      expect(Number.isFinite(settlement.foodStock)).toBe(true);
    }
  });

  it("시나리오 2 — 흉작 후 회복: 3년 가뭄(0.4배)으로 감소 뒤 회복", () => {
    const state = initializeWorldState(generateWorld(config("scenario-drought")));
    const target = Object.values(state.settlements)[0];
    if (!target) throw new Error("도시가 없습니다");
    const initialPopulation = target.population;

    advance(state, 36, (id) => (id === target.id ? 0.4 : 1)); // 3년 가뭄
    const droughtPopulation = target.population;
    expect(droughtPopulation).toBeLessThan(initialPopulation);

    advance(state, 84, () => 1); // 7년 회복
    expect(target.population).toBeGreaterThan(droughtPopulation);
    expect(target.status).toBe("active");
    expect(target.unmetRatio).toBe(0);
  });

  it("시나리오 3 — 교역 완충: 같은 가뭄에 교역로가 있으면 기아 사망이 적다", () => {
    // 같은 시드로 두 세계 생성(결정론 → 동일) — 하나는 교역로 제거
    const withTrade = initializeWorldState(generateWorld(config("scenario-trade")));
    const withoutTrade = initializeWorldState(generateWorld(config("scenario-trade")));
    withoutTrade.routes = {};
    for (const settlement of Object.values(withoutTrade.settlements)) {
      settlement.connectedSettlementIds = [];
    }

    const targetId = Object.values(withTrade.settlements)[0]!.id;
    advance(withTrade, 36, (id) => (id === targetId ? 0.4 : 1));
    advance(withoutTrade, 36, (id) => (id === targetId ? 0.4 : 1));

    const starvationWith = withTrade.changeLedger.totalsByCause().starvation;
    const starvationWithout = withoutTrade.changeLedger.totalsByCause().starvation;
    // 음수 값 — 덜 죽었다 = 값이 덜 작다
    expect(starvationWith).toBeGreaterThan(starvationWithout);
  });
});
