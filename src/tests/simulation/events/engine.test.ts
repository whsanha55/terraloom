import { describe, expect, it } from "vitest";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { ongoingMultiplier } from "@/simulation/events/effects";
import type { EventTemplate } from "@/simulation/events/types";
import { SimulationEngine } from "@/simulation/core/engine";
import { runFoodSettlement } from "@/simulation/systems/food";
import { runPopulationChange } from "@/simulation/systems/population";
import { makeSettlement, makeWorld } from "../testWorld";

/** 항상 발생하는 테스트용 효과형 템플릿 */
function alwaysTemplate(overrides: Partial<EventTemplate> = {}): EventTemplate {
  return {
    id: "testAlways",
    version: 1,
    category: "social",
    kind: "effect",
    name: "테스트 사건",
    descriptionTemplate: "테스트",
    scope: "settlement",
    preconditions: [{ metric: "settlement.population", operator: "gte", value: 0 }],
    probability: { base: 1, factors: [] },
    duration: { minTicks: 3, maxTicks: 3 },
    immediateEffects: [],
    ongoingEffects: [
      { targetMetric: "settlement.foodProduction", operation: "multiply", value: 0.5, minimum: 0 },
    ],
    resolutionEffects: [],
    followUpCandidates: [],
    cooldownTicks: 6,
    maximumConcurrentInstances: 1,
    importance: 40,
    tags: [],
    source: "builtin",
    ...overrides,
  };
}

function makeEventEngine(templates: EventTemplate[]): EventEngine {
  return new EventEngine([...BUILTIN_TEMPLATES, ...templates]);
}

