import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { computeStateHash } from "@/simulation/core/stateHash";
import { initializeWorldState, type WorldState } from "@/simulation/core/worldState";

function makeState(seed: string): WorldState {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  return initializeWorldState(gen);
}

describe("computeStateHash (상태 해시 직렬화 표준 §7.2 / T2)", () => {
  it("같은 상태는 같은 해시를 낸다", () => {
    const a = makeState("hash-same");
    const b = makeState("hash-same");
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });

  it("틱이 다르면 해시가 다르다", () => {
    const a = makeState("hash-tick");
    const b = makeState("hash-tick");
    b.clock.currentTick = 1;
    expect(computeStateHash(a)).not.toBe(computeStateHash(b));
  });

  it("지도 레이어는 해시에서 제외된다 — 지도만 달라지면 해시 불변", () => {
    const a = makeState("hash-map");
    const b = makeState("hash-map");
    b.map.elevation[0] = (b.map.elevation[0] ?? 0) + 0.123;
    b.map.temperature.fill(0.9);
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });

  it("도시 수치가 다르면 해시가 다르다", () => {
    const a = makeState("hash-settle");
    const b = makeState("hash-settle");
    const first = Object.keys(b.settlements)[0];
    b.settlements[first].population += 1;
    expect(computeStateHash(a)).not.toBe(computeStateHash(b));
  });

  it("배속·일시정지는 해시에 영향을 주지 않는다 (결과 무관 원칙)", () => {
    const a = makeState("hash-speed");
    const b = makeState("hash-speed");
    b.clock.speed = 100;
    b.clock.paused = true;
    expect(computeStateHash(a)).toBe(computeStateHash(b));
  });
});
