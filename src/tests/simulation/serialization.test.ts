import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation/core/engine";
import {
  deserializeDynamicState,
  serializeDynamicState,
} from "@/simulation/core/serialization";
import { initializeWorldState } from "@/simulation/core/worldState";
import { SnapshotCorruptError } from "@/simulation/errors";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

function makeEngine(seed: string, ticks = 0): SimulationEngine {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  const engine = new SimulationEngine(initializeWorldState(gen));
  engine.applyTicks(ticks);
  return engine;
}

describe("동적 상태 직렬화 — 저장 후 재실행 결과 동일 (Step 8 완료 조건, §28.3 전신)", () => {
  it("직렬화→역직렬화→이어서 실행이 중단 없는 실행과 같은 해시를 낸다", () => {
    const reference = makeEngine("ser-roundtrip", 48);
    const interrupted = makeEngine("ser-roundtrip", 24);

    const restored = deserializeDynamicState(serializeDynamicState(interrupted.state), {
      config: interrupted.state.config,
      map: interrupted.state.map,
    });
    expect(restored.settlements).not.toBe(interrupted.state.settlements); // 깊은 복제
    new SimulationEngine(restored).applyTicks(24);

    expect(restored.clock.currentTick).toBe(reference.state.clock.currentTick);
    expect(new SimulationEngine(restored).stateHash).toBe(reference.stateHash);
    expect(restored.eventHistory.length).toBe(reference.state.eventHistory.length);
    expect(restored.changeLedger.length).toBe(reference.state.changeLedger.length);
  });

  it("직렬화 결과는 JSON 안전하다 (지도 버퍼 미포함)", () => {
    const engine = makeEngine("ser-json", 13);
    const data = serializeDynamicState(engine.state);
    const json = JSON.parse(JSON.stringify(data));
    expect(json.simulationVersion).toBe(engine.state.simulationVersion);
    expect(JSON.stringify(json)).toContain("settlements");
  });

  it("원장은 항목과 원인별 합이 모두 보존된다 (§8.3)", () => {
    const engine = makeEngine("ser-ledger", 24);
    const restored = deserializeDynamicState(serializeDynamicState(engine.state), {
      config: engine.state.config,
      map: engine.state.map,
    });
    expect(restored.changeLedger.length).toBe(engine.state.changeLedger.length);
    expect(restored.changeLedger.totalsByCause()).toEqual(engine.state.changeLedger.totalsByCause());
  });

  it("simulationVersion 불일치 시 SnapshotCorruptError (§28.6 전신)", () => {
    const engine = makeEngine("ser-version", 3);
    const data = serializeDynamicState(engine.state);
    data.simulationVersion = "0.0.0-other";
    expect(() =>
      deserializeDynamicState(data, { config: engine.state.config, map: engine.state.map }),
    ).toThrow(SnapshotCorruptError);
  });
});
