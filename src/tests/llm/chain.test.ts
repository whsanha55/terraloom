import { describe, expect, it } from "vitest";
import {
  buildChainRecommendationPrompt,
  CHAIN_PROMPT_VERSION,
  summarizeChainContext,
  validateChainCandidate,
} from "@/llm/gateway/chain";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { makeSettlement, makeWorld } from "../simulation/testWorld";
import type { ChainRecommendation } from "@/llm/gateway/chain";
import { validateTemplate } from "@/simulation/events/templates/validate";

function setup() {
  const world = makeWorld(
    [
      makeSettlement({ id: "aren", stability: 30, foodMonthsRemaining: 0.4 }),
      makeSettlement({ id: "karin" }),
    ],
    [["aren", "karin"]],
    "chain-llm",
  );
  const engine = new EventEngine(BUILTIN_TEMPLATES);
  world.clock.currentTick = 5;
  // 가뭄을 aren에 강제 발생시켜 연쇄 문맥을 만든다
  const drought = BUILTIN_TEMPLATES.find((t) => t.id === "drought");
  if (!drought) throw new Error("drought 없음");
  world.activeEvents.push({
    id: "evt:drought:aren:5",
    templateId: "drought",
    templateVersion: 1,
    targetId: "aren",
    scope: "settlement",
    importance: 80,
    startedTick: 5,
    durationTicks: 12,
    endsAtTick: 17,
    chainDepth: 0,
  });
  world.settlements.aren?.activeEventIds.push("evt:drought:aren:5");
  return { world, engine };
}

function chainRec(overrides: Partial<ChainRecommendation> = {}): ChainRecommendation {
  return {
    temporaryId: "candidate_1",
    name: "물 분쟁 격화",
    category: "social",
    summary: "마른 강을 두고 상류·하류 마을의 갈등이 커진다.",
    scope: "settlement",
    targetIds: ["aren"],
    preconditions: [],
    suggestedBaseProbability: 0.05,
    suggestedDurationTicks: 6,
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -6 }],
    followUps: [],
    reasoningSummary: "가뭄이 수자원 갈등을 유발합니다.",
    suggestedMinDelayTicks: 2,
    suggestedMaxDelayTicks: 8,
    suggestedChainWeight: 2.0,
    ...overrides,
  };
}

describe("연쇄 문맥 요약 (Step 12 — 활성 사건·주변 상태 전달)", () => {
  it("부모 사건·대상 도시·주변(연결) 도시·허용 메트릭을 전달한다", () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    expect(ctx.parent.templateId).toBe("drought");
    expect(ctx.parent.name).toBe("가뭄");
    expect(ctx.parent.targetId).toBe("aren");
    expect(ctx.settlement.id).toBe("aren");
    expect(ctx.nearby.some((s) => s.id === "karin")).toBe(true); // 연결 이웃
    expect(ctx.allowedMetrics.length).toBeGreaterThan(0);
    expect(ctx.recentHistory).toBeDefined();
  });

  it("존재하지 않는 사건 id는 null", () => {
    const { world, engine } = setup();
    expect(summarizeChainContext(world, engine.registry, "evt:ghost:x:1")).toBeNull();
  });

  it("연쇄 프롬프트는 부모 사건과 지연·가중치 형식을 포함한다", () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const prompt = buildChainRecommendationPrompt(ctx);
    expect(CHAIN_PROMPT_VERSION).toMatch(/^llm-chain-v\d+$/);
    expect(prompt).toContain(CHAIN_PROMPT_VERSION);
    expect(prompt).toContain("가뭄"); // 부모 사건
    expect(prompt).toContain("suggestedChainWeight"); // 연쇄 DSL 필드
    expect(prompt).toContain("karin"); // 주변 도시
  });
});

