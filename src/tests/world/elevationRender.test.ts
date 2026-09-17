import { describe, expect, it } from "vitest";
import { renderElevationRGBA } from "@/world/rendering/elevationRender";

describe("renderElevationRGBA", () => {
  it("RGBA 버퍼 크기는 width×height×4이고 알파는 255다", () => {
    const field = new Float32Array([0.2, 0.7]);
    const rgba = renderElevationRGBA(field, 2, 1, 0.5);
    expect(rgba.length).toBe(8);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(255);
  });

  it("결정론적이다", () => {
    const field = new Float32Array([0.1, 0.4, 0.6, 0.9]);
    const a = renderElevationRGBA(field, 2, 2, 0.5);
    const b = renderElevationRGBA(field, 2, 2, 0.5);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("바다와 육지 픽셀은 다른 색이다", () => {
    const field = new Float32Array([0.0, 0.99]);
    const rgba = renderElevationRGBA(field, 2, 1, 0.5);
    const sea = rgba.slice(0, 3);
    const land = rgba.slice(4, 7);
    expect(Array.from(sea)).not.toEqual(Array.from(land));
  });

  it("높은 육지가 낮은 육지보다 밝다 (그레이스케일 단조성)", () => {
    const field = new Float32Array([0.6, 0.95]);
    const rgba = renderElevationRGBA(field, 2, 1, 0.5);
    const low = rgba[0] + rgba[1] + rgba[2];
    const high = rgba[4] + rgba[5] + rgba[6];
    expect(high).toBeGreaterThan(low);
  });

  it("배열 크기 불일치는 거부한다", () => {
    expect(() => renderElevationRGBA(new Float32Array(3), 2, 2, 0.5)).toThrow(RangeError);
  });
});
