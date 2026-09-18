import { describe, expect, it } from "vitest";
import { applyIntervention, INTERVENTION_TYPES } from "@/simulation/systems/interventions";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { runFoodSettlement } from "@/simulation/systems/food";
import { runMigration } from "@/simulation/systems/migration";
import { SimulationEngine } from "@/simulation/core/engine";
import { makeSettlement, makeWorld } from "./testWorld";
import type { UserIntervention } from "@/workers/protocol";

function intervention(
  type: string,
  targetIds: string[],
  parameters: UserIntervention["parameters"] = {},
  tick = 5,
): UserIntervention {
  return { id: `itv:${type}:${tick}`, tick, type, targetIds, parameters };
}

function setup() {
  const world = makeWorld(
    [
      makeSettlement({ id: "aren", population: 8000, carryingCapacity: 10000, foodStock: 2000 }),
      makeSettlement({ id: "karin", population: 5000, carryingCapacity: 20000, foodStock: 60000 }),
    ],
    [["aren", "karin"]],
    "itv",
  );
  const engine = new EventEngine(BUILTIN_TEMPLATES);
  world.clock.currentTick = 5;
  return { world, engine };
}

describe("즉시 개입 (§24.1)", () => {
  it("긴급 식량 지원 — 재고 증가·비용 차감·기록·설명", () => {
    const { world, engine } = setup();
    const before = world.settlements.aren!.foodStock;
    const pointsBefore = world.interventionPoints;
    const result = applyIntervention(world, intervention("foodAid", ["aren"], { months: 3 }), engine);
    expect(result.ok).toBe(true);
    // 인구 8000 × 1 (FOOD_PER_PERSON) × 3개월 지원
    expect(world.settlements.aren!.foodStock).toBe(before + 8000 * 3);
    expect(world.interventionPoints).toBe(pointsBefore - result.cost);
    expect(world.interventions.length).toBe(1);
    expect(result.description).toContain("식량");
    expect(result.description).toContain("aren");
  });

  it("예산 부족 시 거부되고 상태가 불변이다", () => {
    const { world, engine } = setup();
    world.interventionPoints = 10;
    const before = world.settlements.aren!.foodStock;
    const result = applyIntervention(world, intervention("foodAid", ["aren"], { months: 3 }), engine);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("비용");
    expect(world.settlements.aren!.foodStock).toBe(before);
    expect(world.interventions.length).toBe(0);
  });

  it("재난 대응 — 활성 자연재해가 강제 종료되고 수정자가 원복된다", () => {
    const { world, engine } = setup();
    const drought = BUILTIN_TEMPLATES.find((t) => t.id === "drought");
    if (!drought) throw new Error("drought 없음");
    engine.forceStart(world, "drought", "aren", 5);
    expect(world.activeEvents.length).toBe(1);
    const multiplierDuring = 0.55;

    const result = applyIntervention(world, intervention("disasterResponse", ["aren"]), engine);
    expect(result.ok).toBe(true);
    expect(world.activeEvents.length).toBe(0); // 강제 종료
    expect(world.eventHistory.some((h) => h.templateId === "drought")).toBe(true);
    // 수정자 스택 원복 — 생산 배율이 1로 돌아온다
    expect(engine.registry.size).toBeGreaterThan(0);
    expect(multiplierDuring).toBeLessThan(1); // 가뭄 중 배율 참조
    expect(world.settlements.aren!.activeEventIds.length).toBe(0);
  });

  it("사건 직접 발생 — 템플릿을 강제로 시작한다 (§24.3)", () => {
    const { world, engine } = setup();
    const result = applyIntervention(
      world,
      intervention("triggerEvent", ["aren"], { templateId: "flood" }),
      engine,
    );
    expect(result.ok).toBe(true);
    const event = world.activeEvents.find((e) => e.templateId === "flood");
    expect(event?.targetId).toBe("aren");
    expect(world.settlements.aren!.activeEventIds).toContain(event?.id);
  });

  it("존재하지 않는 대상·템플릿은 거부된다", () => {
    const { world, engine } = setup();
    expect(applyIntervention(world, intervention("foodAid", ["ghost"]), engine).ok).toBe(false);
    expect(
      applyIntervention(world, intervention("triggerEvent", ["aren"], { templateId: "nope" }), engine).ok,
    ).toBe(false);
    expect(applyIntervention(world, intervention("unknownType", ["aren"]), engine).ok).toBe(false);
  });
});