describe("EventEngine — 사건 평가·발생 (§9.3.11~13)", () => {
  it("조건을 만족하지 않으면 사건이 후보가 되지도 않는다 (§33)", () => {
    const world = makeWorld([makeSettlement({ id: "aren", population: 100 })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([
      alwaysTemplate({
        id: "testGated",
        preconditions: [{ metric: "settlement.population", operator: "gte", value: 5000 }],
      }),
    ]);
    engine.run(world);
    expect(engine.lastTickEvaluations.filter((e) => e.eventTemplateId === "testGated").length).toBe(0);
    expect(world.activeEvents.filter((e) => e.templateId === "testGated").length).toBe(0);
  });

  it("조건을 만족하면 확률 평가 대상이 되고 근거가 기록된다 (§13.1)", () => {
    const world = makeWorld([makeSettlement({ id: "aren", stability: 30 })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([
      alwaysTemplate({
        probability: { base: 0.5, factors: [] },
      }),
    ]);
    engine.run(world);
    const evaluation = engine.lastTickEvaluations.find((e) => e.eventTemplateId === "testAlways");
    expect(evaluation).toBeDefined();
    expect(evaluation?.finalProbability).toBe(0.5);
    expect(evaluation?.baseProbability).toBe(0.5);
    expect(evaluation?.randomValue).toBeGreaterThanOrEqual(0);
    expect(evaluation?.occurred).toBe(evaluation!.randomValue < 0.5);
  });

  it("발생한 사건은 확률 평가 기록이 상태에 보존된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world);
    expect(world.probabilityEvaluations.filter((e) => e.occurred).length).toBe(1);
  });

  it("발생 시 활성 사건이 등록되고 도시 activeEventIds가 동기화된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world);
    const event = world.activeEvents.find((e) => e.templateId === "testAlways");
    expect(event).toBeDefined();
    expect(event?.targetId).toBe("aren");
    expect(event?.durationTicks).toBe(3);
    expect(event?.endsAtTick).toBe(4);
    expect(world.settlements.aren?.activeEventIds).toContain(event?.id);
  });

  it("지속 기간은 템플릿 범위 안에서 결정론적으로 결정된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const twin = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 7;
    twin.clock.currentTick = 7;
    const a = makeEventEngine([
      alwaysTemplate({ duration: { minTicks: 2, maxTicks: 12 } }),
    ]);
    const b = makeEventEngine([
      alwaysTemplate({ duration: { minTicks: 2, maxTicks: 12 } }),
    ]);
    a.run(world);
    b.run(twin);
    const eventA = world.activeEvents[0];
    const eventB = twin.activeEvents[0];
    expect(eventA?.durationTicks).toBe(eventB?.durationTicks);
    expect(eventA?.durationTicks).toBeGreaterThanOrEqual(2);
    expect(eventA?.durationTicks).toBeLessThanOrEqual(12);
  });
});

describe("EventEngine — 쿨다운·중복 제한 (§13, §14.1)", () => {
  it("활성 중인 동일 사건은 maximumConcurrentInstances로 재발하지 않는다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world);
    expect(world.activeEvents.length).toBe(1);
    world.clock.currentTick = 2;
    engine.run(world);
    expect(world.activeEvents.length).toBe(1);
    expect(engine.lastTickEvaluations.filter((e) => e.eventTemplateId === "testAlways").length).toBe(0);
  });

  it("쿨다운 중에는 재발하지 않고 이후에는 재발할 수 있다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world); // 발생 — 종료 틱 4, 쿨다운 해제 틱 10

    world.clock.currentTick = 4;
    engine.run(world); // 종료 처리
    expect(world.activeEvents.length).toBe(0);
    expect(world.eventHistory.length).toBe(1);
    expect(world.eventHistory[0]?.endedTick).toBe(4);

    world.clock.currentTick = 6;
    engine.run(world); // 쿨다운 중
    expect(world.activeEvents.length).toBe(0);

    world.clock.currentTick = 10;
    engine.run(world); // 쿨다운 직후 — 재발 억제 인자(M_cooldown)가 붙는다
    const damped = engine.lastTickEvaluations.find((e) => e.eventTemplateId === "testAlways");
    expect(damped?.modifiers.some((m) => m.source === "cooldown.recent")).toBe(true);
    expect(damped?.finalProbability).toBeLessThanOrEqual(0.5);

    world.clock.currentTick = 16;
    engine.run(world); // 감쇠 창 이후 — 억제 없이 재발 가능
    expect(world.activeEvents.length).toBe(1);
  });

  it("maximumConcurrentInstances가 2면 다른 도시에 동시 발생이 가능하다", () => {
    const world = makeWorld([makeSettlement({ id: "a1" }), makeSettlement({ id: "a2" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate({ maximumConcurrentInstances: 2 })]);
    engine.run(world);
    expect(world.activeEvents.length).toBe(2);
  });
});

describe("EventEngine — 종료 처리·수정자 원복 (§9.3.14, §12.2.1)", () => {
  it("사건 종료 후 수정자 스택이 원복된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world);
    const registry = engine.registry;
    const during = ongoingMultiplier(registry, world.activeEvents, "aren", "settlement.foodProduction");
    expect(during).toBeCloseTo(0.5, 5);

    world.clock.currentTick = 4;
    engine.run(world);
    expect(world.activeEvents.length).toBe(0);
    expect(ongoingMultiplier(registry, [], "aren", "settlement.foodProduction")).toBe(1);
  });

  it("종료 효과(resolutionEffects)는 종료 시 1회 적용된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", stability: 50 })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([
      alwaysTemplate({
        immediateEffects: [],
        ongoingEffects: [],
        resolutionEffects: [
          { targetMetric: "settlement.stability", operation: "add", value: 5, minimum: 0, maximum: 100 },
        ],
      }),
    ]);
    engine.run(world);
    expect(world.settlements.aren?.stability).toBe(50); // 발생 시점에는 변화 없음
    world.clock.currentTick = 4;
    engine.run(world);
    expect(world.settlements.aren?.stability).toBe(55);
  });

  it("종료된 사건은 도시 activeEventIds에서 제거된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate()]);
    engine.run(world);
    const eventId = world.activeEvents[0]?.id;
    world.clock.currentTick = 4;
    engine.run(world);
    expect(world.settlements.aren?.activeEventIds).not.toContain(eventId);
  });
});

