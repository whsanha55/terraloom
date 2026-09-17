import { describe, expect, it } from "vitest";
import { computeSettlementArea } from "@/world/model/territory";
import { Biome } from "@/world/generation/biome";
import { createWorldMap } from "@/world/model/worldMap";

function makeMap(size = 16) {
  const map = createWorldMap(size, size);
  map.elevation.fill(0.7); // 전부 육지
  map.fertility.fill(0.5);
  map.biome.fill(Biome.Grassland);
  return map;
}

const idx = (x: number, y: number) => y * 16 + x;

describe("computeSettlementArea (도시 영역 계약 §10.4 / T15)", () => {
  it("반경 원형 영역의 비옥도 평균·강 유량 합·바이옴 분포를 계산한다", () => {
    const map = makeMap();
    map.fertility[idx(8, 8)] = 1.0; // 영역 내 한 셀만 다르게
    map.riverVolume[idx(7, 8)] = 0.3;
    map.riverVolume[idx(8, 9)] = 0.2;
    map.biome[idx(7, 8)] = Biome.Forest;
    map.biome[idx(8, 9)] = Biome.Forest;

    const area = computeSettlementArea(map, 0.5, 8, 8, 2);
    // 반경 2 원: dx²+dy² ≤ 4 → 13셀
    expect(area.totalCells).toBe(13);
    expect(area.landCells).toBe(13);
    expect(area.fertility).toBeCloseTo((12 * 0.5 + 1.0) / 13);
    expect(area.riverVolume).toBeCloseTo(0.5);
    expect(area.biomeCounts[Biome.Forest]).toBe(2);
    expect(area.biomeCounts[Biome.Grassland]).toBe(11);
  });

  it("비옥도 평균은 육지 셀만 포함한다", () => {
    const map = makeMap();
    map.elevation[idx(8, 8)] = 0.2; // 영역 중앙을 바다로
    map.fertility[idx(8, 8)] = 0.9; // 바다 비옥도는 계산에 포함되지 않아야 한다
    const area = computeSettlementArea(map, 0.5, 8, 8, 2);
    expect(area.landCells).toBe(12);
    expect(area.totalCells).toBe(13);
    expect(area.fertility).toBeCloseTo(0.5);
  });

  it("지도 경계에서 영역은 잘린다", () => {
    const map = makeMap();
    const area = computeSettlementArea(map, 0.5, 0, 0, 3);
    // (0,0) 반경 3: x,y ≥ 0 경계로 11셀만 포함
    expect(area.totalCells).toBe(11);
    expect(area.landCells).toBe(11);
  });

  it("육지가 없는 영역의 비옥도는 0이다 (분모 가드 §8.1)", () => {
    const map = makeMap();
    map.elevation.fill(0.2); // 전부 바다
    const area = computeSettlementArea(map, 0.5, 8, 8, 2);
    expect(area.landCells).toBe(0);
    expect(area.fertility).toBe(0);
  });
});
