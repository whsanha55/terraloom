import { describe, expect, it } from "vitest";
import { applyEffect, ongoingMultiplier } from "@/simulation/events/effects";
import type { ActiveWorldEvent } from "@/simulation/events/types";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { makeSettlement, makeWorld } from "../testWorld";

function activeEvent(templateId: string, targetId: string, startedTick = 1, duration = 12): ActiveWorldEvent {
  return {
    id: `evt:${templateId}:${targetId}:${startedTick}`,
    templateId,
    templateVersion: 1,
    targetId,
    scope: "settlement",
    importance: 50,
    startedTick,
    durationTicks: duration,
    endsAtTick: startedTick + duration,
    chainDepth: 0,
  };
}

function registryOf(ids: string[]): Map<string, (typeof BUILTIN_TEMPLATES)[number]> {
  const map = new Map();
  for (const template of BUILTIN_TEMPLATES) {
    if (ids.includes(template.id)) map.set(template.id, template);
  }
  return map;
}

describe("ongoingMultiplier — 수정자 스택 (§12.2.1 / T4)", () => {
  it("활성 사건이 없으면 1이다", () => {
    expect(ongoingMultiplier(registryOf(["drought"]), [], "aren", "settlement.foodProduction")).toBe(1);
  });

  it("가뭄 활성 시 생산 배율이 곱해진다", () => {
    const drought = BUILTIN_TEMPLATES.find((t) => t.id === "drought");
    if (!drought) throw new Error("drought 템플릿 없음");
    const value = ongoingMultiplier(
      registryOf(["drought"]),
      [activeEvent("drought", "aren")],
      "aren",
      "settlement.foodProduction",
    );
    expect(value).toBeCloseTo(0.55, 5);
  });

  it("여러 활성 사건의 수정자는 곱으로 누적된다 (Π)", () => {
    const value = ongoingMultiplier(
      registryOf(["drought", "flood"]),
      [activeEvent("drought", "aren"), activeEvent("flood", "aren", 2)],
      "aren",
      "settlement.foodProduction",
    );
    expect(value).toBeCloseTo(0.55 * 0.85, 5);
  });

  it("다른 도시의 사건은 영향을 주지 않는다", () => {
    expect(
      ongoingMultiplier(registryOf(["drought"]), [activeEvent("drought", "other")], "aren", "settlement.foodProduction"),
    ).toBe(1);
  });

  it("다른 메트릭의 수정자는 무시된다", () => {
    expect(
      ongoingMultiplier(registryOf(["drought"]), [activeEvent("drought", "aren")], "aren", "settlement.stability"),
    ).toBe(1);
  });
});

describe("applyEffect — 즉시/종료 효과 (§12.2)", () => {
  it("add 연산은 현재값에 더하고 clamp한다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", stability: 8 })]);
    applyEffect(world, { kind: "settlement", id: "aren" }, {
      targetMetric: "settlement.stability",
      operation: "add",
      value: -12,
      minimum: 0,
      maximum: 100,
    });
    expect(world.settlements.aren?.stability).toBe(0);
  });

  it("multiply 연산은 현재값에 곱한다 (홍수 재고 파괴)", () => {
    const world = makeWorld([makeSettlement({ id: "aren", foodStock: 10000 })]);
    applyEffect(world, { kind: "settlement", id: "aren" }, {
      targetMetric: "settlement.foodStock",
      operation: "multiply",
      value: 0.7,
      minimum: 0,
    });
    expect(world.settlements.aren?.foodStock).toBeCloseTo(7000, 5);
  });

  it("diseaseLevel은 [0,1]로 clamp된다", () => {
    const world = makeWorld([makeSettlement({ id: "aren", diseaseLevel: 0.7 })]);
    applyEffect(world, { kind: "settlement", id: "aren" }, {
      targetMetric: "settlement.diseaseLevel",
      operation: "add",
      value: 0.4,
      minimum: 0,
      maximum: 1,
    });
    expect(world.settlements.aren?.diseaseLevel).toBe(1);
  });

  it("대상이 없으면 효과를 건너뛴다 (InvalidEffectTarget §22.1 — 크래시 없음)", () => {
    const world = makeWorld([makeSettlement({ id: "aren" })]);
    expect(() =>
      applyEffect(world, { kind: "settlement", id: "ghost" }, {
        targetMetric: "settlement.stability",
        operation: "add",
        value: -5,
        minimum: 0,
        maximum: 100,
      }),
    ).not.toThrow();
  });
});
