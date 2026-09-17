import { describe, expect, it } from "vitest";
import { deriveSeed, fnv1a32 } from "@/world/random/seed";

describe("fnv1a32", () => {
  it("공식 테스트 벡터와 일치한다", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("결과는 부호 없는 32비트 정수다 (한글 시드 포함)", () => {
    const h = fnv1a32("테라룸-시드-142");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("deriveSeed", () => {
  const base = {
    worldSeed: "aren-142",
    simulationVersion: "0.1.0",
    systemName: "climate",
  };

  it("같은 입력은 같은 파생 시드를 만든다", () => {
    expect(deriveSeed(base)).toBe(deriveSeed({ ...base }));
  });

  it("worldSeed가 달라지면 파생 시드가 달라진다", () => {
    expect(deriveSeed({ ...base, worldSeed: "other" })).not.toBe(deriveSeed(base));
  });

  it("틱·시스템·개체·용도가 달라지면 파생 시드가 달라진다", () => {
    const seed0 = deriveSeed(base);
    expect(deriveSeed({ ...base, tick: 1 })).not.toBe(seed0);
    expect(deriveSeed({ ...base, systemName: "agriculture" })).not.toBe(seed0);
    expect(deriveSeed({ ...base, entityId: "settlement:aren" })).not.toBe(seed0);
    expect(deriveSeed({ ...base, purpose: "noise" })).not.toBe(seed0);
  });

  it("결과는 [0, 2^32) 정수다", () => {
    for (const s of [deriveSeed(base), deriveSeed({ ...base, tick: 999 })]) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});