describe("EventEngine — 통지형 사건 (§12.4)", () => {
  function notificationEngine(): EventEngine {
    return makeEventEngine([
      alwaysTemplate({
        id: "testNotice",
        kind: "notification",
        probability: { base: 1, factors: [] },
        duration: { minTicks: 0, maxTicks: 0 },
        preconditions: [
          { metric: "settlement.lastOutMigrationRatio", operator: "gte", value: 0.05 },
        ],
        ongoingEffects: [],
        cooldownTicks: 6,
        importance: 65,
      }),
    ]);
  }

  it("임계값(순유출 ≥ 5%)을 넘으면 기록만 남기고 상태를 바꾸지 않는다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 5;
    world.changeLedger.record({ tick: 5, settlementId: "aren", cause: "migration_out", amount: -300 });
    const before = world.settlements.aren;
    const populationBefore = before?.population;
    const stabilityBefore = before?.stability;

    const engine = notificationEngine();
    engine.run(world);

    expect(world.eventHistory.filter((h) => h.templateId === "testNotice").length).toBe(1);
    expect(world.activeEvents.length).toBe(0);
    expect(world.settlements.aren?.population).toBe(populationBefore);
    expect(world.settlements.aren?.stability).toBe(stabilityBefore);
  });

  it("임계값 미만이면 발생하지 않는다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 5;
    world.changeLedger.record({ tick: 5, settlementId: "aren", cause: "migration_out", amount: -100 });
    const engine = notificationEngine();
    engine.run(world);
    expect(world.eventHistory.filter((h) => h.templateId === "testNotice").length).toBe(0);
  });

  it("통지형도 쿨다운을 따른다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 5;
    world.changeLedger.record({ tick: 5, settlementId: "aren", cause: "migration_out", amount: -300 });
    const engine = notificationEngine();
    engine.run(world);
    world.clock.currentTick = 6;
    world.changeLedger.record({ tick: 6, settlementId: "aren", cause: "migration_out", amount: -300 });
    engine.run(world);
    expect(world.eventHistory.filter((h) => h.templateId === "testNotice").length).toBe(1);
  });
});

describe("EventEngine — 런타임 오류 격리 (§22.1)", () => {
  it("알 수 없는 메트릿을 만난 템플릿은 격리되고 나머지는 계속 동작한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([alwaysTemplate(), alwaysTemplate({ id: "testBroken" })]);
    // 검증을 우회해 런타임에만 실패하는 템플릿 주입
    engine.registry.set(
      "testBrokenRuntime",
      alwaysTemplate({
        id: "testBrokenRuntime",
        preconditions: [{ metric: "settlement.glitch", operator: "gt", value: 0 }],
      }),
    );
    engine.run(world);
    expect(engine.isolatedTemplates.has("testBrokenRuntime")).toBe(true);
    expect(world.activeEvents.some((e) => e.templateId === "testAlways")).toBe(true);
  });
});

