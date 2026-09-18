import { describe, expect, it } from "vitest";
import { computeProbability, rollEvent } from "@/simulation/events/probability";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { makeSettlement, makeWorld } from "../testWorld";

const riot = () => BUILTIN_TEMPLATES.find((t) => t.id === "foodRiot");

describe("computeProbability (§13 확률 엔진)", () => {
  it("충족된 인자만 곱해지고 근거가 보존된다 (§13.1)", () => {
    const world = makeWorld([
      makeSettlement({ id: "aren", foodMonthsRemaining: 0.4, stability: 30 }),
    ]);
    const template = riot();
    if (!template) throw new Error("foodRiot 없음");
    const result = computeProbability(world, template, { kind: "settlement", id: "aren" });
    // base 0.02 × 재고 위기 2.5 × 안정도 위기 1.8
    expect(result.finalProbability).toBeCloseTo(0.02 * 2.5 * 1.8, 6);
    expect(result.modifiers.length).toBe(2);
    for (const modifier of result.modifiers) {
      expect(modifier.explanation.length).toBeGreaterThan(0);
    }
    expect(result.baseProbability).toBe(0.02);
  });

  it("인자가 충족되지 않으면 곱하지 않는다", () => {
    const world = makeWorld([
      makeSettlement({ id: "aren", foodMonthsRemaining: 1.0, stability: 45 }),
    ]);
    const template = riot();
    if (!template) throw new Error("foodRiot 없음");
    const result = computeProbability(world, template, { kind: "settlement", id: "aren" });
    expect(result.finalProbability).toBeCloseTo(0.02, 6);
    expect(result.modifiers.length).toBe(0);
  });

  it("확률은 항상 [0, max]로 clamp된다 (§33 불변식)", () => {
    const world = makeWorld([
      makeSettlement({ id: "aren", foodMonthsRemaining: 0.1, stability: 10 }),
    ]);
    const template = riot();
    if (!template) throw new Error("foodRiot 없음");
    const boosted = {
      ...template,
      probability: {
        base: 0.9,
        max: 0.5,
        factors: template.probability.factors,
      },
    };
    const result = computeProbability(world, boosted, { kind: "settlement", id: "aren" });
    expect(result.finalProbability).toBeLessThanOrEqual(0.5);
    expect(result.finalProbability).toBeGreaterThanOrEqual(0);
  });
});

describe("rollEvent — 결정론적 확률 판정 (§7)", () => {
  it("같은 입력에서는 같은 난수가 나온다", () => {
    const a = makeWorld([makeSettlement({ id: "aren" })], [], "roll-seed");
    const b = makeWorld([makeSettlement({ id: "aren" })], [], "roll-seed");
    a.clock.currentTick = 42;
    b.clock.currentTick = 42;
    expect(rollEvent(a, "foodRiot", "aren")).toBe(rollEvent(b, "foodRiot", "aren"));
  });

  it("틱·템플릿·대상이 다르면 다른 난수가 나온다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })], [], "roll-seed");
    world.clock.currentTick = 42;
    const atTick = rollEvent(world, "foodRiot", "aren");
    world.clock.currentTick = 43;
    expect(rollEvent(world, "foodRiot", "aren")).not.toBe(atTick);
    world.clock.currentTick = 42;
    expect(rollEvent(world, "drought", "aren")).not.toBe(atTick);
  });

  it("난수는 [0,1) 범위다", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })], [], "roll-range");
    for (let tick = 1; tick <= 200; tick++) {
      world.clock.currentTick = tick;
      const value = rollEvent(world, "foodRiot", "aren");
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
