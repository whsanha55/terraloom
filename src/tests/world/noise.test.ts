import { describe, expect, it } from "vitest";
import { createRng } from "@/world/random/rng";
import { createFbm2D, createValueNoise2D } from "@/world/generation/noise";

const SAMPLE_POINTS: Array<[number, number]> = [
  [0, 0],
  [0.5, 0.5],
  [1.25, 3.75],
  [100.001, 42.5],
  [0.999, 0.001],
];

describe("createValueNoise2D", () => {
  it("같은 시드의 순열에서 같은 샘플이 나온다", () => {
    const a = createValueNoise2D(createRng(101));
    const b = createValueNoise2D(createRng(101));
    for (const [x, y] of SAMPLE_POINTS) {
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  it("다른 시드는 다른 샘플을 만든다", () => {
    const a = createValueNoise2D(createRng(1));
    const b = createValueNoise2D(createRng(2));
    const valsA = SAMPLE_POINTS.map(([x, y]) => a(x, y));
    const valsB = SAMPLE_POINTS.map(([x, y]) => b(x, y));
    expect(valsA).not.toEqual(valsB);
  });

  it("출력은 [0, 1] 범위의 유한수다", () => {
    const noise = createValueNoise2D(createRng(7));
    for (let i = 0; i < 10_000; i++) {
      const v = noise(i * 0.137, i * 0.291);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("createFbm2D", () => {
  const options = { octaves: 5, frequency: 3, persistence: 0.5, lacunarity: 2 };

  it("결정론적이다", () => {
    const a = createFbm2D(createValueNoise2D(createRng(9)), options);
    const b = createFbm2D(createValueNoise2D(createRng(9)), options);
    for (const [x, y] of SAMPLE_POINTS) {
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  it("출력은 [0, 1] 범위다", () => {
    const fbm = createFbm2D(createValueNoise2D(createRng(9)), options);
    for (let i = 0; i < 5_000; i++) {
      const v = fbm((i % 97) / 97, (i % 89) / 89);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("옥타브가 1 미만이면 거부한다", () => {
    const noise = createValueNoise2D(createRng(1));
    expect(() => createFbm2D(noise, { ...options, octaves: 0 })).toThrow(RangeError);
  });
});