describe("연쇄 후보 검증 (§20.4 사건 간 인과관계 검증)", () => {
  it("부모 대상 도시의 후보를 안전한 DSL로 변환한다", () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const result = validateChainCandidate(chainRec(), ctx, new Set());
    expect(result.rejected).toBeUndefined();
    expect(result.template).toBeDefined();
    expect(() => validateTemplate(result.template!)).not.toThrow();
    expect(result.scheduled).toBeDefined();
    expect(result.scheduled?.targetId).toBe("aren");
    expect(result.scheduled?.minDelayTicks).toBe(2);
    expect(result.scheduled?.maxDelayTicks).toBe(8);
    expect(result.scheduled?.chainWeight).toBeCloseTo(2.0, 5);
    expect(result.scheduled?.causedByEventId).toBe("evt:drought:aren:5");
  });

  it("연결되지 않은 무관 도시는 인과관계 위반으로 거부된다", () => {
    const { world, engine } = setup();
    // 무관 도시 추가 — aren과 연결 안 됨
    world.settlements.lonely = makeSettlement({ id: "lonely" });
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const result = validateChainCandidate(
      chainRec({ targetIds: ["lonely"] }),
      ctx,
      new Set(),
    );
    expect(result.rejected).toContain("인과");
  });

  it("지연 범위와 연쇄 가중치는 안전 범위로 보정된다", () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const result = validateChainCandidate(
      chainRec({ suggestedMinDelayTicks: -5, suggestedMaxDelayTicks: 400, suggestedChainWeight: 99 }),
      ctx,
      new Set(),
    );
    expect(result.rejected).toBeUndefined();
    expect(result.scheduled?.minDelayTicks).toBe(0);
    expect(result.scheduled?.maxDelayTicks).toBeLessThanOrEqual(36);
    expect(result.scheduled?.chainWeight).toBeLessThanOrEqual(5);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("연쇄 후보 등록 — 규칙 엔진이 발생을 결정 (Step 12 완료 조건)", () => {
  it("등록하면 예정 후보(scheduled)가 생기고 M_chain 평가를 거쳐 발생할 수 있다", async () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const { registerChainTemplate } = await import("@/llm/records");
    const candidate = validateChainCandidate(
      chainRec({
        name: "물 분쟁 격화",
        // 발생 확정을 위한 극단값 — 안전 범위로 보정돼도 충분히 높게
        suggestedBaseProbability: 1,
        suggestedChainWeight: 5,
      }),
      ctx,
      new Set(),
    );
    const template = candidate.template;
    const scheduled = candidate.scheduled;
    if (!template || !scheduled) throw new Error("변환 실패");

    const before = world.scheduledEvents.length;
    const result = registerChainTemplate(world, engine, {
      template,
      scheduled,
      inputHash: "unused", // 아래에서 실제 해시로 덮어쓰기 위해 먼저 실패 확인용
      rawOutput: "{}",
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-chain-v1",
      approvedBy: "automatic",
    });
    // 입력 해시가 실제와 다르면 폐기 (§23)
    expect(result.ok).toBe(false);

    const { computeChainContextHash } = await import("@/llm/gateway/chain");
    const okResult = registerChainTemplate(world, engine, {
      template,
      scheduled,
      inputHash: computeChainContextHash(ctx),
      rawOutput: "{}",
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-chain-v1",
      approvedBy: "automatic",
    });
    expect(okResult.ok).toBe(true);
    expect(world.scheduledEvents.length).toBe(before + 1);
    const registered = world.scheduledEvents.find((s) => s.templateId === template.id);
    expect(registered?.causedByEventId).toBe("evt:drought:aren:5");
    expect(registered?.chainDepth).toBe(1);
    expect(world.llmRecords[world.llmRecords.length - 1]?.approvedBy).toBe("automatic");

    // 실제 발생은 규칙 엔진이 확률로 결정 — 기록에 rawOutput 보존
    expect(world.llmRecords[world.llmRecords.length - 1]?.rawOutput).toBe("{}");
  });

  it("토큰·비용 추정치가 기록에 남는다", async () => {
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const { registerChainTemplate } = await import("@/llm/records");
    const { computeChainContextHash } = await import("@/llm/gateway/chain");
    const candidate = validateChainCandidate(chainRec(), ctx, new Set());
    if (!candidate.template || !candidate.scheduled) throw new Error("변환 실패");
    const result = registerChainTemplate(world, engine, {
      template: candidate.template,
      scheduled: candidate.scheduled,
      inputHash: computeChainContextHash(ctx),
      rawOutput: '{"recommendations":[]}',
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-chain-v1",
      approvedBy: "user",
      usage: { promptTokens: 120, outputTokens: 80 },
    });
    expect(result.ok).toBe(true);
    const record = world.llmRecords[world.llmRecords.length - 1];
    expect(record?.usage?.promptTokens).toBe(120);
    expect(record?.usage?.outputTokens).toBe(80);
    expect(record?.usage?.estimatedCost).toBeGreaterThanOrEqual(0);
  });
});

describe("자동 승인 안전 등급 (§21.2)", () => {
  it("낮은 영향 후보만 low 등급이다", async () => {
    const { classifySafety } = await import("@/llm/validation/safety");
    const { world, engine } = setup();
    const ctx = summarizeChainContext(world, engine.registry, "evt:drought:aren:5");
    if (!ctx) throw new Error("문맥 없음");
    const mild = validateChainCandidate(
      chainRec({ effects: [{ targetMetric: "settlement.stability", operation: "add", value: -3 }] }),
      ctx,
      new Set(),
    );
    const severe = validateChainCandidate(
      chainRec({ effects: [{ targetMetric: "settlement.stability", operation: "add", value: -14 }] }),
      ctx,
      new Set(),
    );
    expect(mild.rejected).toBeUndefined();
    expect(severe.rejected).toBeUndefined();
    expect(classifySafety(mild.template!)).toBe("low");
    expect(classifySafety(severe.template!)).not.toBe("low");
  });
});

describe("연쇄 허용 메트릭 (§20.2)", () => {
  it("허용 메트릭은 LLM이 수정 가능한 정착지 메트릭만 담는다 — route.*은 제외", () => {
    const { world } = setup();
    // 레지스트리를 직접 구성 — 부모 템플릿 효과에 route.*이 섞여 있어도
    // 연쇄 후보(정착지 스코프)가 따라 제안하면 안 된다
    const evilParent = {
      ...BUILTIN_TEMPLATES.find((t) => t.id === "drought")!,
      id: "evilRouteParent",
      name: "비정상 부모",
      ongoingEffects: [
        { targetMetric: "route.capacity", operation: "multiply" as const, value: 0.5 },
      ],
    };
    const registry = new Map([[evilParent.id, evilParent]]);
    const eventId = "evt:evilRouteParent:aren:5";
    world.activeEvents.push({
      id: eventId,
      templateId: evilParent.id,
      templateVersion: 1,
      targetId: "aren",
      scope: "settlement",
      importance: 80,
      startedTick: 5,
      durationTicks: 12,
      endsAtTick: 17,
      chainDepth: 0,
    });
    const ctx = summarizeChainContext(world, registry, eventId);
    expect(ctx).not.toBeNull();
    expect(ctx!.allowedMetrics.length).toBeGreaterThan(0);
    for (const metric of ctx!.allowedMetrics) {
      expect(metric.startsWith("settlement.")).toBe(true);
    }
  });
});
