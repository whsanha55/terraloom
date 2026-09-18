import { describe, expect, it } from "vitest";
import { validateCandidate } from "@/llm/validation/safety";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { validateTemplate } from "@/simulation/events/templates/validate";
import { makeSettlement, makeWorld } from "../simulation/testWorld";
import type { LLMInput } from "@/llm/gateway/summary";
import type { LLMRecommendation } from "@/llm/schemas/recommendation";

function input(): LLMInput {
  return {
    world: { year: 10, season: "summer", globalPopulation: 13000, activeMajorEvents: [] },
    settlements: [
      { id: "aren", population: 8000, foodMonthsRemaining: 1.1, stability: 38, migrationPressure: 0.7 },
      { id: "b", population: 5000, foodMonthsRemaining: 5, stability: 70, migrationPressure: 0.1 },
    ],
    recentHistory: [],
    allowedMetrics: ["settlement.stability", "settlement.migrationPressure"],
  };
}

function recommendation(overrides: Partial<LLMRecommendation> = {}): LLMRecommendation {
  return {
    temporaryId: "candidate_1",
    name: "곡물 암시장",
    category: "economic",
    summary: "배급망 부족으로 비공식 거래가 확산됩니다.",
    scope: "settlement",
    targetIds: ["aren"],
    preconditions: [{ metric: "settlement.foodMonthsRemaining", operator: "lt", value: 2 }],
    suggestedBaseProbability: 0.08,
    suggestedDurationTicks: 8,
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -2 }],
    followUps: [],
    reasoningSummary: "식량 부족과 낮은 안정도.",
    ...overrides,
  };
}

describe("LLM 후보 안전 검증 (§20)", () => {
  it("정상 후보를 EventTemplate으로 변환하고 내장 검증을 통과한다", () => {
    const result = validateCandidate(recommendation(), input(), new Set());
    expect(result.rejected).toBeUndefined();
    expect(result.template).toBeDefined();
    expect(() => validateTemplate(result.template!)).not.toThrow();
    expect(result.template?.source).toBe("llm");
    expect(result.template?.kind).toBe("effect");
  });

  it("허용 목록 밖 메트릭은 거부된다 (§20.2)", () => {
    const result = validateCandidate(
      recommendation({
        effects: [{ targetMetric: "world.seed", operation: "multiply", value: 0.5 }],
      }),
      input(),
      new Set(),
    );
    expect(result.rejected).toContain("메트릭");
  });

  it("route.* 메트릭 효과는 거부된다 — 후보는 정착지 스코프로만 만들어진다 (§20.2)", () => {
    const result = validateCandidate(
      recommendation({
        effects: [{ targetMetric: "route.capacity", operation: "multiply", value: 0.8 }],
      }),
      input(),
      new Set(),
    );
    expect(result.rejected).toContain("route.capacity");
  });

  it("수치 범위 위반은 안전 범위로 보정하고 경고를 남긴다 (§20.3)", () => {
    const result = validateCandidate(
      recommendation({
        effects: [{ targetMetric: "settlement.stability", operation: "add", value: -50 }],
      }),
      input(),
      new Set(),
    );
    expect(result.rejected).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    const effect = result.template?.immediateEffects[0];
    expect(effect?.value).toBe(-15); // clamp
  });

  it("효과 배율 범위도 보정한다 — 식량 생산 0.5~1.5 (multiply는 지속 효과 §12.2.1)", () => {
    const result = validateCandidate(
      recommendation({
        effects: [{ targetMetric: "settlement.foodProduction", operation: "multiply", value: 0.1 }],
      }),
      input(),
      new Set(),
    );
    expect(result.template?.ongoingEffects[0]?.value).toBe(0.5);
    const boosted = validateCandidate(
      recommendation({
        effects: [{ targetMetric: "settlement.foodProduction", operation: "multiply", value: 3.0 }],
      }),
      input(),
      new Set(),
    );
    expect(boosted.template?.ongoingEffects[0]?.value).toBe(1.5);
  });

  it("존재하지 않는 도시 참조는 거부된다 (§20.4)", () => {
    const result = validateCandidate(
      recommendation({ targetIds: ["ghost-city"] }),
      input(),
      new Set(),
    );
    expect(result.rejected).toBeDefined();
  });

  it("지속 시간은 1~36틱으로 clamp된다", () => {
    const short = validateCandidate(recommendation({ suggestedDurationTicks: 0 }), input(), new Set());
    expect(short.template?.duration).toEqual({ minTicks: 1, maxTicks: 1 });
    const long = validateCandidate(recommendation({ suggestedDurationTicks: 99 }), input(), new Set());
    expect(long.template?.duration).toEqual({ minTicks: 36, maxTicks: 36 });
  });

  it("기본 확률은 안전 범위로 제한된다 (§19)", () => {
    const high = validateCandidate(
      recommendation({ suggestedBaseProbability: 0.9 }),
      input(),
      new Set(),
    );
    expect(high.template?.probability.base).toBeLessThanOrEqual(0.05);
    const low = validateCandidate(
      recommendation({ suggestedBaseProbability: 1e-8 }),
      input(),
      new Set(),
    );
    expect(low.template?.probability.base).toBeGreaterThanOrEqual(0.001);
  });

  it("이미 등록된 이름과 중복되면 거부된다 (§20.4 중복)", () => {
    const existing = new Set(["곡물 암시장"]);
    const result = validateCandidate(recommendation(), input(), existing);
    expect(result.rejected).toContain("중복");
  });

  it("조건 메트릭도 알려진 메트릭만 허용한다", () => {
    const result = validateCandidate(
      recommendation({
        preconditions: [{ metric: "settlement.nonexistent", operator: "gt", value: 1 }],
      }),
      input(),
      new Set(),
    );
    expect(result.rejected).toBeDefined();
  });
});

