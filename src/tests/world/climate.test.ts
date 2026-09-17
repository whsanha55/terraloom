import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { DEFAULT_CLIMATE_PARAMS, computeDistanceToWater } from "@/world/generation/climate";
import { Biome } from "@/world/generation/biome";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { createWorldMap } from "@/world/model/worldMap";

const config = (seed: string, resolution = 128) => {
  const c = createDefaultWorldConfig(seed);
  c.resolution = resolution;
  return c;
};

describe("generateClimate", () => {
  it("결정론적이다 — 같은 고도장·시드·해수면은 같은 기후를 만든다", () => {
    const a = generateWorld(config("climate-det"));
    const b = generateWorld(config("climate-det"));
    for (const layer of ["temperature", "moisture", "biome"] as const) {
      const la = a.map[layer];
      const lb = b.map[layer];
      for (let i = 0; i < la.length; i++) {
        expect(Object.is(la[i], lb[i])).toBe(true);
      }
    }
  });

  it("온도·습도는 [0,1] 유한수고 바이옴은 열거 값이다", () => {
    const { map } = generateWorld(config("climate-range"));
    const validBiomes = new Set<number>(Object.values(Biome).map(Number));
    for (let i = 0; i < map.temperature.length; i++) {
      expect(Number.isFinite(map.temperature[i])).toBe(true);
      expect(map.temperature[i]).toBeGreaterThanOrEqual(0);
      expect(map.temperature[i]).toBeLessThanOrEqual(1);
      expect(Number.isFinite(map.moisture[i])).toBe(true);
      expect(map.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(map.moisture[i]).toBeLessThanOrEqual(1);
      expect(validBiomes.has(map.biome[i])).toBe(true);
    }
  });

  it("비옥도는 [0,1]이고 물에서는 0이다", () => {
    const { map } = generateWorld(config("climate-fertility"));
    for (let i = 0; i < map.fertility.length; i++) {
      expect(Number.isFinite(map.fertility[i])).toBe(true);
      expect(map.fertility[i]).toBeGreaterThanOrEqual(0);
      expect(map.fertility[i]).toBeLessThanOrEqual(1);
      if (map.elevation[i] < 0.5) {
        expect(map.fertility[i]).toBe(0);
      }
    }
  });

  it("극지방행이 적도행보다 평균 온도가 낮다 (위도 기반 온도)", () => {
    const { map } = generateWorld(config("climate-lat"));
    const width = map.width;
    const rowAverage = (y: number) => {
      let sum = 0;
      for (let x = 0; x < width; x++) sum += map.temperature[y * width + x];
      return sum / width;
    };
    expect(rowAverage(2)).toBeLessThan(rowAverage(map.height / 2));
  });

  it("해수면 아래 셀은 바다·빙해 바이옴만 가진다", () => {
    const { map } = generateWorld(config("climate-sea"));
    for (let i = 0; i < map.elevation.length; i++) {
      if (map.elevation[i] < 0.5) {
        expect([Biome.Ocean, Biome.Ice]).toContain(map.biome[i]);
      }
    }
  });

  it("여러 시드에서 주요 육지 바이옴이 최소 2종 이상 나온다", () => {
    const seen = new Set<number>();
    for (let s = 0; s < 3; s++) {
      const { map } = generateWorld(config(`climate-biomes-${s}`));
      for (const b of map.biome) {
        if (b !== Biome.Ocean && b !== Biome.Ice) seen.add(b);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("computeDistanceToWater (습도 보정용 BFS)", () => {
  it("물 셀에서의 거리는 0이고 4방향으로 전파된다", () => {
    // 4×4, (0,0)만 물
    const elevation = new Float32Array(16).fill(0.8);
    elevation[0] = 0.2;
    const map = createWorldMap(4, 4);
    map.elevation.set(elevation);
    const distance = computeDistanceToWater(map, 0.5);
    expect(distance[0]).toBe(0); // (0,0) 물
    expect(distance[1]).toBe(1); // (1,0)
    expect(distance[4]).toBe(1); // (0,1)
    expect(distance[5]).toBe(2); // (1,1)
    expect(distance[15]).toBe(6); // (3,3) — 맨해튼 거리 3+3
  });
});

describe("DEFAULT_CLIMATE_PARAMS", () => {
  it("습도 노이즈 파라미터가 정의되어 있다", () => {
    expect(DEFAULT_CLIMATE_PARAMS.moistureNoise.octaves).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CLIMATE_PARAMS.inlandFalloff).toBeGreaterThan(0);
    expect(DEFAULT_CLIMATE_PARAMS.inlandFalloff).toBeLessThan(1);
  });
});
