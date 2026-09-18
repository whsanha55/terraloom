/**
 * LLM 게이트웨이 (§31) — 호출·검증·폴백 오케스트레이션.
 *
 * UI 스레드에서 실행된다(시뮬레이션 상태는 Worker 소유 — 요약만 받아 프롬프트 생성).
 * 어떤 실패든 시뮬레이션을 멈추지 않는다(§22): 폴백 상태로 전환해 안내만 한다.
 */
import { RecommendationResponseSchema, type LLMRecommendation } from "../schemas/recommendation";
import { validateCandidate, type CandidateValidation } from "../validation/safety";
import { buildEventRecommendationPrompt, PROMPT_VERSION } from "./prompt";
import type { LLMProvider } from "./provider";
import type { LLMInput } from "./summary";

export interface GatewayCandidate {
  recommendation: LLMRecommendation;
  validation: CandidateValidation;
}

export interface GatewayResult {
  status: "ok" | "fallback";
  candidates: GatewayCandidate[];
  rejected: Array<{ recommendation: LLMRecommendation; reason: string }>;
  provider: string;
  model: string;
  rawOutput: string;
  promptVersion: string;
  error?: string;
}

export async function requestRecommendations(
  provider: LLMProvider,
  input: LLMInput,
  registeredNames: ReadonlySet<string>,
): Promise<GatewayResult> {
  const base = {
    provider: provider.name,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
  };
  let rawOutput = "";
  try {
    const prompt = buildEventRecommendationPrompt(input);
    rawOutput = await provider.generateRecommendations(prompt);
    const parsed = RecommendationResponseSchema.safeParse(JSON.parse(rawOutput));
    if (!parsed.success) {
      return {
        ...base,
        status: "fallback",
        candidates: [],
        rejected: [],
        rawOutput,
        error: `스키마 검증 실패 — 폴백 모드로 전환합니다 (§22)`,
      };
    }
    const candidates: GatewayCandidate[] = [];
    const rejected: Array<{ recommendation: LLMRecommendation; reason: string }> = [];
    for (const recommendation of parsed.data.recommendations) {
      const validation = validateCandidate(recommendation, input, registeredNames);
      if (validation.rejected || !validation.template) {
        rejected.push({ recommendation, reason: validation.rejected ?? "변환 실패" });
      } else {
        candidates.push({ recommendation, validation });
      }
    }
    return { ...base, status: "ok", candidates, rejected, rawOutput };
  } catch (error) {
    return {
      ...base,
      status: "fallback",
      candidates: [],
      rejected: [],
      rawOutput,
      error: `LLM 호출 실패(${error instanceof Error ? error.message : "알 수 없음"}) — 규칙 기반으로 계속합니다 (§22)`,
    };
  }
}
