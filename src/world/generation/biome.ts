/**
 * 바이옴 분류 (Step 3).
 *
 * 온도·습도·고도의 임계값 조합으로 범주를 정한다.
 * WorldMap.biome(Uint8Array)에 저장되므로 값은 0~255 정수다.
 */
import type { Rgb } from "@/world/rendering/elevationRender";

export enum Biome {
  Ocean = 0,
  Ice = 1,
  Tundra = 2,
  Forest = 3,
  Grassland = 4,
  Desert = 5,
  Mountain = 6,
}

/** 분류 임계값 — 상수로 두어 테스트와 UI 범례가 같은 값을 참조한다 */
export const ICE_TEMPERATURE = 0.15;
export const TUNDRA_TEMPERATURE = 0.25;
export const HOT_TEMPERATURE = 0.65;
export const DESERT_MOISTURE = 0.3;
export const GRASSLAND_MOISTURE = 0.35;
export const MOUNTAIN_ELEVATION = 0.85;

export interface BiomeInfo {
  name: string;
  color: Rgb;
}

/** 범주형 팔레트(§26) — 밝기 대비로 색약 구분 가능 */
export const BIOME_INFO: Record<Biome, BiomeInfo> = {
  [Biome.Ocean]: { name: "바다", color: [30, 58, 95] },
  [Biome.Ice]: { name: "빙해", color: [214, 230, 239] },
  [Biome.Tundra]: { name: "툰드라", color: [151, 166, 165] },
  [Biome.Forest]: { name: "숲", color: [46, 99, 76] },
  [Biome.Grassland]: { name: "초원", color: [141, 148, 82] },
  [Biome.Desert]: { name: "사막", color: [196, 180, 130] },
  [Biome.Mountain]: { name: "산지", color: [171, 173, 179] },
};

export function classifyBiome(
  temperature: number,
  moisture: number,
  elevation: number,
  seaLevel: number,
): Biome {
  if (elevation < seaLevel) {
    return temperature < ICE_TEMPERATURE ? Biome.Ice : Biome.Ocean;
  }
  if (elevation >= MOUNTAIN_ELEVATION) {
    return Biome.Mountain;
  }
  if (temperature < TUNDRA_TEMPERATURE) {
    return Biome.Tundra;
  }
  if (temperature >= HOT_TEMPERATURE) {
    return moisture < DESERT_MOISTURE ? Biome.Desert : Biome.Forest;
  }
  return moisture < GRASSLAND_MOISTURE ? Biome.Grassland : Biome.Forest;
}
