/**
 * LLM eval 기준선 (T17) — 프롬프트·후보 품질의 회귀 판정.
 *
 * 고정 시드 세계 N개 × 프롬프트 버전으로 후보를 생성하고
 * 스키마 준수율·중복률·거부율을 기록한다. 프롬프트 변경 시 기준선과 비교한다.
 */
import type { LLMRecommendation } from "../schemas/recommendation";
import type { LLMInput } from "../gateway/summary";
import type { CandidateValidation } from "../validation/safety";

export interface EvalConfig {
  inputs: LLMInput[];
  generate: (input: LLMInput) => Promise<{
    raw: string;
    parsed: { success: boolean; data?: { recommendations?: LLMRecommendation[] } };
  }>;
  validate: (
    recommendation: LLMRecommendation,
    input: LLMInput,
    registeredNames: ReadonlySet<string>,
  ) => CandidateValidation;
}

export interface EvalReport {
  promptWorlds: number;
  worldCount: number;
  candidateCount: number;
  schemaCompliance: number;
  duplicateRate: number;
  rejectionRate: number;
  candidatesPerWorld: { min: number; max: number };
}

export async function runRecommendationEval(config: EvalConfig): Promise<EvalReport> {
  const candidatesPerWorld: number[] = [];
  let schemaOk = 0;
  let total = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const input of config.inputs) {
    const { parsed } = await config.generate(input);
    const recommendations = parsed.data?.recommendations ?? [];
    total += 1;
    if (parsed.success && recommendations.length > 0) schemaOk += 1;
    const names = new Set<string>();
    let count = 0;
    for (const recommendation of recommendations) {
      const validation = config.validate(recommendation, input, names);
      if (validation.rejected) {
        if (validation.rejected.includes("중복")) duplicates += 1;
        rejected += 1;
        continue;
      }
      names.add(recommendation.name);
      count += 1;
    }
    candidatesPerWorld.push(count);
  }

  return {
    promptWorlds: config.inputs.length,
    worldCount: config.inputs.length,
    candidateCount: candidatesPerWorld.reduce((sum, n) => sum + n, 0),
    schemaCompliance: total === 0 ? 0 : schemaOk / total,
    duplicateRate: total === 0 ? 0 : duplicates / Math.max(1, candidatesPerWorld.reduce((s, n) => s + n, 0) + duplicates),
    rejectionRate: total === 0 ? 0 : rejected / Math.max(1, candidatesPerWorld.reduce((s, n) => s + n, 0) + rejected),
    candidatesPerWorld: {
      min: candidatesPerWorld.length === 0 ? 0 : Math.min(...candidatesPerWorld),
      max: candidatesPerWorld.length === 0 ? 0 : Math.max(...candidatesPerWorld),
    },
  };
}
