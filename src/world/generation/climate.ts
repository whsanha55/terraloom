/**
 * 기후 생성 (Step 3) — 온도·습도·바이옴 레이어.
 *
 * 온도: 위도(극지→적도) 기반 − 고도 감률(lapse). 노이즈 없이 결정적 공식.
 * 습도: 독립 파생 시드의 FBM 노이즈 × 내륙 건조 보정(물까지의 BFS 거리).
 * 바이옴: classifyBiome(온도, 습도, 고도, 해수면).
 */
import { SIMULATION_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";
import { createRng } from "@/world/random/rng";
import { deriveSeed } from "@/world/random/seed";
import { classifyBiome } from "./biome";
import { createFbm2D, createValueNoise2D, type FbmOptions } from "./noise";

export interface ClimateParams {
  moistureNoise: FbmOptions;
  /** 내륙 깊을수록 습도 감소 비율 (0~1) */
  inlandFalloff: number;
  /** 해수면 위 육지 고도의 온도 감률 (0~1, 최고봉에서 이만큼 하락) */
  elevationLapse: number;
}

export const DEFAULT_CLIMATE_PARAMS: Readonly<ClimateParams> = {
  moistureNoise: { octaves: 4, frequency: 2.5, persistence: 0.55, lacunarity: 2 },
  inlandFalloff: 0.55,
  elevationLapse: 0.7,
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 각 셀에서 가장 가까운 물까지의 거리(4방향 BFS).
 * 물 셀 = 0. 초월함수 없는 정수 연산만 사용한다.
 */
export function computeDistanceToWater(map: WorldMap, seaLevel: number): Int32Array {
  const { width, height, elevation } = map;
  const size = width * height;
  const distance = new Int32Array(size).fill(-1);
  let queueHead = 0;
  let queueTail = 0;
  const queue = new Int32Array(size);

  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      distance[i] = 0;
      queue[queueTail++] = i;
    }
  }

  while (queueHead < queueTail) {
    const index = queue[queueHead++];
    const d = distance[index] + 1;
    const x = index % width;
    const y = (index - (index % width)) / width;
    // 4방향 확장
    if (x > 0 && distance[index - 1] < 0) {
      distance[index - 1] = d;
      queue[queueTail++] = index - 1;
    }
    if (x < width - 1 && distance[index + 1] < 0) {
      distance[index + 1] = d;
      queue[queueTail++] = index + 1;
    }
    if (y > 0 && distance[index - width] < 0) {
      distance[index - width] = d;
      queue[queueTail++] = index - width;
    }
    if (y < height - 1 && distance[index + width] < 0) {
      distance[index + width] = d;
      queue[queueTail++] = index + width;
    }
  }

  // 물이 아예 없는 지도 가드 — 모든 거리 0으로 둔다(내륙 보정 없음)
  if (distance[0] < 0 && size > 0) {
    distance.fill(0);
  }
  return distance;
}

/** 지도의 온도·습도·바이옴 레이어를 채운다 (elevation은 이미 채워져 있어야 한다) */
export function generateClimate(
  map: WorldMap,
  config: WorldConfig,
  seaLevel: number,
  params: ClimateParams = DEFAULT_CLIMATE_PARAMS,
): void {
  const rng = createRng(
    deriveSeed({
      worldSeed: config.seed,
      simulationVersion: SIMULATION_VERSION,
      systemName: "worldgen.climate",
      purpose: "moisture",
    }),
  );
  const moistureNoise = createFbm2D(createValueNoise2D(rng), params.moistureNoise);

  const { width, height } = map;
  const res = Math.max(width, height);

  // 온도 — 위도 기반, 고도 감률
  for (let y = 0; y < height; y++) {
    const latitude = Math.abs((2 * y) / (height - 1) - 1); // 0(적도) ~ 1(극지)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = map.elevation[i];
      const landHeight01 = e > seaLevel && seaLevel < 1 ? (e - seaLevel) / (1 - seaLevel) : 0; // 분모 가드
      map.temperature[i] = clamp01(1 - latitude - params.elevationLapse * landHeight01);
    }
  }

  // 습도 — 노이즈 × 내륙 건조 보정, 이후 [0,1] 정규화
  const distance = computeDistanceToWater(map, seaLevel);
  let maxDistance = 0;
  for (const d of distance) {
    if (d > maxDistance) maxDistance = d;
  }
  let moistureMin = Infinity;
  let moistureMax = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const inlandness = maxDistance > 0 ? distance[i] / maxDistance : 0; // 분모 가드(전부 물 또는 섬 없음)
      const n = moistureNoise(x / (res - 1), y / (res - 1));
      // Float32로 저장된 값을 다시 읽어 min/max를 계산한다 —
      // float64 원시값으로 정규화하면 반올림 오차로 [0,1]을 미세하게 벗어난다(§8.1)
      map.moisture[i] = n * (1 - params.inlandFalloff * inlandness);
      const stored = map.moisture[i];
      if (stored < moistureMin) moistureMin = stored;
      if (stored > moistureMax) moistureMax = stored;
    }
  }
  const span = moistureMax - moistureMin;
  for (let i = 0; i < width * height; i++) {
    map.moisture[i] = span > 0 ? (map.moisture[i] - moistureMin) / span : 0.5;
  }

  // 비옥도 — 농업 생산·도시 입지의 기준값(§10.4). 물은 0.
  for (let i = 0; i < width * height; i++) {
    const e = map.elevation[i];
    if (e < seaLevel) {
      map.fertility[i] = 0;
      continue;
    }
    const landHeight01 = e > seaLevel && seaLevel < 1 ? (e - seaLevel) / (1 - seaLevel) : 0;
    const tempFactor = clamp01(1 - Math.abs(map.temperature[i] - 0.55) * 1.6);
    map.fertility[i] = clamp01(tempFactor * map.moisture[i] * (1 - 0.8 * landHeight01));
  }

  // 바이옴
  for (let i = 0; i < width * height; i++) {
    map.biome[i] = classifyBiome(map.temperature[i], map.moisture[i], map.elevation[i], seaLevel);
  }
}