describe("SimulationEngine 통합 — 이벤트 효과가 시스템에 적용된다", () => {
  it("활성 가뭄은 식량 생산을 ×0.55로 낮춘다", () => {
    const normal = makeWorld([
      makeSettlement({ id: "aren", population: 4000, carryingCapacity: 10000, foodStock: 30000 }),
    ]);
    const dry = makeWorld([
      makeSettlement({ id: "aren", population: 4000, carryingCapacity: 10000, foodStock: 30000 }),
    ]);
    const drought = BUILTIN_TEMPLATES.find((t) => t.id === "drought");
    if (!drought) throw new Error("drought 없음");
    dry.activeEvents.push({
      id: "evt:drought:aren:1",
      templateId: "drought",
      templateVersion: drought.version,
      targetId: "aren",
      scope: "settlement",
      importance: drought.importance,
      startedTick: 0,
      durationTicks: 12,
      endsAtTick: 12,
      chainDepth: 0,
    });

    new SimulationEngine(normal).tick();
    new SimulationEngine(dry).tick();
    expect(dry.settlements.aren?.foodProduction).toBeCloseTo(
      (normal.settlements.aren?.foodProduction ?? 0) * 0.55,
      -1,
    );
  });

  it("활성 교역로 단절은 해당 루트의 교역을 차단한다", () => {
    const world = makeWorld(
      [
        makeSettlement({ id: "rich", population: 3000, carryingCapacity: 20000, foodStock: 50000 }),
        makeSettlement({ id: "poor", population: 7000, carryingCapacity: 5000, foodStock: 0 }),
      ],
      [["rich", "poor"]],
    );
    const open = makeWorld(
      [
        makeSettlement({ id: "rich", population: 3000, carryingCapacity: 20000, foodStock: 50000 }),
        makeSettlement({ id: "poor", population: 7000, carryingCapacity: 5000, foodStock: 0 }),
      ],
      [["rich", "poor"]],
    );

    const disruption = BUILTIN_TEMPLATES.find((t) => t.id === "routeDisruption");
    if (!disruption) throw new Error("routeDisruption 없음");
    const routeId = Object.keys(world.routes)[0];
    if (!routeId) throw new Error("루트 없음");
    world.activeEvents.push({
      id: `evt:routeDisruption:${routeId}:1`,
      templateId: "routeDisruption",
      templateVersion: disruption.version,
      targetId: routeId,
      scope: "route",
      importance: disruption.importance,
      startedTick: 0,
      durationTicks: 12,
      endsAtTick: 12,
      chainDepth: 0,
    });

    world.clock.currentTick = 1;
    open.clock.currentTick = 1;
    const registry = new EventEngine(BUILTIN_TEMPLATES).registry;
    runFoodSettlement(world, {
      routeCapacityMultiplier: (routeId) => ongoingMultiplier(registry, world.activeEvents, routeId, "route.capacity"),
    });
    runFoodSettlement(open, {
      routeCapacityMultiplier: (routeId) => ongoingMultiplier(registry, open.activeEvents, routeId, "route.capacity"),
    });
    // 단절되지 않은 세계는 poor가 교역을 받아 미충족이 0이어야 한다
    expect(open.settlements.poor?.unmetRatio).toBe(0);
    // 단절된 세계는 교역이 없어 미충족이 발생한다
    expect(world.settlements.poor?.unmetRatio).toBeGreaterThan(0);
  });

  it("전염병 immediate 효과로 diseaseLevel이 오르고 인구 시스템이 질병 사망을 기록한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", population: 10000 })]);
    world.clock.currentTick = 1;
    const engine = makeEventEngine([
      alwaysTemplate({
        id: "testPlague",
        immediateEffects: [
          { targetMetric: "settlement.diseaseLevel", operation: "add", value: 0.4, minimum: 0, maximum: 1 },
        ],
        ongoingEffects: [],
      }),
    ]);
    engine.run(world);
    expect(world.settlements.aren?.diseaseLevel).toBeCloseTo(0.4, 5);

    const diseaseBefore = world.changeLedger.totalsByCause().disease;
    runPopulationChange(world);
    expect(world.changeLedger.totalsByCause().disease).toBeLessThan(diseaseBefore); // 음수 증가
  });
});

describe("EventEngine — 결정론 (§7)", () => {
  it("내장 템플릿은 장기 실행에서 격리되지 않는다 (§22.1 회귀 방지)", () => {
    const world = makeWorld(
      [makeSettlement({ id: "a", areaRiverVolume: 2 }), makeSettlement({ id: "b", population: 6000 })],
      [["a", "b"]],
      "evt-noisolate",
    );
    const engine = new SimulationEngine(world);
    engine.applyTicks(120);
    expect(engine.eventEngine.isolatedTemplates.size).toBe(0);
    expect([...engine.eventEngine.registry.keys()].sort()).toEqual(
      BUILTIN_TEMPLATES.map((t) => t.id).sort(),
    );
  });

  it("같은 시드·같은 틱에서 두 실행의 사건 이력이 동일하다", () => {
    const runHistory = (): string[] => {
      const world = makeWorld(
        [makeSettlement({ id: "a", stability: 20, foodMonthsRemaining: 0.4 }), makeSettlement({ id: "b" })],
        [],
        "evt-det",
      );
      const engine = makeEventEngine([]);
      for (let tick = 1; tick <= 48; tick++) {
        world.clock.currentTick = tick;
        world.settlements.a.stability = 20;
        world.settlements.a.foodMonthsRemaining = 0.4;
        engine.run(world);
      }
      return [...world.activeEvents.map((e) => e.id), ...world.eventHistory.map((h) => h.id)];
    };
    expect(runHistory()).toEqual(runHistory());
  });
});
