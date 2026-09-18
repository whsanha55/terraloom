import { describe, expect, it } from "vitest";
import { RecommendationResponseSchema } from "@/llm/schemas/recommendation";

const BASE_REC = {
      temporaryId: "candidate_1",
      name: "북부 곡물 암시장",
      category: "economic",
      summary: "공식 배급망이 부족해지면서 비공식 곡물 거래가 확산됩니다.",
      scope: "settlement",
      targetIds: ["aren"],
      preconditions: [
        { metric: "settlement.foodMonthsRemaining", operator: "lt", value: 2 },
      ],
      suggestedBaseProbability: 0.08,
      suggestedDurationTicks: 8,
      effects: [
        { targetMetric: "settlement.stability", operation: "add", value: -2 },
      ],
      followUps: [
        {
          eventType: "smuggling_crackdown",
          minimumDelayTicks: 2,
          maximumDelayTicks: 6,
          baseWeight: 0.4,
        },
      ],
  reasoningSummary: "식량 부족과 낮은 안정도가 암시장 형성 조건을 충족합니다.",
};

/** §16 — 후보는 항상 3~5개 */
const VALID = {
  recommendations: [1, 2, 3].map((n) => ({
    ...BASE_REC,
    temporaryId: `candidate_${n}`,
    name: n === 1 ? BASE_REC.name : `${BASE_REC.name} ${n}`,
  })),
};

describe("LLM 출력 스키마 검증 (§19 / §20.1 Zod)", () => {
  it("§19 예시 형식을 통과시킨다", () => {
    const parsed = RecommendationResponseSchema.parse(VALID);
    expect(parsed.recommendations.length).toBe(3);
    expect(parsed.recommendations[0]?.name).toBe("북부 곡물 암시장");
  });

  it("잘못된 JSON 구조는 거부된다", () => {
    expect(() => RecommendationResponseSchema.parse({ recommendations: [] })).toThrow(); // 후보 0건
    expect(() =>
      RecommendationResponseSchema.parse({ recommendations: [{ ...VALID.recommendations[0]!, temporaryId: "" }, ...VALID.recommendations.slice(1)] }),
    ).toThrow(); // 필수 필드 비었음
    expect(() =>
      RecommendationResponseSchema.parse({
        recommendations: [{ ...VALID.recommendations[0]!, suggestedBaseProbability: "높음" }, ...VALID.recommendations.slice(1)],
      }),
    ).toThrow(); // 타입 오류
  });

  it("후보 수 상한(5)을 넘으면 거부된다", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...VALID.recommendations[0]!,
      temporaryId: `candidate_${i}`,
      name: `${BASE_REC.name} ${i}`,
    }));
    expect(() => RecommendationResponseSchema.parse({ recommendations: many })).toThrow();
  });

  it("알 수 없는 필드는 제거된다 (§20.1)", () => {
    const parsed = RecommendationResponseSchema.parse({
      recommendations: [
        { ...VALID.recommendations[0]!, arbitraryCode: "rm -rf /", world_seed: "hacked" },
        ...VALID.recommendations.slice(1),
      ],
    });
    expect(parsed.recommendations[0]).not.toHaveProperty("arbitraryCode");
    expect(parsed.recommendations[0]).not.toHaveProperty("world_seed");
  });

  it("문자열 길이 제한을 검사한다 (§20.1)", () => {
    expect(() =>
      RecommendationResponseSchema.parse({
        recommendations: [{ ...VALID.recommendations[0]!, name: "가".repeat(61) }, ...VALID.recommendations.slice(1)],
      }),
    ).toThrow();
    expect(() =>
      RecommendationResponseSchema.parse({
        recommendations: [{ ...VALID.recommendations[0]!, summary: "가".repeat(501) }, ...VALID.recommendations.slice(1)],
      }),
    ).toThrow();
  });
});