describe("승인 결과 저장·등록 (§23 / Worker 로직)", () => {
  function setup() {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    world.clock.currentTick = 10;
    const engine = new EventEngine(BUILTIN_TEMPLATES);
    const candidate = validateCandidate(recommendation(), input(), new Set());
    if (!candidate.template) throw new Error("후보 변환 실패");
    return { world, engine, template: candidate.template };
  }

  it("승인된 후보만 템플릿으로 등록되고 생성 기록이 남는다", async () => {
    const { world, engine, template } = setup();
    const { registerLLMTemplate, computeCurrentInputHash } = await import("@/llm/records");
    const inputHash = computeCurrentInputHash(world);
    const result = registerLLMTemplate(world, engine, {
      template,
      inputHash,
      rawOutput: "{raw}",
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-events-v1",
    });
    expect(result.ok).toBe(true);
    expect(engine.registry.has(template.id)).toBe(true);
    expect(world.llmRecords.length).toBe(1);
    expect(world.llmRecords[0]?.approvedBy).toBe("user");
    expect(world.llmRecords[0]?.appliedAtTick).toBe(10);
    expect(world.llmRecords[0]?.registrationOrder).toBe(1);
  });

  it("늦게 도착한 응답 — 입력 해시 불일치 시 폐기된다 (§23)", async () => {
    const { world, engine, template } = setup();
    const { registerLLMTemplate, computeCurrentInputHash } = await import("@/llm/records");
    const stale = "old-hash";
    expect(stale).not.toBe(computeCurrentInputHash(world));
    const result = registerLLMTemplate(world, engine, {
      template,
      inputHash: stale,
      rawOutput: "{raw}",
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-events-v1",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("폐기");
    expect(engine.registry.has(template.id)).toBe(false);
  });

  it("같은 템플릿 id의 재등록은 거부된다", async () => {
    const { world, engine, template } = setup();
    const { registerLLMTemplate, computeCurrentInputHash } = await import("@/llm/records");
    const inputHash = computeCurrentInputHash(world);
    const first = registerLLMTemplate(world, engine, {
      template, inputHash, rawOutput: "{}", provider: "mock", model: "m", promptVersion: "v",
    });
    expect(first.ok).toBe(true);
    const second = registerLLMTemplate(world, engine, {
      template, inputHash, rawOutput: "{}", provider: "mock", model: "m", promptVersion: "v",
    });
    expect(second.ok).toBe(false);
    expect(world.llmRecords.length).toBe(1);
  });
});
