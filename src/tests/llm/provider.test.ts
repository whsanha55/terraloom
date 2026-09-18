import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@/llm/gateway/provider";
import { buildEventRecommendationPrompt, PROMPT_VERSION } from "@/llm/gateway/prompt";
import { RecommendationResponseSchema } from "@/llm/schemas/recommendation";
import type { LLMInput } from "@/llm/gateway/summary";

function input(): LLMInput {
  return {
    world: { year: 10, season: "summer", globalPopulation: 13000, activeMajorEvents: ["drought"] },
    settlements: [
      { id: "aren", population: 8000, foodMonthsRemaining: 1.1, stability: 38, migrationPressure: 0.7 },
      { id: "b", population: 5000, foodMonthsRemaining: 5, stability: 70, migrationPressure: 0.1 },
    ],
    recentHistory: [{ type: "drought_started", tick: 110 }],
    allowedMetrics: ["settlement.stability", "settlement.migrationPressure"],
  };
}

describe("프롬프트 빌더 (§16/§18 — 프롬프트 버전 관리)", () => {
  it("버전이 관리되고 프롬프트에 세계 요약·허용 메트릭·출력 형식이 포함된다", () => {
    expect(PROMPT_VERSION).toMatch(/^llm-events-v\d+$/);
    const prompt = buildEventRecommendationPrompt(input());
    expect(prompt).toContain(PROMPT_VERSION);
    expect(prompt).toContain("aren"); // 도시 요약 포함
    expect(prompt).toContain("settlement.stability"); // 허용 메트릭
    expect(prompt).toContain("JSON"); // 구조화 출력 요구
    expect(prompt).not.toContain("world.seed"); // 시드 등 금지 정보 미포함
  });
});

describe("모의 LLM Provider (API 키 없이 동작 — Step 11 완료 조건)", () => {
  it("결정론적이다 — 같은 입력은 같은 출력", async () => {
    const provider = new MockLLMProvider();
    const a = await provider.generateRecommendations(buildEventRecommendationPrompt(input()));
    const b = await provider.generateRecommendations(buildEventRecommendationPrompt(input()));
    expect(a).toBe(b);
  });

  it("출력은 스키마를 통과하는 3~5개 후보 JSON이다", async () => {
    const provider = new MockLLMProvider();
    const raw = await provider.generateRecommendations(buildEventRecommendationPrompt(input()));
    const parsed = RecommendationResponseSchema.parse(JSON.parse(raw));
    expect(parsed.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(parsed.recommendations.length).toBeLessThanOrEqual(5);
  });

  it("후보는 입력에 존재하는 도시만 참조한다", async () => {
    const provider = new MockLLMProvider();
    const raw = await provider.generateRecommendations(buildEventRecommendationPrompt(input()));
    const parsed = RecommendationResponseSchema.parse(JSON.parse(raw));
    const ids = new Set(input().settlements.map((s) => s.id));
    for (const rec of parsed.recommendations) {
      for (const targetId of rec.targetIds) {
        expect(ids.has(targetId)).toBe(true);
      }
    }
  });

  it("메타데이터(제공자·모델)를 노출한다", () => {
    const provider = new MockLLMProvider();
    expect(provider.name.length).toBeGreaterThan(0);
    expect(provider.model.length).toBeGreaterThan(0);
  });
});
