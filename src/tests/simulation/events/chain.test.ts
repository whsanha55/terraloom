import { describe, expect, it } from "vitest";
import { EventEngine, MAX_CHAIN_DEPTH } from "@/simulation/events/engine";
import { causalChain } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import type { EventTemplate } from "@/simulation/events/types";
import { makeSettlement, makeWorld } from "../testWorld";

/** 항상 발생하는 효과형 템플릿 — 후보·깊이 구성 가능 */
function tmpl(id: string, overrides: Partial<EventTemplate> = {}): EventTemplate {
  return {
    id,
    version: 1,
    category: "social",
    kind: "effect",
    name: `사건-${id}`,
    descriptionTemplate: "테스트",
    scope: "settlement",
    preconditions: [{ metric: "settlement.population", operator: "gte", value: 0 }],
    probability: { base: 1, factors: [] },
    duration: { minTicks: 2, maxTicks: 2 },
    immediateEffects: [],
    ongoingEffects: [],
    resolutionEffects: [],
    followUpCandidates: [],
    cooldownTicks: 2,
    maximumConcurrentInstances: 1,
    importance: 20,
    tags: [],
    source: "builtin",
    ...overrides,
  };
}

function followUpOf(templateId: string, overrides: Partial<EventTemplate["followUpCandidates"][number]> = {}) {
  return {
    eventTemplateId: templateId,
    minimumDelayTicks: 1,
    maximumDelayTicks: 3,
    baseWeight: 1,
    conditions: [],
    ...overrides,
  };
}

function engineWith(templates: EventTemplate[]): EventEngine {
  return new EventEngine([...BUILTIN_TEMPLATES, ...templates]);
}

describe("연쇄 사건 — 후보 등록·지연·발생 (§14)", () => {
  it("선행 사건 발생이 후속 후보를 등록한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 1;
    const engine = engineWith([
      tmpl("Aparent", { followUpCandidates: [followUpOf("Bchild")] }),
      // 자연 발생은 사실상 불가(1e-9) — 연쇄 경로로만 발생 확인
      tmpl("Bchild", { probability: { base: 1e-9, factors: [] } }),
    ]);
    engine.run(world);
    expect(world.activeEvents.length).toBeGreaterThanOrEqual(1); // parent 발생
    const candidate = world.scheduledEvents.find((s) => s.templateId === "Bchild");
    expect(candidate).toBeDefined();
    expect(candidate?.targetId).toBe("aren");
    expect(candidate?.chainDepth).toBe(1);
    expect(candidate?.activateAtTick).toBe(2); // tick1 + 최소 지연 1
    expect(candidate?.expiresAtTick).toBe(4); // tick1 + 최대 지연 3
    expect(candidate?.causedByEventId).toBe(world.activeEvents.find((e) => e.templateId === "Aparent")?.id);
  });

  it("최소 지연 전에는 후속 사건이 발생하지 않는다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("Aparent", { followUpCandidates: [followUpOf("Bchild")] }),
      tmpl("Bchild"),
    ]);
    world.clock.currentTick = 1;
    engine.run(world); // parent 발생 + 후보 등록 (활성 틱 2)
    world.clock.currentTick = 1; // 같은 틱 재평가는 activation 미도달
    engine.activateScheduled(world);
    expect(world.activeEvents.filter((e) => e.templateId === "Bchild").length).toBe(0);
  });

  it("지연 경과 후 조건·확률 판정을 거쳐 발생하고 인과가 기록된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("Aparent", { followUpCandidates: [followUpOf("Bchild")] }),
      tmpl("Bchild"),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    const parentId = world.activeEvents.find((e) => e.templateId === "Aparent")?.id;
    world.clock.currentTick = 2; // 활성 틱 도달
    engine.activateScheduled(world);
    const child = world.activeEvents.find((e) => e.templateId === "Bchild");
    expect(child).toBeDefined();
    expect(child?.chainDepth).toBe(1);
    expect(child?.causedByEventId).toBe(parentId);
    // 발생 후보는 소진된다
    expect(world.scheduledEvents.filter((s) => s.templateId === "Bchild").length).toBe(0);
  });

  it("조건이 개선되면 후속 사건이 발생하지 않고 후보가 만료된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", stability: 90 })]);
    const engine = engineWith([
      tmpl("Aparent", {
        followUpCandidates: [
          followUpOf("Bchild", { conditions: [{ metric: "settlement.stability", operator: "lt", value: 50 }] }),
        ],
      }),
      tmpl("Bchild"),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    for (let tick = 2; tick <= 5; tick++) {
      world.clock.currentTick = tick;
      engine.activateScheduled(world);
    }
    expect(world.activeEvents.filter((e) => e.templateId === "Bchild").length).toBe(0);
    expect(world.scheduledEvents.filter((s) => s.templateId === "Bchild").length).toBe(0); // 만료
  });

  it("선행 사건 확률 보정(M_chain)이 평가에 기록된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("Aparent", { followUpCandidates: [followUpOf("Bchild", { baseWeight: 0.5 })] }),
      tmpl("Bchild", { probability: { base: 0.4, factors: [] } }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    world.clock.currentTick = 2;
    engine.activateScheduled(world);
    const evaluation = engine.lastTickEvaluations.find((e) => e.eventTemplateId === "Bchild");
    expect(evaluation).toBeDefined();
    const chainModifier = evaluation?.modifiers.find((m) => m.source === "chain.weight");
    expect(chainModifier?.value).toBe(0.5);
    expect(evaluation?.finalProbability).toBeCloseTo(0.4 * 0.5, 6);
    expect(evaluation?.occurred).toBe((evaluation?.randomValue ?? 1) < 0.2);
  });

  it("후보가 대기 중인 동안 같은 (사건,대상)의 자연 발생 평가는 중복 롤하지 않는다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("Aparent", { followUpCandidates: [followUpOf("Bchild")] }),
      tmpl("Bchild", { probability: { base: 0.3, factors: [] } }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world); // parent + 후보 등록
    world.clock.currentTick = 1; // 같은 틱 재실행 — 자연 경로는 스킵
    engine.run(world);
    const evaluations = engine.lastTickEvaluations.filter((e) => e.eventTemplateId === "Bchild");
    expect(evaluations.length).toBe(0);
  });
});

