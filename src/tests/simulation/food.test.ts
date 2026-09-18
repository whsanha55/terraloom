import { describe, expect, it } from "vitest";
import {
  ROUTE_CAPACITY,
  biomeFactor,
  runFoodSettlement,
  seasonalFactor,
} from "@/simulation/systems/food";
import { Biome } from "@/world/generation/biome";
import { makeSettlement, makeWorld } from "./testWorld";

describe("seasonalFactor", () => {
  it("겨울 < 봄 < 가을 순서다", () => {
    expect(seasonalFactor(11)).toBeLessThan(seasonalFactor(1));
    expect(seasonalFactor(1)).toBeLessThan(seasonalFactor(7));
  });

  it("12개월 주기로 순환한다", () => {
    expect(seasonalFactor(12)).toBe(seasonalFactor(0));
  });
});

describe("biomeFactor", () => {
  it("초원이 사막보다 생산적이다", () => {
    const grass = new Array<number>(7).fill(0);
    grass[Biome.Grassland] = 10;
    const desert = new Array<number>(7).fill(0);
    desert[Biome.Desert] = 10;
    expect(biomeFactor(grass)).toBeGreaterThan(biomeFactor(desert));
  });

  it("빈 분포는 기본값 1이다 (분모 가드)", () => {
    expect(biomeFactor(new Array<number>(7).fill(0))).toBe(1);
  });
});

describe("runFoodSettlement (§9.4 단일 순서)", () => {
  it("생산이 소비보다 많으면 재고가 증가한다", () => {
    const settlement = makeSettlement({ id: "a", population: 4000, foodStock: 0 });
    const world = makeWorld([settlement]);
    runFoodSettlement(world);
    expect(settlement.foodStock).toBeGreaterThan(0);
    expect(settlement.unmetRatio).toBe(0);
    expect(settlement.foodMonthsRemaining).toBeGreaterThan(0);
  });

  it("수요 초과분은 미충족으로 확정된다 — 재고 0 보정으로 묻지 않는다", () => {
    const settlement = makeSettlement({
      id: "a",
      population: 20000,
      carryingCapacity: 10000,
      foodStock: 0,
    });
    const world = makeWorld([settlement]);
    runFoodSettlement(world);
    expect(settlement.foodStock).toBe(0);
    expect(settlement.unmetRatio).toBeGreaterThan(0);
    expect(settlement.unmetRatio).toBeLessThanOrEqual(1);
    const production = 10000 * seasonalFactor(0) * biomeFactor(settlement.areaBiomeCounts);
    expect(settlement.unmetRatio).toBeCloseTo(1 - production / 20000, 5);
  });

  it("같은 달 도착한 교역이 미충족을 줄인다 (§9.4)", () => {
    const donor = makeSettlement({ id: "d", population: 2000, foodStock: 0 });
    const needyParams = { population: 9000, carryingCapacity: 6000, foodStock: 0 };
    const withTradeNeedy = makeSettlement({ id: "n", ...needyParams });
    const aloneNeedy = makeSettlement({ id: "n", ...needyParams });

    runFoodSettlement(makeWorld([aloneNeedy]));
    runFoodSettlement(makeWorld([donor, withTradeNeedy], [["d", "n"]]));

    expect(withTradeNeedy.unmetRatio).toBeLessThan(aloneNeedy.unmetRatio);
    expect(donor.unmetRatio).toBe(0); // 공여 도시는 굶지 않는다
  });

  it("교역량은 루트 용량으로 제한된다 (§4.1)", () => {
    const donor = makeSettlement({
      id: "d",
      population: 1000,
      carryingCapacity: 1000,
      foodStock: 100000,
    });
    const needy = makeSettlement({
      id: "n",
      population: 30000,
      carryingCapacity: 0,
      foodStock: 0,
    });
    runFoodSettlement(makeWorld([donor, needy], [["d", "n"]]));
    // 공급 = 0(생산) + ROUTE_CAPACITY(교역) → 미충족 = 1 - 2000/30000
    expect(needy.unmetRatio).toBeCloseTo(1 - ROUTE_CAPACITY / 30000, 5);
  });

  it("폐허 도시는 생산·소비·교역 대상에서 제외된다 (§8.2)", () => {
    const ruined = makeSettlement({
      id: "r",
      status: "ruined",
      population: 0,
      foodStock: 99999,
    });
    const needy = makeSettlement({ id: "n", population: 9000, carryingCapacity: 0, foodStock: 0 });
    const alone = makeSettlement({ id: "n", population: 9000, carryingCapacity: 0, foodStock: 0 });

    runFoodSettlement(makeWorld([ruined, needy], [["r", "n"]]));
    runFoodSettlement(makeWorld([alone]));

    expect(ruined.foodProduction).toBe(0);
    expect(ruined.foodConsumption).toBe(0);
    expect(needy.unmetRatio).toBe(alone.unmetRatio); // 폐허의 방대한 재고도 흘러가지 않는다
  });

  it("foodMonthsRemaining은 재고/수요로 갱신된다", () => {
    const settlement = makeSettlement({
      id: "a",
      population: 1000,
      carryingCapacity: 0,
      foodStock: 3000,
    });
    runFoodSettlement(makeWorld([settlement]));
    expect(settlement.foodStock).toBeCloseTo(2000, 5);
    expect(settlement.foodMonthsRemaining).toBeCloseTo(2, 5);
  });

  it("모든 결과값은 유한수다 (T8 / §8.1)", () => {
    const settlement = makeSettlement({ id: "a", population: 777, foodStock: 12.5 });
    runFoodSettlement(makeWorld([settlement]));
    for (const value of [
      settlement.foodProduction,
      settlement.foodConsumption,
      settlement.foodStock,
      settlement.foodMonthsRemaining,
      settlement.unmetRatio,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
