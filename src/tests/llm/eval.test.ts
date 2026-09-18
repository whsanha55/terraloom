import { describe, expect, it } from "vitest";
import { runRecommendationEval } from "@/llm/eval/baseline";
import { MockLLMProvider } from "@/llm/gateway/provider";
import { buildEventRecommendationPrompt } from "@/llm/gateway/prompt";
import { RecommendationResponseSchema, type LLMRecommendation } from "@/llm/schemas/recommendation";
import { summarizeForLLM } from "@/llm/gateway/summary";
import { validateCandidate } from "@/llm/validation/safety";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState } from "@/simulation/core/worldState";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

const EVAL_SEEDS = ["eval-alpha", "eval-beta", "eval-gamma", "eval-delta", "eval-epsilon"];

/** 고정 시드 세계 5개 — 각 10년 진행 후 요약 (T17 fixture) */
function makeEvalInputs() {
  return EVAL_SEEDS.map((seed) => {
    const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
    const engine = new SimulationEngine(initializeWorldState(gen));
    engine.applyTicks(120);
    return summarizeForLLM(engine.state);
  });
}

describe("LLM eval 기준선 (T17 — 프롬프트·후보 품질 회귀 판정)", () => {
  it("고정 5세계 × 모의 Provider의 기준선 리포트가 안정적으로 산출된다", async () => {
    const inputs = makeEvalInputs();
    const provider = new MockLLMProvider();
    const report = await runRecommendationEval({
      inputs,
      generate: async (input) => {
        const raw = await provider.generateRecommendations(buildEventRecommendationPrompt(input));
        const parsed = RecommendationResponseSchema.safeParse(JSON.parse(raw));
        return { raw, parsed };
      },
      validate: (rec, input, registeredNames) =>
        validateCandidate(rec, input, registeredNames),
    });

    // 기준선 — 프롬프트/모의 Provider 변경 시 이 수치와 비교해 회귀 판정
    expect(report.worldCount).toBe(5);
    expect(report.schemaCompliance).toBe(1); // 스키마 준수율 100%
    expect(report.candidatesPerWorld.min).toBeGreaterThanOrEqual(3);
    expect(report.candidatesPerWorld.max).toBeLessThanOrEqual(5);
    expect(report.duplicateRate).toBeLessThanOrEqual(0.2);
    expect(report.rejectionRate).toBeLessThanOrEqual(0.2);
  });

  it("같은 입력에서 리포트는 결정론적으로 재현된다", async () => {
    const inputs = makeEvalInputs();
    const provider = new MockLLMProvider();
    const config = {
      inputs,
      generate: async (input: (typeof inputs)[number]) => {
        const raw = await provider.generateRecommendations(buildEventRecommendationPrompt(input));
        const parsed = RecommendationResponseSchema.safeParse(JSON.parse(raw));
        return {
          raw,
          parsed: { success: parsed.success, data: parsed.data ?? undefined },
        };
      },
      validate: (rec: LLMRecommendation, input: (typeof inputs)[number], names: ReadonlySet<string>) =>
        validateCandidate(rec, input, names),
    };
    const a = await runRecommendationEval(config);
    const b = await runRecommendationEval(config);
    expect(a).toEqual(b);
  });
});
