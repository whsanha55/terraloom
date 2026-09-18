import { describe, expect, it } from "vitest";
import { UnknownMetricError } from "@/simulation/errors";
import { resolveMetric } from "@/simulation/events/metrics";
import { makeSettlement, makeWorld } from "../testWorld";

describe("resolveMetric (§12.1 메트릭 리졸버)", () => {
  const world = makeWorld([makeSettlement({ id: "aren", population: 8000, carryingCapacity: 10000 })]);
  const settlementTarget = { kind: "settlement" as const, id: "aren" };

  it("settlement.* 메트릭을 도시 상태에서 읽는다", () => {
    expect(resolveMetric(world, settlementTarget, "settlement.population")).toBe(8000);
    expect(resolveMetric(world, settlementTarget, "settlement.stability")).toBe(70);
    expect(resolveMetric(world, settlementTarget, "settlement.foodMonthsRemaining")).toBe(3);
  });

  it("파생 메트릭을 계산한다 — overcrowdingRatio", () => {
    expect(resolveMetric(world, settlementTarget, "settlement.overcrowdingRatio")).toBeCloseTo(0.8, 5);
  });

  it("world.* 메트릭을 읽는다", () => {
    world.clock.currentTick = 17;
    world.clock.month = 17 % 12;
    world.clock.year = Math.floor(17 / 12);
    expect(resolveMetric(world, { kind: "world" }, "world.tick")).toBe(17);
    expect(resolveMetric(world, { kind: "world" }, "world.month")).toBe(5);
    expect(resolveMetric(world, { kind: "world" }, "world.year")).toBe(1);
  });

  it("route.capacity 메트릭을 읽는다", () => {
    const routed = makeWorld([makeSettlement({ id: "a" }), makeSettlement({ id: "b" })], [["a", "b"]]);
    expect(resolveMetric(routed, { kind: "route", id: "route:a-b" }, "route.capacity")).toBeGreaterThan(0);
  });

  it("lastOutMigrationRatio는 직전 틱 원장의 유출 비율이다", () => {
    world.clock.currentTick = 3;
    world.changeLedger.record({ tick: 3, settlementId: "aren", cause: "migration_out", amount: -400 });
    expect(resolveMetric(world, settlementTarget, "settlement.lastOutMigrationRatio")).toBeCloseTo(0.05, 6);
  });

  it("알 수 없는 메트릭은 UnknownMetricError를 던진다 (§22.1)", () => {
    expect(() => resolveMetric(world, settlementTarget, "settlement.nonexistent")).toThrow(UnknownMetricError);
    expect(() => resolveMetric(world, settlementTarget, "arbitraryCode")).toThrow(UnknownMetricError);
  });

  it("존재하지 않는 대상은 UnknownMetricError를 던진다", () => {
    expect(() => resolveMetric(world, { kind: "settlement", id: "ghost" }, "settlement.population")).toThrow(
      UnknownMetricError,
    );
  });
});
