import { describe, expect, it } from "vitest";
import {
  buildBranchState,
  compareSnapshots,
  type SnapshotLike,
} from "@/simulation/core/branch";
import { SimulationEngine } from "@/simulation/core/engine";
import {
  deserializeDynamicState,
  serializeDynamicState,
} from "@/simulation/core/serialization";
import { initializeWorldState, type WorldState } from "@/simulation/core/worldState";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { validateCandidate } from "@/llm/validation/safety";
import type { LLMRecommendation } from "@/llm/schemas/recommendation";
import type { LLMInput } from "@/llm/gateway/summary";

function makeEngine(seed: string, ticks = 0): SimulationEngine {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  const engine = new SimulationEngine(initializeWorldState(gen));
  engine.applyTicks(ticks);
  return engine;
}

function llmInput(state: WorldState): LLMInput {
  return {
    world: { year: state.clock.year, season: "summer", globalPopulation: 1, activeMajorEvents: [] },
    settlements: [
      {
        id: Object.keys(state.settlements)[0] ?? "settlement:0",
        population: 1000,
        foodMonthsRemaining: 3,
        stability: 50,
        migrationPressure: 0.2,
      },
    ],
    recentHistory: [],
    allowedMetrics: ["settlement.stability"],
  };
}

function llmTemplate(state: WorldState) {
  const rec: LLMRecommendation = {
    temporaryId: "candidate_1",
    name: "테스트 사건",
    category: "economic",
    summary: "테스트",
    scope: "settlement",
    targetIds: [Object.keys(state.settlements)[0] ?? "settlement:0"],
    preconditions: [],
    suggestedBaseProbability: 0.03,
    suggestedDurationTicks: 6,
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -3 }],
    followUps: [],
    reasoningSummary: "테스트",
  };
  const result = validateCandidate(rec, llmInput(state), new Set());
  if (!result.template) throw new Error("LLM 후보 변환 실패");
  return result.template;
}

describe("분기 생성·복원 (§29 / Step 13)", () => {
  it("저장 후 같은 상태로 복원 가능 — 복원 재실행 결과가 원본과 동일", () => {
    const reference = makeEngine("br-restore", 48);
    const interrupted = makeEngine("br-restore", 24);

    const branchState = buildBranchState({
      snapshot: serializeDynamicState(interrupted.state),
      base: { config: interrupted.state.config, map: interrupted.state.map },
      branchId: "main", // 같은 분기 복원
      llmPolicy: "reuse",
    });
    const restored = new SimulationEngine(branchState);
    restored.applyTicks(24);

    expect(restored.state.clock.currentTick).toBe(reference.state.clock.currentTick);
    expect(restored.stateHash).toBe(reference.stateHash);
  });

  it("과거 시점에서 새로운 분기 생성 — 분기 id와 LLM 정책이 반영된다", () => {
    const engine = makeEngine("br-create", 24);
    const snapshot = serializeDynamicState(engine.state);

    const branchState = buildBranchState({
      snapshot,
      base: { config: engine.state.config, map: engine.state.map },
      branchId: "branch:test:1",
      llmPolicy: "off",
    });
    expect(branchState.branchId).toBe("branch:test:1");
    const branchEngine = new SimulationEngine(branchState);
    // 정책 off — LLM 기록·템플릿이 비워진다 (규칙 기반만)
    expect(branchState.llmRecords.length).toBe(0);
    expect(branchState.llmTemplates.length).toBe(0);
    expect([...branchEngine.eventEngine.registry.keys()].some((id) => id.startsWith("llm:"))).toBe(false);
  });

  it("LLM 결과 재사용 정책 — 등록된 LLM 템플릿이 복원된다 (재호출 없음 §23)", async () => {
    const engine = makeEngine("br-llm", 12);
    const { registerLLMTemplate, computeCurrentInputHash } = await import("@/llm/records");
    const template = llmTemplate(engine.state);
    const result = registerLLMTemplate(engine.state, engine.eventEngine, {
      template,
      inputHash: computeCurrentInputHash(engine.state),
      rawOutput: '{"recommendations":[]}',
      provider: "mock",
      model: "mock-1",
      promptVersion: "llm-events-v1",
    });
    expect(result.ok).toBe(true);

    const snapshot = serializeDynamicState(engine.state);
    const restored = new SimulationEngine(
      buildBranchState({
        snapshot,
        base: { config: engine.state.config, map: engine.state.map },
        branchId: "branch:reuse",
        llmPolicy: "reuse",
      }),
    );
    expect(restored.state.llmTemplates.some((t) => t.id === template.id)).toBe(true);
    expect(restored.eventEngine.registry.has(template.id)).toBe(true);
    expect(restored.state.llmRecords.length).toBe(1); // 기록도 재사용
  });

  it("fresh 정책 — 기록은 비우되 이후 새 추천을 받을 수 있다", () => {
    const engine = makeEngine("br-fresh", 12);
    const snapshot = serializeDynamicState(engine.state);
    const restored = new SimulationEngine(
      buildBranchState({
        snapshot,
        base: { config: engine.state.config, map: engine.state.map },
        branchId: "branch:fresh",
        llmPolicy: "fresh",
      }),
    );
    expect(restored.state.llmRecords.length).toBe(0);
    expect(restored.state.llmTemplates.length).toBe(0);
  });

  it("역직렬화 감염 방지 — 복원본을 진행시켜도 원본 스냅숏 데이터는 불변", () => {
    const engine = makeEngine("br-immutable", 12);
    const snapshot = serializeDynamicState(engine.state);
    const original = JSON.parse(JSON.stringify(snapshot));
    const restored = new SimulationEngine(
      buildBranchState({
        snapshot,
        base: { config: engine.state.config, map: engine.state.map },
        branchId: "branch:x",
        llmPolicy: "reuse",
      }),
    );
    restored.applyTicks(12);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(original);
  });
});