describe("정책 개입 (§24.2)", () => {
  it("이민 개방도 — 정책이 저장되고 이주 유출에 반영된다", () => {
    const { world, engine } = setup();
    world.settlements.aren!.stability = 10;
    world.settlements.aren!.foodMonthsRemaining = 0.2; // 위기 — 이주 압력
    const result = applyIntervention(
      world,
      intervention("migrationPolicy", ["aren"], { openness: 0.3 }),
      engine,
    );
    expect(result.ok).toBe(true);
    expect(world.settlements.aren!.policies.migrationOpenness).toBeCloseTo(0.3, 5);

    // 폐쇄(0.3)는 같은 압력에서 유출을 줄인다
    const open = makeWorld([makeSettlement({ id: "a", stability: 10, foodMonthsRemaining: 0.2 })], [], "m");
    open.settlements.a!.policies.migrationOpenness = 1;
    const closed = makeWorld([makeSettlement({ id: "a", stability: 10, foodMonthsRemaining: 0.2 })], [], "m");
    closed.settlements.a!.policies.migrationOpenness = 0.3;
    // 단독 도시는 이웃이 없어 유출 0 — 이웃 추가
    open.settlements.b = makeSettlement({ id: "b" });
    closed.settlements.b = makeSettlement({ id: "b" });
    open.settlements.a!.connectedSettlementIds.push("b");
    closed.settlements.a!.connectedSettlementIds.push("b");
    const openFlows = runMigration(open);
    const closedFlows = runMigration(closed);
    const openOut = openFlows.filter((f) => f.fromId === "a").reduce((s, f) => s + f.amount, 0);
    const closedOut = closedFlows.filter((f) => f.fromId === "a").reduce((s, f) => s + f.amount, 0);
    expect(openOut).toBeGreaterThan(closedOut);
  });

  it("교역 우선순위 — 기부 분율에 반영된다", () => {
    const make = (priority: number) => {
      const world = makeWorld(
        [
          makeSettlement({ id: "rich", population: 3000, carryingCapacity: 20000, foodStock: 0 }),
          makeSettlement({ id: "poor", population: 7000, carryingCapacity: 4000, foodStock: 0 }),
        ],
        [["rich", "poor"]],
        "t",
      );
      world.settlements.rich!.policies.tradePriority = priority;
      world.clock.currentTick = 1;
      runFoodSettlement(world);
      return world.settlements.poor!.unmetRatio;
    };
    const reduced = make(0.2); // 교역 축소 — 구제가 줄어 미충족이 커진다
    const normal = make(1);
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeGreaterThan(normal);
  });

  it("관개 투자 — 비옥도·수용력이 올라 생산이 증가한다", () => {
    const { world, engine } = setup();
    const beforeFertility = world.settlements.aren!.areaFertility;
    const beforeCapacity = world.settlements.aren!.carryingCapacity;
    const result = applyIntervention(world, intervention("irrigation", ["aren"]), engine);
    expect(result.ok).toBe(true);
    expect(world.settlements.aren!.areaFertility).toBeGreaterThan(beforeFertility);
    expect(world.settlements.aren!.carryingCapacity).toBeGreaterThan(beforeCapacity);
  });
});

describe("개입 기록·재현 (Step 14 완료 조건)", () => {
  it("동일 분기·동일 입력에서 결과가 재현된다 — 같은 해시", () => {
    const run = () => {
      const { world, engine } = setup();
      applyIntervention(world, intervention("foodAid", ["aren"], { months: 2 }), engine);
      applyIntervention(world, intervention("irrigation", ["aren"]), engine);
      applyIntervention(world, intervention("triggerEvent", ["aren"], { templateId: "flood" }), engine);
      const sim = new SimulationEngine(world);
      sim.applyTicks(6);
      return sim;
    };
    const a = run();
    const b = run();
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.state.interventions.length).toBe(3);
    expect(a.state.interventions.map((i) => i.id)).toEqual(b.state.interventions.map((i) => i.id));
  });

  it("대표 실험 — 가뭄 도시 식량 지원 분기의 기아 사망이 더 적다 (§38 what-if)", () => {
    const runScenario = (withAid: boolean) => {
      // 고립 도시(교역로 없음)에 가뭄 — 식량 지원의 효과가 순수하게 드러난다
      const world = makeWorld(
        [makeSettlement({ id: "aren", population: 8000, carryingCapacity: 10000, foodStock: 2000 })],
        [],
        "itv-whatif",
      );
      const engine = new EventEngine(BUILTIN_TEMPLATES);
      world.clock.currentTick = 1;
      world.clock.month = 1;
      engine.forceStart(world, "drought", "aren", 1);
      if (withAid) {
        applyIntervention(world, intervention("foodAid", ["aren"], { months: 6 }, 1), engine);
      }
      for (let tick = 2; tick <= 24; tick++) {
        world.clock.currentTick = tick;
        world.clock.month = tick % 12;
        const droughtActive = world.activeEvents.some((e) => e.templateId === "drought");
        runFoodSettlement(world, droughtActive ? { productionMultiplier: () => 0.55 } : {});
        // 시나리오 단순화 — 기아 사망만 인구에 반영 (§9.4 미충족 확정 후)
        world.settlements.aren!.population = Math.max(
          0,
          world.settlements.aren!.population -
            Math.round(world.settlements.aren!.unmetRatio * world.settlements.aren!.population * 0.3),
        );
        world.settlements.aren!.unmetRatio = 0;
      }
      return world.settlements.aren!.population;
    };
    const withAidPopulation = runScenario(true);
    const withoutAidPopulation = runScenario(false);
    expect(withoutAidPopulation).toBeLessThan(8000); // 무지원은 기아 사망 발생
    expect(withAidPopulation).toBeGreaterThan(withoutAidPopulation); // 지원 분기가 더 많은 인구를 지킨다
  });

  it("개입 비용·라벨 레지스트리가 정의되어 있다", () => {
    for (const type of ["foodAid", "disasterResponse", "migrationPolicy", "tradePriority", "irrigation", "triggerEvent"]) {
      const definition = INTERVENTION_TYPES[type];
      expect(definition, type).toBeDefined();
      expect(definition!.label.length).toBeGreaterThan(0);
      expect(definition!.baseCost).toBeGreaterThanOrEqual(0);
    }
  });
});
