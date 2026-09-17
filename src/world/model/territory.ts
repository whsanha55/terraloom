/**
 * 도시 영역 계약 (§10.4 / T15).
 *
 * 월드젠 출력이 도시 공식의 입력이 되는 연결 지점. 도시 좌표 중심 반경 R의
 * 원형 영역에서 fertility 평균(육지만)·riverVolume 합·바이옴 구성비를 계산한다.
 * 영역 집계는 월드젠 완료 후 1회만 계산해 도시 상태에 캐시한다 — 매 틱 재계산 없음.
 *
 * 원 판정은 dx²+dy² ≤ R² (제곱 거리 — sqrt 불필요, §7.1).
 */
import { Biome } from "@/world/generation/biome";
import type { WorldMap } from "@/world/model/worldMap";

export const BIOME_COUNT = 7;

export interface SettlementAreaStats {
  /** 영역 내 육지 셀의 비옥도 평균 (육지 없으면 0) */
  fertility: number;
  /** 영역 내 강 유량 합 */
  riverVolume: number;
  /** 바이옴별 셀 수 (인덱스 = Biome 값) */
  biomeCounts: number[];
  landCells: number;
  totalCells: number;
}

export function computeSettlementArea(
  map: WorldMap,
  seaLevel: number,
  centerX: number,
  centerY: number,
  radius: number,
): SettlementAreaStats {
  const biomeCounts = new Array<number>(BIOME_COUNT).fill(0);
  let fertilitySum = 0;
  let riverSum = 0;
  let landCells = 0;
  let totalCells = 0;

  const radius2 = radius * radius;
  const x0 = Math.max(0, centerX - radius);
  const x1 = Math.min(map.width - 1, centerX + radius);
  const y0 = Math.max(0, centerY - radius);
  const y1 = Math.min(map.height - 1, centerY + radius);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radius2) continue;
      const index = y * map.width + x;
      totalCells += 1;
      const biome = map.biome[index];
      if (biome >= 0 && biome < BIOME_COUNT) {
        biomeCounts[biome] += 1;
      }
      if (map.elevation[index] >= seaLevel) {
        landCells += 1;
        fertilitySum += map.fertility[index];
        riverSum += map.riverVolume[index];
      }
    }
  }

  return {
    fertility: landCells > 0 ? fertilitySum / landCells : 0, // 분모 가드(§8.1)
    riverVolume: riverSum,
    biomeCounts,
    landCells,
    totalCells,
  };
}

export function biomeName(biome: number): string {
  return biome === Biome.Ocean
    ? "바다"
    : biome === Biome.Ice
      ? "빙해"
      : biome === Biome.Tundra
        ? "툰드라"
        : biome === Biome.Forest
          ? "숲"
          : biome === Biome.Grassland
            ? "초원"
            : biome === Biome.Desert
              ? "사막"
              : "산지";
}
