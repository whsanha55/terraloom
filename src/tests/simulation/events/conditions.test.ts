import { describe, expect, it } from "vitest";
import { evaluateCondition } from "@/simulation/events/conditions";
import type { EventCondition } from "@/simulation/events/types";

const cond = (operator: EventCondition["operator"], value: EventCondition["value"]): EventCondition => ({
  metric: "settlement.stability",
  operator,
  value,
});

describe("evaluateCondition (§12.1 조건 평가기)", () => {
  it("gt/gte/lt/lte/eq 비교가 정확하다", () => {
    expect(evaluateCondition(cond("gt", 50), 51)).toBe(true);
    expect(evaluateCondition(cond("gt", 50), 50)).toBe(false);
    expect(evaluateCondition(cond("gte", 50), 50)).toBe(true);
    expect(evaluateCondition(cond("gte", 50), 49)).toBe(false);
    expect(evaluateCondition(cond("lt", 2), 1.99)).toBe(true);
    expect(evaluateCondition(cond("lt", 2), 2)).toBe(false);
    expect(evaluateCondition(cond("lte", 2), 2)).toBe(true);
    expect(evaluateCondition(cond("eq", 7), 7)).toBe(true);
    expect(evaluateCondition(cond("eq", 7), 7.0001)).toBe(false);
  });

  it("between은 양 끝을 포함한다", () => {
    const c = cond("between", [4, 7]);
    expect(evaluateCondition(c, 4)).toBe(true);
    expect(evaluateCondition(c, 7)).toBe(true);
    expect(evaluateCondition(c, 5.5)).toBe(true);
    expect(evaluateCondition(c, 3.99)).toBe(false);
    expect(evaluateCondition(c, 7.01)).toBe(false);
  });

  it("NaN 입력에서는 거짓으로 평가한다 (§8.1 침묵 오염 방지)", () => {
    expect(evaluateCondition(cond("gte", 0), Number.NaN)).toBe(false);
    expect(evaluateCondition(cond("between", [0, 10]), Number.NaN)).toBe(false);
  });
});
