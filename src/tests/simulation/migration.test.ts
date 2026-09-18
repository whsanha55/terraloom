import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState } from "@/simulation/core/worldState";
import {
  computeAttractiveness,
  computeMigrationPressure,
  runMigration,
} from "@/simulation/systems/migration";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { makeSettlement, makeWorld } from "./testWorld";

describe("압력·매력도", () => {
  it("식량이 부족한 도시는 이주 압력이 높다", () => {
    const hungry = makeSettlement({ id: "h", foodMonthsRemaining: 0.2 });
    const secure = makeSettlement({ id: "s", foodMonthsRemaining: 5 });
    expect(computeMigrationPressure(hungry)).toBeGreaterThan(computeMigrationPressure(secure));
    expect(computeMigrationPressure(secure)).toBe(0);
  });

  it("과밀 도시는 매력도가 낮다", () => {
    const spacious = makeSettlement({ id: "a", population: 3000, carryingCapacity: 10000 });
    const crowded = makeSettlement({ id: "b", population: 15000, carryingCapacity: 10000 });
    expect(computeAttractiveness(crowded)).toBeLessThan(computeAttractiveness(spacious));
  });
});

describe("runMigration (§9.6 공동 정산 / T13)", () => {
  it("출발 감소 총합 = 도착 증가 총합 (세계 총인구 보존)", () => {
    const a = makeSettlement({
      id: "a",
      population: 10000,
      carryingCapacity: 5000,
      foodMonthsRemaining: 0.1,
      stability: 30,
    });
    const b = makeSettlement({ id: "b", population: 3000, carryingCapacity: 9000 });
    const c = makeSettlement({ id: "c", population: 4000, carryingCapacity: 8000 });
    const world = makeWorld(
      [a, b, c],
      [
        ["a", "b"],
        ["a", "c"],
      ],
    );
    const before = a.population + b.population + c.population;
    const flows = runMigration(world);
    const after = a.population + b.population + c.population;
    expect(after).toBe(before);
    expect(flows.length).toBeGreaterThan(0);
    const totals = world.changeLedger.totalsByCause();
    expect(totals.migration_out).toBe(-totals.migration_in);
    expect(a.population).toBeLessThan(10000); // 압력 도시에서 유출
  });

  it("연결되지 않은 도시로는 직접 이동하지 않는다", () => {
    const a = makeSettlement({
      id: "a",
      population: 10000,
      carryingCapacity: 5000,
      foodMonthsRemaining: 0.1,
    });
    const b = makeSettlement({ id: "b", population: 3000, carryingCapacity: 9000 });
    const isolated = makeSettlement({ id: "iso", population: 4000, carryingCapacity: 8000 });
    const world = makeWorld([a, b, isolated], [["a", "b"]]);
    const flows = runMigration(world);
    for (const flow of flows) {
      expect(flow.toId).not.toBe("iso");
      expect(flow.fromId).not.toBe("iso");
    }
    expect(isolated.population).toBe(4000);
  });

  it("목적지 수용력 초과 시 신청이 비례 축소된다", () => {
    const a = makeSettlement({
      id: "a",
      population: 20000,
      carryingCapacity: 5000,
      foodMonthsRemaining: 0.1,
      stability: 20,
    });
    const b = makeSettlement({ id: "b", population: 4900, carryingCapacity: 5000 }); // headroom 600
    const world = makeWorld([a, b], [["a", "b"]]);
    runMigration(world);
    // headroom = 5000×1.1 − 4900 = 600 을 넘지 못한다
    expect(b.population).toBeLessThanOrEqual(4900 + 600);
  });

  it("폐허 도시는 이주의 출발지·목적지가 아니다 (§8.2)", () => {
    const ruined = makeSettlement({
      id: "r",
      status: "ruined",
      population: 0,
      foodMonthsRemaining: 0,
    });
    const pressured = makeSettlement({
      id: "p",
      population: 9000,
      carryingCapacity: 4000,
      foodMonthsRemaining: 0.1,
    });
    const world = makeWorld([ruined, pressured], [["r", "p"]]);
    const flows = runMigration(world);
    expect(flows).toEqual([]); // 유일한 이웃이 폐허 → 이동 없음
  });

  it("결정론적이다 — 같은 상태는 같은 결과를 낸다", () => {
    const build = () =>
      makeWorld(
        [
          makeSettlement({
            id: "a",
            population: 9000,
            carryingCapacity: 4000,
            foodMonthsRemaining: 0.1,
            stability: 30,
          }),
          makeSettlement({ id: "b", population: 3000, carryingCapacity: 9000 }),
          makeSettlement({ id: "c", population: 5000, carryingCapacity: 7000 }),
        ],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "c"],
        ],
      );
    const worldA = build();
    const worldB = build();
    const flowsA = runMigration(worldA);
    const flowsB = runMigration(worldB);
    expect(flowsA).toEqual(flowsB);
    for (const id of ["a", "b", "c"]) {
      expect(worldA.settlements[id].population).toBe(worldB.settlements[id].population);
    }
  });
});

describe("엔진 통합 (§33 보존 불변식)", () => {
  it("60틱 후 총인구 변화 = 원장 총합 (이주 포함)", () => {
    const state = initializeWorldState(
      generateWorld({ ...createDefaultWorldConfig("migration-engine"), resolution: 128 }),
    );
    const engine = new SimulationEngine(state);
    const initial = Object.values(state.settlements).reduce((sum, s) => sum + s.population, 0);
    engine.applyTicks(60);
    const current = Object.values(state.settlements).reduce((sum, s) => sum + s.population, 0);
    expect(state.changeLedger.total()).toBe(current - initial);
  });
});
