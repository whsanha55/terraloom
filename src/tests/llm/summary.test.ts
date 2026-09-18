import { describe, expect, it } from "vitest";
import { computeInputHash, summarizeForLLM } from "@/llm/gateway/summary";
import { EventEngine } from "@/simulation/events/engine";
import { BUILTIN_TEMPLATES } from "@/simulation/events/templates/builtin";
import { makeSettlement, makeWorld } from "../simulation/testWorld";

function worldWithHistory() {
  const world = makeWorld([
    makeSettlement({ id: "aren", population: 8200, foodMonthsRemaining: 1.1, stability: 38, migrationPressure: 0.7 }),
    makeSettlement({ id: "karin", population: 5000, foodMonthsRemaining: 5.5, stability: 72, migrationPressure: 0.1 }),
  ]);
  const engine = new EventEngine(BUILTIN_TEMPLATES);
  world.clock.currentTick = 10;
  world.clock.year = 0;
  world.clock.month = 10;
  engine.run(world); // 사건 몇 건 발생 시도
  world.clock.currentTick = 30; // 3년 6월
  world.clock.year = 2;
  world.clock.month = 6;
  return world;
}

describe("summarizeForLLM — 세계 상태 요약기 (§18)", () => {
  it("허용된 요약 데이터만 포함한다 — 전체 상태를 보내지 않는다", () => {
    const input = summarizeForLLM(worldWithHistory());
    expect(input.world.year).toBe(2);
    expect(input.world.globalPopulation).toBe(13200);
    expect(input.settlements.length).toBe(2);
    const aren = input.settlements.find((s) => s.id === "aren");
    expect(aren).toMatchObject({ population: 8200, foodMonthsRemaining: 1.1, stability: 38, migrationPressure: 0.7 });
    // 허용 메트릭 목록이 포함된다 (§18 allowedMetrics)
    expect(input.allowedMetrics.length).toBeGreaterThan(0);
    expect(input.allowedMetrics).toContain("settlement.stability");
  });

  it("최근 역사 요약은 이벤트 이력에서 만든다", () => {
    const input = summarizeForLLM(worldWithHistory());
    for (const entry of input.recentHistory) {
      expect(entry.tick).toBeLessThanOrEqual(30);
    }
  });

  it("같은 상태는 같은 입력 해시를 낸다 (늦은 응답 판정 §23)", () => {
    const a = worldWithHistory();
    const b = worldWithHistory();
    expect(computeInputHash(summarizeForLLM(a))).toBe(computeInputHash(summarizeForLLM(b)));
    const advanced = worldWithHistory();
    advanced.clock.currentTick = 31;
    advanced.clock.month = 7;
    advanced.settlements.aren!.stability -= 5; // 한 달이 흐르면 요약 지표가 변한다
    expect(computeInputHash(summarizeForLLM(advanced))).not.toBe(computeInputHash(summarizeForLLM(a)));
  });
});
