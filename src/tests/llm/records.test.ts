import { describe, expect, it } from "vitest";
import { computeCurrentInputHash, registerLLMTemplate } from "@/llm/records";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { makeSettlement, makeWorld } from "../simulation/testWorld";
import { summarizeForLLM } from "@/llm/gateway/summary";
import { validateCandidate } from "@/llm/validation/safety";
import type { LLMRecommendation } from "@/llm/schemas/recommendation";

function recommendation(): LLMRecommendation {
  return {
    temporaryId: "candidate_1",
    name: "곡물 암시장",
    category: "economic",
    summary: "배급망 부족으로 비공식 거래가 확산됩니다.",
    scope: "settlement",
    targetIds: ["aren"],
    preconditions: [],
    suggestedBaseProbability: 0.02,
    suggestedDurationTicks: 6,
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -2 }],
    followUps: [],
    reasoningSummary: "검증용 후보",
  };
}

function setup(seed: string) {
  const state = makeWorld([makeSettlement({ id: "aren" })], [], seed);
  const engine = new EventEngine(BUILTIN_TEMPLATES);
  return { state, engine };
}

function validTemplate() {
  const { state } = setup("rec-template");
  return validateCandidate(recommendation(), summarizeForLLM(state), new Set()).template!;
}

describe("LLM 템플릿 승인 등록 (§23)", () => {
  it("정상 후보는 등록되고 llmTemplates·llmRecords에 남는다", () => {
    const { state, engine } = setup("rec-ok");
    const template = validTemplate();
    const result = registerLLMTemplate(state, engine, {
      template,
      inputHash: computeCurrentInputHash(state),
      rawOutput: "{}",
      provider: "mock",
      model: "mock",
      promptVersion: "v1",
    });
    expect(result.ok).toBe(true);
    expect(engine.registry.has(template.id)).toBe(true);
    expect(state.llmTemplates.map((t) => t.id)).toContain(template.id);
    expect(state.llmRecords.length).toBe(1);
  });

  it("입력 해시가 다르면 늦은 응답으로 폐기된다 (§23)", () => {
    const { state, engine } = setup("rec-stale");
    const result = registerLLMTemplate(state, engine, {
      template: validTemplate(),
      inputHash: "stale",
      rawOutput: "{}",
      provider: "mock",
      model: "mock",
      promptVersion: "v1",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("늦은 응답");
  });

  it("구조 검증(validateTemplate)을 통과하지 못하는 템플릿은 등록이 거부된다 — registry.set 우회 금지", () => {
    const { state, engine } = setup("rec-invalid");
    const template = validTemplate();
    template.name = "이".repeat(61); // 이름 길이 초과 — 검증 후보 재검사는 통과, 구조 검증은 실패
    const result = registerLLMTemplate(state, engine, {
      template,
      inputHash: computeCurrentInputHash(state),
      rawOutput: "{}",
      provider: "mock",
      model: "mock",
      promptVersion: "v1",
    });
    expect(result.ok).toBe(false);
    expect(engine.registry.has(template.id)).toBe(false);
    expect(state.llmTemplates.length).toBe(0);
  });

  it("정착지 스코프에 route.* 효과가 섞인 템플릿은 거부된다 (복원 시 크래시 방지)", () => {
    const { state, engine } = setup("rec-scope");
    const template = validTemplate();
    template.ongoingEffects.push({
      targetMetric: "route.capacity",
      operation: "multiply",
      value: 0.5,
    });
    const result = registerLLMTemplate(state, engine, {
      template,
      inputHash: computeCurrentInputHash(state),
      rawOutput: "{}",
      provider: "mock",
      model: "mock",
      promptVersion: "v1",
    });
    expect(result.ok).toBe(false);
    expect(engine.registry.has(template.id)).toBe(false);
    expect(state.llmTemplates.length).toBe(0);
  });
});
