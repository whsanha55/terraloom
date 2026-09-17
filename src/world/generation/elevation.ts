/**
 * 고도장 생성 (Step 2).
 *
 * FBM 노이즈 × 대륙 마스크(가장자리 감쇠) → [0,1] 정규화.
 * 재시도(attempt)마다 독립된 파생 시드를 쓴다 — 재시도 횟수도 시드의 함수(§7).
 */
import { SIMULATION_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import { createRng } from "@/world/random/rng";
import { deriveSeed } from "@/world/random/seed";
import { createFbm2D, createValueNoise2D } from "./noise";

export interface ElevationParams {
  octaves: number;
  frequency: number;
  persistence: number;
  lacunarity: number;
  /** 가장자리 대륙 마스크 강도 (0=마스크 없음, 1=모서리 고도 0) */
  maskStrength: number;
}

export const DEFAULT_ELEVATION_PARAMS: Readonly<ElevationParams> = {
  octaves: 5,
  frequency: 3,
  persistence: 0.5,
  lacunarity: 2,
  maskStrength: 0.85,
};

export const DEFAULT_SEA_LEVEL = 0.5;

export function generateElevationField(
  config: WorldConfig,
  attempt: number,
  params: ElevationParams = DEFAULT_ELEVATION_PARAMS,
): Float32Array {
  const rng = createRng(
    deriveSeed({
      worldSeed: config.seed,
      simulationVersion: SIMULATION_VERSION,
      systemName: "worldgen.elevation",
      purpose: `attempt:${attempt}`,
    }),
  );
  const noise = createFbm2D(createValueNoise2D(rng), params);

  const res = config.resolution;
  const size = res * res;
  const field = new Float32Array(size);

  const center = (res - 1) / 2;
  const maxDistance2 = center * center + center * center;

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      // 세계 좌표 정규화(§7.1) — 해상도 무관 같은 형태
      const wx = x / (res - 1);
      const wy = y / (res - 1);
      const n = noise(wx, wy);

      const dx = x - center;
      const dy = y - center;
      const distance2 = (dx * dx + dy * dy) / maxDistance2; // 0(중심) ~ 1(모서리)
      field[y * res + x] = n * (1 - params.maskStrength * distance2);
    }
  }

  // [0,1] 정규화 — 분모 0 가드(§8.1): 단일 값 지형이면 중간 고도로 평탄화
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 0) {
    field.fill(0.5);
    return field;
  }
  for (let i = 0; i < size; i++) {
    field[i] = (field[i] - min) / span;
  }
  return field;
}

/** 해수면(포함) 이상 셀의 비율 */
export function computeLandRatio(elevation: Float32Array, seaLevel: number): number {
  if (elevation.length === 0) return 0;
  let land = 0;
  for (const v of elevation) {
    if (v >= seaLevel) land++;
  }
  return land / elevation.length;
}
