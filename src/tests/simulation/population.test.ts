import { describe, expect, it } from "vitest";
import { runPopulationChange } from "@/simulation/systems/population";
import { runFoodSettlement } from "@/simulation/systems/food";
import { makeSettlement, makeWorld } from "./testWorld";

describe("runPopulationChange (§8 / §8.2 / §8.3)", () => {
  it("출생·자연사망이 원장에 원인별로 기록된다", () => {
    const settlement = makeSettlement({ id: "a", population: 10000 });
    const world = makeWorld([settlement]);
    runPopulationChange(world);
    const aggregated = world.changeLedger.aggregate("a");
    expect(aggregated.birth).toBeGreaterThan(0);
    expect(aggregated.natural).toBeLessThan(0);
    expect(aggregated.starvation).toBe(0);
    expect(settlement.population).toBe(10000 + aggregated.birth + aggregated.natural);
  });

  it("기아 사망은 미충족 확정 후 적용된다 (§9.4)", () => {
    const settlement = makeSettlement({ id: "a", population: 10000 });
    settlement.unmetRatio = 0.5;
    const world = makeWorld([settlement]);
    runPopulationChange(world);
    const aggregated = world.changeLedger.aggregate("a");
    expect(aggregated.starvation).toBeLessThan(0);
    // 사망 = 인구 × 미충족율 × 기아율(0.3)
    expect(aggregated.starvation).toBe(-Math.round(10000 * 0.5 * 0.3));
    expect(settlement.unmetRatio).toBe(0); // 소진 — 다음 틱 재산정
  });

  it("거의 완전한 기근에는 최소 1명이 사망한다 — 인구가 0에 도달할 수 있다", () => {
    const settlement = makeSettlement({ id: "a", population: 2 });
    const world = makeWorld([settlement]);
    for (let month = 0; month < 4; month++) {
      settlement.unmetRatio = 1;
      runPopulationChange(world);
    }
    expect(settlement.population).toBe(0);
    expect(settlement.status).toBe("ruined"); // §8.2 폐허 전환
  });

  it("폐허 도시는 인구 계산에서 제외된다", () => {
    const settlement = makeSettlement({ id: "a", status: "ruined", population: 0 });
    const world = makeWorld([settlement]);
    runPopulationChange(world);
    expect(settlement.population).toBe(0);
    expect(settlement.status).toBe("ruined");
    expect(world.changeLedger.length).toBe(0);
  });

  it("원장 원인별 합은 총 인구 변화와 일치한다 (§33 불변식)", () => {
    const a = makeSettlement({ id: "a", population: 6000 });
    const b = makeSettlement({ id: "b", population: 9000, carryingCapacity: 8000 });
    const world = makeWorld([a, b], [["a", "b"]]);
    const initial = a.population + b.population;
    for (let tick = 0; tick < 6; tick++) {
      world.clock.currentTick = tick;
      world.clock.month = tick % 12;
      runFoodSettlement(world);
      runPopulationChange(world);
    }
    const current = a.population + b.population;
    expect(world.changeLedger.total()).toBe(current - initial);
  });

  it("모든 인구 값은 유한한 음이 아닌 정수다 (§8.1)", () => {
    const settlement = makeSettlement({ id: "a", population: 12345 });
    const world = makeWorld([settlement]);
    for (let tick = 0; tick < 12; tick++) {
      runFoodSettlement(world);
      runPopulationChange(world);
      expect(Number.isInteger(settlement.population)).toBe(true);
      expect(settlement.population).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(settlement.foodStock)).toBe(true);
    }
  });
});
