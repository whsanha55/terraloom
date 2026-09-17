import { describe, expect, it } from "vitest";
import { generateRivers } from "@/world/generation/rivers";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { createWorldMap } from "@/world/model/worldMap";

const SEA = 0.5;

describe("generateRivers (함몰 보정 priority flood + 유량 누적)", () => {
  it("경사 지형에서 물은 낮은 방향으로 흘러 바다에 도달한다", () => {
    // 6×6: 0열 바다, 육지는 오른쪽으로 갈수록 높음
    const map = createWorldMap(6, 6);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        map.elevation[y * 6 + x] = x === 0 ? 0.1 : 0.5 + x * 0.08;
      }
    }
    generateRivers(map, SEA);
    // 바다 셀(0열)은 각 행의 유량을 받는다 — 정규화 최댓값
    const maxVolume = Math.max(...Array.from(map.riverVolume));
    expect(maxVolume).toBeGreaterThan(0);
    for (let y = 0; y < 6; y++) {
      expect(map.riverVolume[y * 6]).toBeCloseTo(maxVolume);
    }
  });

  it("함몰 지형(피트)도 막힘 없이 배수된다 — 모든 육지 셀이 하류를 가진다", () => {
    // 테두리 바다, 중앙에 주변보다 낮은 함몰
    const map = createWorldMap(7, 7);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const border = x === 0 || y === 0 || x === 6 || y === 6;
        map.elevation[y * 7 + x] = border ? 0.1 : 0.8;
      }
    }
    map.elevation[3 * 7 + 3] = 0.55; // 함몰(주변 0.8보다 낮음)
    map.elevation[3 * 7 + 2] = 0.6; // 함몰로 이어지는 낮은 통로
    generateRivers(map, SEA);
    // 유량은 유한한 음이 아닌 값
    for (const v of map.riverVolume) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // 중앙 함몰 셀로 물이 모인다 — 주변보다 유량이 크다
    const pit = map.riverVolume[3 * 7 + 3];
    const corner = map.riverVolume[1 * 7 + 1];
    expect(pit).toBeGreaterThan(corner);
  });

  it("결정론적이다 — 같은 시드는 같은 강망을 만든다", () => {
    const a = generateWorld({ ...createDefaultWorldConfig("river-det"), resolution: 128 });
    const b = generateWorld({ ...createDefaultWorldConfig("river-det"), resolution: 128 });
    for (let i = 0; i < a.map.riverVolume.length; i++) {
      expect(Object.is(a.map.riverVolume[i], b.map.riverVolume[i])).toBe(true);
    }
  });
});
