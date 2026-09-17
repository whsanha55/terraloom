/**
 * 세계 생성 진입점 (Step 2~4 파이프라인).
 *
 * 고도 → 기후(온도·습도·비옥도·바이옴) → 강 → 도시·연결망 순서로 생성한다.
 *
 * 품질 검증(T5): 육지 비율이 허용 범위(10~70%) 밖이거나 도시가 10~30개
 * 범위를 벗어나면 파생 시드로 재생성한다(최대 5회). 5회 모두 실패한
 * 극단 시드는 마지막 후보 고도장에서 목표 육지 비율이 되는 해수면을
 * 히스토그램 분위수로 보정해 반환한다 — 퇴화 지도가 화면에 도달하지
 * 않게 하는 결정론적 폴백.
 */
import { GENERATOR_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import { createWorldMap, type WorldMap } from "@/world/model/worldMap";
import { generateClimate, type ClimateParams } from "./climate";
import {
  DEFAULT_ELEVATION_PARAMS,
  DEFAULT_SEA_LEVEL,
  computeLandRatio,
  generateElevationField,
  type ElevationParams,
} from "./elevation";
import { generateRivers } from "./rivers";
import {
  placeSettlements,
  type RouteGen,
  type SettlementGen,
  type SettlementPlacement,
} from "./settlements";
import { isLandRatioAcceptable } from "./validate";

export const MAX_GENERATION_ATTEMPTS = 5;
const FALLBACK_TARGET_LAND_RATIO = 0.4;
const HISTOGRAM_BUCKETS = 1024;
/** §34: 도시 10~30개 */
export const MIN_SETTLEMENTS = 10;
export const MAX_SETTLEMENTS = 30;

export interface WorldGenResult {
  map: WorldMap;
  /** 실제 생성 시도 횟수 (재생성 포함) */
  attempts: number;
  seaLevel: number;
  landRatio: number;
  settlements: SettlementGen[];
  routes: RouteGen[];
  /** 5회 재생성 실패 후 해수면 보정을 사용했는가 */
  seaLevelCompensated: boolean;
  generatorVersion: string;
  /** 상태 초기화(§10)에 필요한 설정 회신 */
  config: WorldConfig;
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

  const isCountOk = (placement: SettlementPlacement): boolean =>
    placement.settlements.length >= MIN_SETTLEMENTS &&
    placement.settlements.length <= MAX_SETTLEMENTS;

  let bestField: { field: Float32Array; ratio: number } | null = null;
  let bestFull: {
    field: Float32Array;
    ratio: number;
    placement: SettlementPlacement;
  } | null = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const field = generateElevationField(config, attempt, params);
    const ratio = computeLandRatio(field, seaLevel);
    if (!isLandRatioAcceptable(ratio)) {
      if (
        bestField === null ||
        Math.abs(ratio - FALLBACK_TARGET_LAND_RATIO) <
          Math.abs(bestField.ratio - FALLBACK_TARGET_LAND_RATIO)
      ) {
        bestField = { field, ratio };
      }
      continue;
    }
    // 육지 비율 통과 → 전체 파이프라인 실행 후 도시 수 판정
    map.elevation.set(field);
    generateClimate(map, config, seaLevel, options.climateParams);
    generateRivers(map, seaLevel);
    const placement = placeSettlements(map, config, seaLevel, attempt);
    if (isCountOk(placement)) {
      return {
        map,
        attempts: attempt + 1,
        seaLevel,
        landRatio: ratio,
        settlements: placement.settlements,
        routes: placement.routes,
        seaLevelCompensated: false,
        config,
        generatorVersion: GENERATOR_VERSION,
      };
    }
    if (
      bestFull === null ||
      Math.abs(placement.settlements.length - config.settlementCount) <
        Math.abs(bestFull.placement.settlements.length - config.settlementCount)
    ) {
      bestFull = { field, ratio, placement };
    }
  }

  // 폴백 1: 육지 비율은 통과했던 시도가 있으면 그 중 도시 수가 가장 좋은 것
  if (bestFull !== null) {
    rebuildLayers(map, config, bestFull.field, seaLevel, options.climateParams);
    return {
      map,
      attempts: MAX_GENERATION_ATTEMPTS,
      seaLevel,
      landRatio: bestFull.ratio,
      settlements: bestFull.placement.settlements,
      routes: bestFull.placement.routes,
      seaLevelCompensated: false,
      config,
      generatorVersion: GENERATOR_VERSION,
    };
  }

  // 폴백 2: 전 시도가 육지 비율 실패 — 해수면 분위수 보정 후 재생성
  const source = bestField ?? {
    field: generateElevationField(config, 0, params),
    ratio: 0,
  };
  const compensated = seaLevelForLandRatio(source.field, FALLBACK_TARGET_LAND_RATIO);
  rebuildLayers(map, config, source.field, compensated, options.climateParams);
  const placement = placeSettlements(map, config, compensated, MAX_GENERATION_ATTEMPTS - 1);
  return {
    map,
    attempts: MAX_GENERATION_ATTEMPTS,
    seaLevel: compensated,
    landRatio: computeLandRatio(source.field, compensated),
    settlements: placement.settlements,
    routes: placement.routes,
    seaLevelCompensated: true,
    config,
    generatorVersion: GENERATOR_VERSION,
  };
}

/** 고도 확정 후 기후·강 레이어를 다시 채운다 (도시 배치는 호출자 재실행) */
function rebuildLayers(
  map: WorldMap,
  config: WorldConfig,
  elevation: Float32Array,
  seaLevel: number,
  climateParams?: ClimateParams,
): void {
  map.elevation.set(elevation);
  generateClimate(map, config, seaLevel, climateParams);
  generateRivers(map, seaLevel);
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
