import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEVATION_PARAMS,
  computeLandRatio,
  generateElevationField,
} from "@/world/generation/elevation";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

const smallConfig = () => {
  const config = createDefaultWorldConfig("elev-test");
  config.resolution = 64;
  return config;
};

describe("generateElevationField", () => {
  it("같은 시드·시도 번호에서 비트 수준으로 동일하다", () => {
    const a = generateElevationField(smallConfig(), 0, DEFAULT_ELEVATION_PARAMS);
    const b = generateElevationField(smallConfig(), 0, DEFAULT_ELEVATION_PARAMS);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Object.is(a[i], b[i])).toBe(true);
    }
  });

  it("값은 [0, 1]로 정규화된 유한수다", () => {
    const field = generateElevationField(smallConfig(), 0, DEFAULT_ELEVATION_PARAMS);
    for (const v of field) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("시도 번호가 다르면 다른 지형이 나온다 (재생성 시드 분리)", () => {
    const a = generateElevationField(smallConfig(), 0, DEFAULT_ELEVATION_PARAMS);
    const b = generateElevationField(smallConfig(), 1, DEFAULT_ELEVATION_PARAMS);
    const differences = Array.from(a).filter((v, i) => v !== b[i]);
    expect(differences.length).toBeGreaterThan(0);
  });

  it("배열 크기는 resolution²이다", () => {
    const config = smallConfig();
    const field = generateElevationField(config, 0, DEFAULT_ELEVATION_PARAMS);
    expect(field.length).toBe(config.resolution * config.resolution);
  });
});

describe("computeLandRatio", () => {
  it("해수면 이상 셀의 비율을 계산한다", () => {
    const field = new Float32Array([0.2, 0.6, 0.8, 0.4, 0.5, 0.1]);
    expect(computeLandRatio(field, 0.5)).toBeCloseTo(3 / 6);
  });

  it("빈 배열은 0을 반환한다 (분모 가드)", () => {
    expect(computeLandRatio(new Float32Array(0), 0.5)).toBe(0);
  });
});
