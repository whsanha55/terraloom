import { describe, expect, it } from "vitest";
import { describeEvent } from "@/simulation/events/detail";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import type { EventTemplate } from "@/simulation/events/types";
import { makeSettlement, makeWorld } from "../testWorld";

function tmpl(id: string, overrides: Partial<EventTemplate> = {}): EventTemplate {
  return {
    id,
    version: 1,
    category: "natural",
    kind: "effect",
    name: `사건-${id}`,
    descriptionTemplate: "{settlement}에 무언가 일어났다.",
    scope: "settlement",
    preconditions: [{ metric: "settlement.population", operator: "gte", value: 0 }],
    probability: { base: 1, factors: [] },
    duration: { minTicks: 4, maxTicks: 4 },
    immediateEffects: [],
    ongoingEffects: [
      { targetMetric: "settlement.foodProduction", operation: "multiply", value: 0.6, minimum: 0 },
    ],
    resolutionEffects: [],
    followUpCandidates: [
      {
        eventTemplateId: "foodRiot",
        minimumDelayTicks: 1,
        maximumDelayTicks: 4,
        baseWeight: 2.0,
        conditions: [],
      },
    ],
    cooldownTicks: 6,
    maximumConcurrentInstances: 1,
    importance: 70,
    tags: [],
    source: "builtin",
    ...overrides,
  };
}

function setup() {
  const world = makeWorld([makeSettlement({ id: "aren", name: "아렌", stability: 30, foodMonthsRemaining: 0.4 })]);
  const engine = new EventEngine([...BUILTIN_TEMPLATES, tmpl("testDetail")]);
  world.clock.currentTick = 3;
  engine.run(world); // testDetail 발생 (base 1)
  return { world, engine };
}

describe("describeEvent — 사건 상세 (Step 10 관찰 UI 데이터)", () => {
  it("활성 사건의 상세를 조립한다 — 위치·영향·근거·후보", () => {
    const { world, engine } = setup();
    const event = world.activeEvents.find((e) => e.templateId === "testDetail");
    if (!event) throw new Error("사건이 발생하지 않았다");
    const detail = describeEvent(world, engine.registry, event.id);
    if (!detail) throw new Error("상세 없음");

    expect(detail.id).toBe(event.id);
    expect(detail.name).toBe("사건-testDetail");
    expect(detail.status).toBe("active");
    expect(detail.endedTick).toBeNull();
    expect(detail.targetId).toBe("aren");
    expect(detail.targetName).toBe("아렌");
    expect(detail.description).toContain("아렌"); // {settlement} 치환
    expect(detail.importance).toBe(70);
    // 영향 — 지속 효과 라벨
    expect(detail.effects.some((e) => e.label.includes("농업 생산") && e.label.includes("0.6"))).toBe(true);
    // 발생 확률 근거 보존 (§13.1)
    expect(detail.evaluation).not.toBeNull();
    expect(detail.evaluation?.baseProbability).toBe(1);
    // 예상 후속 사건 — 현재 상태 기준 조건부 확률 (§2.2)
    const riot = detail.followUps.find((f) => f.templateId === "foodRiot");
    expect(riot).toBeDefined();
    expect(riot?.eligible).toBe(true); // months 0.4 < 1.2, stability 30 < 55
    expect(riot?.probability).toBeCloseTo(0.02 * 2.0 * 2.5 * 1.8, 6); // base × 연쇄 × 조건 인자들
  });

  it("후보 조건이 개선되면 eligible이 거짓이고 확률 근거에 담긴다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", name: "아렌", stability: 80, foodMonthsRemaining: 9 })]);
    const engine = new EventEngine([...BUILTIN_TEMPLATES, tmpl("testDetail2")]);
    world.clock.currentTick = 3;
    engine.run(world);
    const event = world.activeEvents.find((e) => e.templateId === "testDetail2");
    if (!event) throw new Error("사건이 발생하지 않았다");
    const detail = describeEvent(world, engine.registry, event.id);
    const riot = detail?.followUps.find((f) => f.templateId === "foodRiot");
    expect(riot?.eligible).toBe(false);
  });

  it("종료된 사건은 상태와 종료 틱을 표시한다", () => {
    const { world, engine } = setup();
    const event = world.activeEvents.find((e) => e.templateId === "testDetail");
    if (!event) throw new Error("사건 없음");
    world.clock.currentTick = 7; // endsAt 3+4
    engine.run(world);
    const detail = describeEvent(world, engine.registry, event.id);
    expect(detail?.status).toBe("ended");
    expect(detail?.endedTick).toBe(7);
  });

  it("인과 경로(루트→해당 사건)를 이름으로 반환한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", name: "아렌", stability: 30, foodMonthsRemaining: 0.4 })]);
    const parent = tmpl("aParent", {
      followUpCandidates: [
        { eventTemplateId: "bChild", minimumDelayTicks: 1, maximumDelayTicks: 2, baseWeight: 1e9, conditions: [] },
      ],
    });
    const child = tmpl("bChild", { probability: { base: 1e-9, factors: [] } });
    const engine = new EventEngine([...BUILTIN_TEMPLATES, parent, child]);
    world.clock.currentTick = 1;
    engine.run(world); // 부모 발생
    world.clock.currentTick = 2;
    engine.activateScheduled(world); // 자식 연쇄 발생
    const childEvent = world.activeEvents.find((e) => e.templateId === "bChild");
    if (!childEvent) throw new Error("연쇄 사건 없음");
    const detail = describeEvent(world, engine.registry, childEvent.id);
    expect(detail?.causalChain.map((n) => n.name)).toEqual(["사건-aParent", "사건-bChild"]);
  });

  it("통지형 사건은 확률 평가가 없다 (임계값 기반)", () => {
    const world = makeWorld([makeSettlement({ id: "aren", name: "아렌", foodPriceIndex: 2 })]);
    const engine = new EventEngine(BUILTIN_TEMPLATES);
    world.clock.currentTick = 5;
    engine.run(world); // priceRise 통지 발생
    const record = world.eventHistory.find((h) => h.templateId === "priceRise");
    if (!record) throw new Error("통지 없음");
    const detail = describeEvent(world, engine.registry, record.id);
    expect(detail?.kind).toBe("notification");
    expect(detail?.evaluation).toBeNull();
    expect(detail?.followUps.length).toBe(0);
  });

  it("존재하지 않는 사건 id는 null을 반환한다", () => {
    const { world, engine } = setup();
    expect(describeEvent(world, engine.registry, "evt:ghost:x:1")).toBeNull();
  });
});
