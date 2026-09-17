import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { MAX_LAND_RATIO, MIN_LAND_RATIO } from "@/world/generation/validate";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

const config = (seed: string, resolution = 64) => {
  const c = createDefaultWorldConfig(seed);
  c.resolution = resolution;
  return c;
};

describe("generateWorld", () => {
  it("같은 시드는 시도 횟수 포함 완전히 동일한 결과를 낸다", () => {
    const a = generateWorld(config("g1"));
    const b = generateWorld(config("g1"));
    expect(a.attempts).toBe(b.attempts);
    expect(a.landRatio).toBe(b.landRatio);
    expect(a.seaLevel).toBe(b.seaLevel);
    expect(a.seaLevelCompensated).toBe(b.seaLevelCompensated);
    expect(a.generatorVersion).toBe(b.generatorVersion);
    for (let i = 0; i < a.map.elevation.length; i++) {
      expect(Object.is(a.map.elevation[i], b.map.elevation[i])).toBe(true);
    }
  });

  it("다른 시드는 다른 지형을 만든다", () => {
    const a = generateWorld(config("alpha"));
    const b = generateWorld(config("beta"));
    expect(Array.from(a.map.elevation)).not.toEqual(Array.from(b.map.elevation));
  });

  it("어떤 시드에서도 결과 육지 비율은 허용 범위다 (퇴화 지도 차단)", () => {
    for (let i = 0; i < 10; i++) {
      const result = generateWorld(config(`seed-${i}`));
      expect(result.landRatio).toBeGreaterThanOrEqual(MIN_LAND_RATIO);
      expect(result.landRatio).toBeLessThanOrEqual(MAX_LAND_RATIO);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.attempts).toBeLessThanOrEqual(5);
      expect(result.seaLevelCompensated).toBe(false);
    }
  });

  it("극단 해수면 입력도 분위수 폴백으로 허용 범위를 지킨다", () => {
    const result = generateWorld(config("degenerate"), { seaLevel: 0.995 });
    expect(result.attempts).toBe(5);
    expect(result.seaLevelCompensated).toBe(true);
    expect(result.landRatio).toBeGreaterThanOrEqual(MIN_LAND_RATIO);
    expect(result.landRatio).toBeLessThanOrEqual(MAX_LAND_RATIO);
  });

  it("지도 크기는 resolution을 따른다", () => {
    const result = generateWorld(config("size-check", 256));
    expect(result.map.width).toBe(256);
    expect(result.map.height).toBe(256);
    expect(result.map.elevation.length).toBe(256 * 256);
  });
});
