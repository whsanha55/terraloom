import { describe, expect, it } from "vitest";
import { InvalidTemplateError } from "@/simulation/errors";
import { validateTemplate } from "@/simulation/events/templates/validate";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import type { EventTemplate } from "@/simulation/events/types";

const EXPECTED_IDS = [
  "drought",
  "flood",
  "goodHarvest",
  "badHarvest",
  "epidemic",
  "foodRiot",
  "massMigration",
  "priceRise",
  "routeDisruption",
];

function baseTemplate(overrides: Partial<EventTemplate> = {}): EventTemplate {
  return {
    id: "testEvent",
    version: 1,
    category: "social",
    kind: "effect",
    name: "테스트 사건",
    descriptionTemplate: "테스트용",
    scope: "settlement",
    preconditions: [{ metric: "settlement.stability", operator: "lt", value: 50 }],
    probability: { base: 0.01, factors: [] },
    duration: { minTicks: 3, maxTicks: 6 },
    immediateEffects: [],
    ongoingEffects: [
      { targetMetric: "settlement.stability", operation: "multiply", value: 0.8, minimum: 0, maximum: 100 },
    ],
    resolutionEffects: [],
    followUpCandidates: [],
    cooldownTicks: 6,
    maximumConcurrentInstances: 1,
    importance: 40,
    tags: [],
    source: "builtin",
    ...overrides,
  };
}

describe("내장 이벤트 템플릿 (Step 8 + Step 9)", () => {
  it("내장 이벤트가 모두 등록되어 있다", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual([...EXPECTED_IDS].sort());
  });

  it("모든 내장 템플릿이 검증을 통과한다", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(() => validateTemplate(template), template.id).not.toThrow();
    }
  });

  it("통지형 템플릿은 효과를 가지지 않는다 (§12.4 이중 적용 금지)", () => {
    for (const template of BUILTIN_TEMPLATES.filter((t) => t.kind === "notification")) {
      expect(template.immediateEffects.length, template.id).toBe(0);
      expect(template.ongoingEffects.length, template.id).toBe(0);
      expect(template.resolutionEffects.length, template.id).toBe(0);
    }
  });
});

describe("validateTemplate (§20 검증 규칙)", () => {
  it("정상 템플릿은 통과한다", () => {
    expect(() => validateTemplate(baseTemplate())).not.toThrow();
  });

  it("알 수 없는 메트릭을 참조하면 거부한다", () => {
    expect(() =>
      validateTemplate(
        baseTemplate({
          preconditions: [{ metric: "settlement.arbitraryField", operator: "gt", value: 1 }],
        }),
      ),
    ).toThrow(InvalidTemplateError);
    expect(() =>
      validateTemplate(
        baseTemplate({
          ongoingEffects: [{ targetMetric: "world.seed", operation: "multiply", value: 0.5 }],
        }),
      ),
    ).toThrow(InvalidTemplateError);
  });

  it("통지형이 효과를 가지면 거부한다", () => {
    expect(() => validateTemplate(baseTemplate({ kind: "notification" }))).toThrow(InvalidTemplateError);
  });

  it("기본 확률이 [0,1] 밖이면 거부한다", () => {
    expect(() => validateTemplate(baseTemplate({ probability: { base: 1.5, factors: [] } }))).toThrow(
      InvalidTemplateError,
    );
    expect(() => validateTemplate(baseTemplate({ probability: { base: 0, factors: [] } }))).toThrow(
      InvalidTemplateError,
    );
  });

  it("지속 기간 범위가 뒤집히면 거부한다", () => {
    expect(() => validateTemplate(baseTemplate({ duration: { minTicks: 6, maxTicks: 3 } }))).toThrow(
      InvalidTemplateError,
    );
  });

  it("효과형의 지속 기간은 최소 1틱이다", () => {
    expect(() => validateTemplate(baseTemplate({ duration: { minTicks: 0, maxTicks: 3 } }))).toThrow(
      InvalidTemplateError,
    );
  });

  it("scope와 효과 대상 접두사가 일치해야 한다", () => {
    expect(() =>
      validateTemplate(
        baseTemplate({
          scope: "route",
          ongoingEffects: [{ targetMetric: "settlement.stability", operation: "multiply", value: 0.8 }],
        }),
      ),
    ).toThrow(InvalidTemplateError);
  });
});
