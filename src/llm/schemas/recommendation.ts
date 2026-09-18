/**
 * LLM 구조화 출력 스키마 (§19 / §20.1) — Zod.
 *
 * 알 수 없는 필드는 제거(strip)되고, 필수 필드·타입·길이·후보 수가 검증된다.
 * 검증을 통과한 출력만 안전 검증(§20.2~20.4) 단계로 넘어간다.
 */
import { z } from "zod";

export const EVENT_CATEGORIES = ["natural", "health", "social", "economic"] as const;

// 조건 메트릭의 허용 여부는 안전 검증 계층(§20.2 KNOWN_METRICS)이 판정한다 —
// 스키마는 형태만 검증한다 (계층 분리).
export const ConditionSchema = z.object({
  metric: z.string().min(1),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]),
  value: z.union([z.number(), z.tuple([z.number(), z.number()])]),
});

export const EffectSchema = z.object({
  targetMetric: z.string().min(1),
  operation: z.enum(["add", "multiply"]),
  value: z.number().finite(),
});

export const FollowUpSchema = z.object({
  eventType: z.string().min(1).max(60),
  minimumDelayTicks: z.number().int().min(0),
  maximumDelayTicks: z.number().int().min(0),
  baseWeight: z.number().positive(),
});

export const RecommendationSchema = z.object({
  temporaryId: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  category: z.enum(EVENT_CATEGORIES),
  summary: z.string().min(1).max(500),
  scope: z.literal("settlement"),
  targetIds: z.array(z.string().min(1)).min(1).max(5),
  preconditions: z.array(ConditionSchema).max(5),
  suggestedBaseProbability: z.number().min(0).max(1),
  suggestedDurationTicks: z.number().int().min(0).max(120),
  effects: z.array(EffectSchema).min(1).max(5),
  followUps: z.array(FollowUpSchema).max(5).optional(),
  reasoningSummary: z.string().min(1).max(500),
});

export const RecommendationResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema).min(3).max(5),
});

export type LLMRecommendation = z.infer<typeof RecommendationSchema>;
export type LLMRecommendationResponse = z.infer<typeof RecommendationResponseSchema>;
