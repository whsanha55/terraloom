import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState } from "@/simulation/core/worldState";

function makeEngine(seed: string) {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  return new SimulationEngine(initializeWorldState(gen));
}

describe("SimulationEngine (Step 5)", () => {
  it("틱마다 월이 증가하고 정확히 12틱 후 1년이 지난다", () => {
    const engine = makeEngine("eng-clock");
    expect(engine.state.clock.month).toBe(0);
    engine.tick();
    expect(engine.state.clock.month).toBe(1);
    expect(engine.state.clock.year).toBe(0);
    engine.applyTicks(11);
    expect(engine.state.clock.currentTick).toBe(12);
    expect(engine.state.clock.year).toBe(1);
    expect(engine.state.clock.month).toBe(0);
  });

  it("배치 패턴과 무관하게 같은 해시를 낸다 (배속 무관 원칙 §7)", () => {
    const oneByOne = makeEngine("eng-speed");
    const dozenByDozen = makeEngine("eng-speed");
    const irregular = makeEngine("eng-speed");

    for (let i = 0; i < 1200; i++) oneByOne.tick();
    for (let i = 0; i < 100; i++) dozenByDozen.applyTicks(12);
    const pattern = [3, 7, 50, 1, 12, 1127]; // 합계 1,200
    for (const n of pattern) irregular.applyTicks(n);

    const hash = oneByOne.stateHash;
    expect(dozenByDozen.stateHash).toBe(hash);
    expect(irregular.stateHash).toBe(hash);
  });

  it("같은 시드의 두 엔진은 1,200틱 후에도 동일하다 (결정론)", () => {
    const a = makeEngine("eng-det");
    const b = makeEngine("eng-det");
    a.applyTicks(1200);
    b.applyTicks(1200);
    expect(a.stateHash).toBe(b.stateHash);
  });

  it("틱 수가 다르면 해시가 다르다", () => {
    const a = makeEngine("eng-diff");
    const b = makeEngine("eng-diff");
    a.applyTicks(5);
    b.applyTicks(6);
    expect(a.stateHash).not.toBe(b.stateHash);
  });
});
