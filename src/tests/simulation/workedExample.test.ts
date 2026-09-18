import { describe, expect, it } from "vitest";
import { runFoodSettlement } from "@/simulation/systems/food";
import { runPopulationChange } from "@/simulation/systems/population";
import { makeSettlement, makeWorld } from "./testWorld";

/**
 * Worked example (§33) — 도시 2개·가뭄 1개·24틱 손계산 예시.
 * docs/worked-example.md의 표와 동일 시나리오. 공식 수정 시 표를 다시 계산한다.
 *
 * 설정:
 *   북부(north): 인구 6,000 · 수용력 8,000 · 초원 · 초기 재고 0
 *   남부(south): 인구 5,000 · 수용력 9,000 · 초원 · 초기 재고 0
 *   북부-남부 교역로 1개 (용량 2,000/월)
 *   북부에 12개월간 가뭄(생산 0.4배), 이후 정상
 */
interface MonthRow {
  month: number;
  northProd: number;
  southProd: number;
  trade: number;
  northStock: number;
  southStock: number;
  northPop: number;
  southPop: number;
  northUnmet: number;
  northStarved: number;
}

export function runWorkedExample(): MonthRow[] {
  const north = makeSettlement({
    id: "north",
    population: 6000,
    carryingCapacity: 8000,
    foodStock: 0,
  });
  const south = makeSettlement({
    id: "south",
    population: 5000,
    carryingCapacity: 9000,
    foodStock: 0,
  });
  const world = makeWorld([north, south], [["north", "south"]], "worked-example");
  const rows: MonthRow[] = [];

  for (let month = 1; month <= 24; month++) {
    const beforeStockSouth = south.foodStock;
    world.clock.currentTick = month;
    world.clock.month = month % 12;
    runFoodSettlement(world, {
      productionMultiplier: (id) => (id === "north" && month <= 12 ? 0.4 : 1),
    });
    const unmetNorth = north.unmetRatio; // 인구 정산 전 확정값(§9.4)
    runPopulationChange(world);
    const starved = world.changeLedger
      .bySettlement("north", month, month)
      .filter((entry) => entry.cause === "starvation")
      .reduce((sum, entry) => sum + entry.amount, 0);
    rows.push({
      month,
      northProd: Math.round(north.foodProduction),
      southProd: Math.round(south.foodProduction),
      // 남부 유출(양수) = 재고변화 반대방향 + 자체 수지
      trade: Math.round(
        beforeStockSouth - south.foodStock + south.foodProduction - south.foodConsumption,
      ),
      northStock: Math.round(north.foodStock),
      southStock: Math.round(south.foodStock),
      northPop: north.population,
      southPop: south.population,
      northUnmet: Number(unmetNorth.toFixed(3)),
      northStarved: Math.max(0, -starved),
    });
  }
  return rows;
}

describe("worked example (§33)", () => {
  it("24틱 행동이 docs/worked-example.md와 일치한다", () => {
    const rows = runWorkedExample();
    // 문서 생성용 표 출력 (공식 수정 시 재생성)
    if (process.env.WORKED_EXAMPLE_PRINT) {
      console.table(rows);
    }

    // 검증 — 세부 수치는 문서 표의 값과 일치해야 한다
    const month1 = rows[0];
    expect(month1.northProd).toBe(3600); // 8000 × 0.9(봄) × 1.25(초원) × 0.4(가뭄)
    expect(month1.southProd).toBe(10125); // 9000 × 0.9 × 1.25
    expect(rows[11].northPop).toBeLessThan(6000); // 가뭄 12개월차 인구 감소
    expect(rows[23].northPop).toBeGreaterThan(rows[11].northPop); // 이후 회복
    expect(rows[23].southPop).toBeGreaterThan(5000); // 남부는 성장
  });
});
