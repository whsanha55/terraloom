import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { initializeWorldState } from "@/simulation/core/worldState";

const genConfig = (seed: string) => ({ ...createDefaultWorldConfig(seed), resolution: 128 });

describe("initializeWorldState (§10)", () => {
  it("도시 상태를 유한한 초기값으로 만든다", () => {
    const gen = generateWorld(genConfig("ws-init"));
    const state = initializeWorldState(gen);
    expect(Object.keys(state.settlements).length).toBe(gen.settlements.length);
    for (const settlement of Object.values(state.settlements)) {
      expect(Number.isFinite(settlement.population)).toBe(true);
      expect(Number.isInteger(settlement.population)).toBe(true);
      expect(settlement.population).toBeGreaterThan(0);
      expect(Number.isFinite(settlement.carryingCapacity)).toBe(true);
      expect(settlement.carryingCapacity).toBeGreaterThan(0);
      expect(settlement.stability).toBeGreaterThanOrEqual(0);
      expect(settlement.stability).toBeLessThanOrEqual(100);
      expect(settlement.status).toBe("active");
      expect(settlement.areaFertility).toBeGreaterThanOrEqual(0);
      expect(settlement.areaFertility).toBeLessThanOrEqual(1);
      expect(settlement.activeEventIds).toEqual([]);
    }
  });

  it("연결망은 교역로(MST)의 인접 관계를 따른다", () => {
    const gen = generateWorld(genConfig("ws-routes"));
    const state = initializeWorldState(gen);
    expect(Object.keys(state.routes).length).toBe(gen.routes.length);
    for (const route of gen.routes) {
      expect(state.settlements[route.settlementIds[0]].connectedSettlementIds).toContain(
        route.settlementIds[1],
      );
      expect(state.settlements[route.settlementIds[1]].connectedSettlementIds).toContain(
        route.settlementIds[0],
      );
    }
  });

  it("결정론적이다 — 같은 생성 결과는 같은 상태를 만든다", () => {
    const gen = generateWorld(genConfig("ws-det"));
    const a = initializeWorldState(gen);
    const b = initializeWorldState(gen);
    expect(a).toEqual(b);
  });

  it("시계는 0틱(1년 1월)에서 시작한다", () => {
    const gen = generateWorld(genConfig("ws-clock"));
    const state = initializeWorldState(gen);
    expect(state.clock.currentTick).toBe(0);
    expect(state.clock.year).toBe(0);
    expect(state.clock.month).toBe(0);
  });
});