describe("두 분기 통계 비교 (§29 / Step 13)", () => {
  function snapshotOf(engine: SimulationEngine, branchId: string): SnapshotLike {
    return {
      id: `snap:${branchId}`,
      worldId: "w",
      tick: engine.state.clock.currentTick,
      branchId,
      label: "auto" as const,
      createdAt: 0,
      data: serializeDynamicState(engine.state),
    };
  }

  it("총인구·식량·사망·사건·폐허 수를 비교한다", () => {
    // 같은 시드 — 결정론으로 두 분기의 출발을 동일하게 만든 뒤 차이를 낸다
    const main = makeEngine("br-compare", 36);
    const alt = makeEngine("br-compare", 36);
    alt.state.settlements[Object.keys(alt.state.settlements)[0]!]!.population -= 500; // 차이 만들기

    const comparison = compareSnapshots(snapshotOf(main, "main"), snapshotOf(alt, "branch:b"));
    expect(comparison.a.branchId).toBe("main");
    expect(comparison.b.branchId).toBe("branch:b");
    expect(comparison.metrics.totalPopulation.a).toBeGreaterThan(0);
    expect(comparison.metrics.totalPopulation.a - comparison.metrics.totalPopulation.b).toBe(500);
    for (const key of Object.keys(comparison.metrics) as Array<keyof typeof comparison.metrics>) {
      expect(Number.isFinite(comparison.metrics[key].a)).toBe(true);
      expect(Number.isFinite(comparison.metrics[key].b)).toBe(true);
      expect(Number.isFinite(comparison.metrics[key].diff)).toBe(true);
    }
  });

  it("폐허 도시 수와 사건 수도 포함한다", () => {
    const a = makeEngine("br-m2", 24);
    const b = makeEngine("br-m2", 24);
    const first = Object.keys(b.state.settlements)[0]!;
    b.state.settlements[first]!.status = "ruined";
    const comparison = compareSnapshots(
      { id: "s1", worldId: "w", tick: 24, branchId: "main", label: "auto", createdAt: 0, data: serializeDynamicState(a.state) },
      { id: "s2", worldId: "w", tick: 24, branchId: "b2", label: "auto", createdAt: 0, data: serializeDynamicState(b.state) },
    );
    expect(comparison.metrics.ruinedCities.b - comparison.metrics.ruinedCities.a).toBe(1);
    expect(comparison.metrics.eventCount.a).toBe(a.state.eventHistory.length);
  });
});

describe("직렬화 왕복은 분기·LLM 템플릿을 포함한다", () => {
  it("round-trip 후에도 llmTemplates·branchId가 보존된다", () => {
    const engine = makeEngine("br-roundtrip", 6);
    engine.state.branchId = "branch:rt";
    engine.state.llmTemplates.push(llmTemplate(engine.state));
    const restored = deserializeDynamicState(
      serializeDynamicState(engine.state),
      { config: engine.state.config, map: engine.state.map },
    );
    expect(restored.branchId).toBe("branch:rt");
    expect(restored.llmTemplates.length).toBe(1);
  });
});