describe("연쇄 사건 — 무한 연쇄 방지 (§14.1)", () => {
  it("연쇄 깊이가 제한(4)을 넘으면 후보가 등록되지 않는다", () => {
    expect(MAX_CHAIN_DEPTH).toBe(4);
    const chainTemplates = [
      "linkA",
      "linkB",
      "linkC",
      "linkD",
      "linkE",
      "linkF",
    ].map((id, index, all) =>
      tmpl(id, {
        // 지속 1틱 — 체인이 도시별 동시 상한(3)에 걸리지 않고 순차 진행.
        // 루트만 자연 발생(base 1). 자식은 자연 발생 불가(1e-9) + 연쇄 가중치 1e9로
        // "연쇄로만, 확정적으로" 발생 — 깊이 제한만을 검증하기 위한 구성이다
        probability: index === 0 ? { base: 1, factors: [] } : { base: 1e-9, factors: [] },
        duration: { minTicks: 1, maxTicks: 1 },
        cooldownTicks: 20,
        followUpCandidates:
          index + 1 < all.length
            ? [followUpOf(all[index + 1]!, { minimumDelayTicks: 0, maximumDelayTicks: 1, baseWeight: 1e9 })]
            : [],
      }),
    );
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith(chainTemplates);
    for (let tick = 1; tick <= 24; tick++) {
      world.clock.currentTick = tick;
      engine.activateScheduled(world);
      engine.run(world);
    }
    const depths = new Map<string, number>();
    for (const event of world.eventHistory) {
      depths.set(event.templateId, Math.max(depths.get(event.templateId) ?? 0, event.chainDepth));
    }
    expect(depths.get("linkE")).toBe(4); // A→B→C→D→E — 깊이 4까지 허용
    expect(depths.has("linkF")).toBe(false); // 깊이 5는 차단
  });

  it("순환(A→B→A) 후보는 등록이 차단된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("cycA", {
        cooldownTicks: 12,
        followUpCandidates: [followUpOf("cycB", { minimumDelayTicks: 0, maximumDelayTicks: 1 })],
      }),
      tmpl("cycB", {
        cooldownTicks: 12,
        followUpCandidates: [followUpOf("cycA", { minimumDelayTicks: 0, maximumDelayTicks: 1 })],
      }),
    ]);
    for (let tick = 1; tick <= 12; tick++) {
      world.clock.currentTick = tick;
      engine.activateScheduled(world);
      engine.run(world);
    }
    // 순환 차단 + 쿨다운으로 A는 1회, B는 A에서 파생된 1회가 최종 기록 — 반복 폭증 없음
    const aCount = world.eventHistory.filter((h) => h.templateId === "cycA").length;
    const bCount = world.eventHistory.filter((h) => h.templateId === "cycB").length;
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });

  it("도시별 동시 활성 사건은 최대 3개로 제한된다 (§14.1)", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("s1", { duration: { minTicks: 10, maxTicks: 10 }, cooldownTicks: 0 }),
      tmpl("s2", { duration: { minTicks: 10, maxTicks: 10 }, cooldownTicks: 0 }),
      tmpl("s3", { duration: { minTicks: 10, maxTicks: 10 }, cooldownTicks: 0 }),
      tmpl("s4", { duration: { minTicks: 10, maxTicks: 10 }, cooldownTicks: 0 }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    const activeOnAren = world.activeEvents.filter((e) => e.targetId === "aren").length;
    expect(activeOnAren).toBe(3);
    expect(world.activeEvents.some((e) => e.templateId === "s4")).toBe(false);
  });

  it("세계 전체 중요 사건(중요도 50+)은 최대 20개로 제한된다 (§14.1)", () => {
    const settlements = Array.from({ length: 25 }, (_, i) => makeSettlement({ id: `city${i}` }));
    const world = makeWorld(settlements);
    const engine = engineWith([
      tmpl("big", {
        duration: { minTicks: 10, maxTicks: 10 },
        importance: 60,
        maximumConcurrentInstances: 30,
        cooldownTicks: 0,
      }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    expect(world.activeEvents.filter((e) => e.importance >= 50).length).toBe(20);
  });

  it("템플릿 하나의 후속 후보는 최대 5개다 (§14.1)", () => {
    const engine = engineWith([]);
    const six = {
      ...tmpl("sixFollow", {
        followUpCandidates: [1, 2, 3, 4, 5, 6].map((n) => followUpOf(`target${n}`)),
      }),
    };
    expect(() => engine.registry.set("sixFollow", six)).not.toThrow(); // registry 주입은 가능
    const fresh = [six];
    expect(() => new EventEngine(fresh)).toThrow();
  });
});

describe("연쇄 사건 — 인과관계 그래프 (§14)", () => {
  it("causalChain이 루트부터 해당 사건까지의 인과 경로를 반환한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("first1", { cooldownTicks: 12, followUpCandidates: [followUpOf("second1")] }),
      tmpl("second1", { cooldownTicks: 12 }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world); // root 발생
    world.clock.currentTick = 2;
    engine.activateScheduled(world); // leaf 발생
    const leaf = world.activeEvents.find((e) => e.templateId === "second1");
    expect(leaf).toBeDefined();
    const chain = causalChain(world, leaf!.id);
    expect(chain.map((e) => e.templateId)).toEqual(["first1", "second1"]);
  });

  it("발생 통지에 선행 사건 이름이 포함된다 (UI 추적용)", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    const engine = engineWith([
      tmpl("first2", { cooldownTicks: 12, followUpCandidates: [followUpOf("second2")] }),
      tmpl("second2", { cooldownTicks: 12 }),
    ]);
    world.clock.currentTick = 1;
    engine.run(world);
    world.clock.currentTick = 2;
    engine.activateScheduled(world);
    const notice = engine.lastTickNotices.find((n) => n.templateId === "second2");
    expect(notice?.causedByName).toBe("사건-first2");
  });
});

describe("연쇄 사건 — 대표 시나리오 (§14: 가뭄→흉년→…→폭동/이주)", () => {
  it("내장 템플릿의 후보가 실제 연쇄를 만든다 (고정 시드 결정론)", () => {
    const world = makeWorld(
      [makeSettlement({ id: "a", stability: 25 }), makeSettlement({ id: "b", stability: 25 })],
      [["a", "b"]],
      "chain-scenario",
    );
    const engine = engineWith([]);
    let chained = 0;
    for (let tick = 1; tick <= 600; tick++) {
      world.clock.currentTick = tick;
      // 위기 조건 유지 — 연쇄가 흐르도록
      world.settlements.a.stability = 25;
      world.settlements.a.foodMonthsRemaining = 0.4;
      world.settlements.b.stability = 25;
      engine.activateScheduled(world);
      engine.run(world);
    }
    for (const event of world.eventHistory) {
      if (event.causedByEventId) chained += 1;
    }
    expect(chained).toBeGreaterThan(0);
    // 무한 연쇄 없음 — 이력이 틱 수보다 적게 제한됨
    expect(world.eventHistory.length).toBeLessThan(600);
  });
});
