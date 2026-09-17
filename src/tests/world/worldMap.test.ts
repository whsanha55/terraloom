import { describe, expect, it } from "vitest";
import { createWorldMap } from "@/world/model/worldMap";

describe("createWorldMap", () => {
  it("모든 레이어가 width×height 크기로 올바른 타입으로 할당된다", () => {
    const map = createWorldMap(64, 32);
    expect(map.width).toBe(64);
    expect(map.height).toBe(32);
    const size = 64 * 32;

    expect(map.elevation).toBeInstanceOf(Float32Array);
    expect(map.temperature).toBeInstanceOf(Float32Array);
    expect(map.moisture).toBeInstanceOf(Float32Array);
    expect(map.fertility).toBeInstanceOf(Float32Array);
    expect(map.biome).toBeInstanceOf(Uint8Array);
    expect(map.riverVolume).toBeInstanceOf(Float32Array);
    expect(map.regionId).toBeInstanceOf(Uint32Array);

    for (const layer of [
      map.elevation,
      map.temperature,
      map.moisture,
      map.fertility,
      map.biome,
      map.riverVolume,
      map.regionId,
    ]) {
      expect(layer.length).toBe(size);
    }
  });

  it("새 지도는 0으로 초기화된다", () => {
    const map = createWorldMap(8, 8);
    expect(map.elevation.every((v) => v === 0)).toBe(true);
    expect(map.biome.every((v) => v === 0)).toBe(true);
  });

  it("0 이하·비정수 크기는 거부한다", () => {
    expect(() => createWorldMap(0, 10)).toThrow(RangeError);
    expect(() => createWorldMap(10, -1)).toThrow(RangeError);
    expect(() => createWorldMap(10.5, 10)).toThrow(RangeError);
  });
});
