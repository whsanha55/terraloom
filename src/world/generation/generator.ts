/**
 * 세계 생성 진입점 (Step 2).
 *
 * 품질 검증(T5): 육지 비율이 허용 범위(10~70%) 밖이면 파생 시드로 재생성한다.
 * 최대 5회(§ Step 2 작업). 5회 모두 실패한 극단 시드는 마지막 후보 고도장에서
 * 목표 육지 비율이 되는 해수면을 히스토그램 분위수로 보정해 반환한다 —
 * 퇴화 지도가 화면에 도달하지 않게 하는 결정론적 폴백.
 */
import { GENERATOR_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import { createWorldMap, type WorldMap } from "@/world/model/worldMap";
import {
  DEFAULT_ELEVATION_PARAMS,
  DEFAULT_SEA_LEVEL,
  computeLandRatio,
  generateElevationField,
  type ElevationParams,
} from "./elevation";
import { generateClimate, type ClimateParams } from "./climate";
import { isLandRatioAcceptable } from "./validate";

export const MAX_GENERATION_ATTEMPTS = 5;
const FALLBACK_TARGET_LAND_RATIO = 0.4;
const HISTOGRAM_BUCKETS = 1024;

export interface WorldGenResult {
  map: WorldMap;
  /** 실제 생성 시도 횟수 (재생성 포함) */
  attempts: number;
  seaLevel: number;
  landRatio: number;
  /** 5회 재생성 실패 후 해수면 보정을 사용했는가 */
  seaLevelCompensated: boolean;
  generatorVersion: string;
}

export interface GenerateWorldOptions {
  seaLevel?: number;
  params?: ElevationParams;
  climateParams?: ClimateParams;
}

export function generateWorld(
  config: WorldConfig,
  options: GenerateWorldOptions = {},
): WorldGenResult {
  const seaLevel = options.seaLevel ?? DEFAULT_SEA_LEVEL;
  const params = options.params ?? DEFAULT_ELEVATION_PARAMS;
  const map = createWorldMap(config.resolution, config.resolution);

  let best: { field: Float32Array; ratio: number } | null = null;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const field = generateElevationField(config, attempt, params);
    const ratio = computeLandRatio(field, seaLevel);
    if (isLandRatioAcceptable(ratio)) {
      finalizeWorld(map, config, field, seaLevel, options.climateParams);
      return {
        map,
        attempts: attempt + 1,
        seaLevel,
        landRatio: ratio,
        seaLevelCompensated: false,
        generatorVersion: GENERATOR_VERSION,
      };
    }
    if (
      best === null ||
      Math.abs(ratio - FALLBACK_TARGET_LAND_RATIO) <
        Math.abs(best.ratio - FALLBACK_TARGET_LAND_RATIO)
    ) {
      best = { field, ratio };
    }
  }

  const field = best!.field;
  const compensated = seaLevelForLandRatio(field, FALLBACK_TARGET_LAND_RATIO);
  finalizeWorld(map, config, field, compensated, options.climateParams);
  return {
    map,
    attempts: MAX_GENERATION_ATTEMPTS,
    seaLevel: compensated,
    landRatio: computeLandRatio(field, compensated),
    seaLevelCompensated: true,
    generatorVersion: GENERATOR_VERSION,
  };
}

/** 고도 확정 후 기후·바이옴 레이어를 채운다 */
function finalizeWorld(
  map: WorldMap,
  config: WorldConfig,
  elevation: Float32Array,
  seaLevel: number,
  climateParams?: ClimateParams,
): void {
  map.elevation.set(elevation);
  generateClimate(map, config, seaLevel, climateParams);
}

/** 고도장에서 목표 육지 비율을 만드는 해수면 (히스토그램 분위수, 결정론적) */
export function seaLevelForLandRatio(elevation: Float32Array, targetRatio: number): number {
  if (elevation.length === 0 || targetRatio <= 0) {
    return 1; // 육지 0 — 전부 바다
  }
  const histogram = new Int32Array(HISTOGRAM_BUCKETS);
  for (const v of elevation) {
    const bucket = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(v * HISTOGRAM_BUCKETS));
    histogram[bucket] += 1;
  }
  const targetLand = Math.floor(elevation.length * targetRatio);
  let cumulativeFromTop = 0;
  for (let bucket = HISTOGRAM_BUCKETS - 1; bucket >= 0; bucket--) {
    cumulativeFromTop += histogram[bucket];
    if (cumulativeFromTop >= targetLand) {
      // 버킷 b의 하한을 해수면으로 삼으면 육지 = 버킷 ≥ b의 셀
      return bucket / HISTOGRAM_BUCKETS;
    }
  }
  return 0;
}
