import { describe, expect, it } from "vitest";
import { runStability } from "@/simulation/systems/stability";
import { makeSettlement, makeWorld } from "./testWorld";

describe("runStability (§9.3.10)", () => {
  it("식량이 풍족하면 안정도가 목표치로 상승한다", () => {
    const settlement = makeSettlement({ id: "a", stability: 50, foodMonthsRemaining: 6 });
    runStability(makeWorld([settlement]));
    expect(settlement.stability).toBeGreaterThan(50);
    expect(settlement.stability).toBeLessThanOrEqual(100);
  });

  it("식량이 부족하면 안정도가 하락한다", () => {
    const settlement = makeSettlement({ id: "a", stability: 60, foodMonthsRemaining: 0 });
    runStability(makeWorld([settlement]));
    expect(settlement.stability).toBeLessThan(60);
  });

  it("과밀은 안정도를 낮춘다", () => {
    const spacious = makeSettlement({ id: "a", population: 3000, carryingCapacity: 10000 });
    const crowded = makeSettlement({ id: "b", population: 15000, carryingCapacity: 10000 });
    runStability(makeWorld([spacious, crowded]));
    expect(crowded.stability).toBeLessThan(spacious.stability);
  });

  it("안정도는 항상 [0, 100] 유한 범위다 (§8.1)", () => {
    const settlement = makeSettlement({ id: "a", stability: 0, foodMonthsRemaining: 0 });
    const world = makeWorld([settlement]);
    for (let tick = 0; tick < 24; tick++) {
      runStability(world);
      expect(Number.isFinite(settlement.stability)).toBe(true);
      expect(settlement.stability).toBeGreaterThanOrEqual(0);
      expect(settlement.stability).toBeLessThanOrEqual(100);
    }
  });

  it("폐허 도시는 안정도 계산에서 제외된다", () => {
    const settlement = makeSettlement({ id: "a", status: "ruined", population: 0 });
    runStability(makeWorld([settlement]));
    expect(settlement.stability).toBe(70); // 불변
  });
});
