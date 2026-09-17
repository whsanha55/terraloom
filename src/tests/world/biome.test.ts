import { describe, expect, it } from "vitest";
import { Biome, classifyBiome } from "@/world/generation/biome";

const SEA = 0.5;

describe("classifyBiome", () => {
  it("해수면 아래는 온도에 따라 바다 또는 빙해다", () => {
    expect(classifyBiome(0.9, 0.5, 0.3, SEA)).toBe(Biome.Ocean);
    expect(classifyBiome(0.1, 0.5, 0.3, SEA)).toBe(Biome.Ice);
  });

  it("높은 산은 온도·습도와 무관하게 산지다", () => {
    expect(classifyBiome(0.9, 0.9, 0.95, SEA)).toBe(Biome.Mountain);
  });

  it("추운 육지는 툰드라다", () => {
    expect(classifyBiome(0.2, 0.5, 0.6, SEA)).toBe(Biome.Tundra);
  });

  it("더운 건조지는 사막, 더운 습윤지는 숲이다", () => {
    expect(classifyBiome(0.8, 0.2, 0.6, SEA)).toBe(Biome.Desert);
    expect(classifyBiome(0.8, 0.6, 0.6, SEA)).toBe(Biome.Forest);
  });

  it("온대는 습도에 따라 초원 또는 숲이다", () => {
    expect(classifyBiome(0.45, 0.2, 0.6, SEA)).toBe(Biome.Grassland);
    expect(classifyBiome(0.45, 0.5, 0.6, SEA)).toBe(Biome.Forest);
  });

  it("모든 바이옴 값은 0 이상의 작은 정수다 (Uint8 저장 호환)", () => {
    const biomes = Object.values(Biome).filter((v): v is Biome => typeof v === "number");
    expect(biomes.length).toBe(7);
    for (const biome of biomes) {
      expect(biome).toBeGreaterThanOrEqual(0);
      expect(biome).toBeLessThanOrEqual(255);
      expect(Number.isInteger(biome)).toBe(true);
    }
  });
});
