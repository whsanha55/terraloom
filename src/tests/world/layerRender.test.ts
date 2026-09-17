import { describe, expect, it } from "vitest";
import { Biome, BIOME_INFO } from "@/world/generation/biome";
import { renderBiomeRGBA, renderScalarRGBA } from "@/world/rendering/layerRender";

describe("renderBiomeRGBA", () => {
  it("범주형 팔레트로 RGBA 버퍼를 만든다", () => {
    const biome = new Uint8Array([Biome.Ocean, Biome.Forest]);
    const rgba = renderBiomeRGBA(biome, 2, 1);
    expect(rgba.length).toBe(8);
    expect(rgba[3]).toBe(255);
    expect(Array.from(rgba.slice(0, 3))).toEqual([...BIOME_INFO[Biome.Ocean].color]);
    expect(Array.from(rgba.slice(4, 7))).toEqual([...BIOME_INFO[Biome.Forest].color]);
  });

  it("결정론적이다", () => {
    const biome = new Uint8Array([Biome.Desert, Biome.Tundra]);
    const a = renderBiomeRGBA(biome, 2, 1);
    const b = renderBiomeRGBA(biome, 2, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("모든 바이옴 색은 서로 다르다 (범주 구분 가능)", () => {
    const colors = Object.values(BIOME_INFO).map((info) => info.color.join(","));
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("renderScalarRGBA (순차형 램프)", () => {
  it("낮은 값과 높은 값은 다른 색이고 알파는 255다", () => {
    const values = new Float32Array([0, 1]);
    const rgba = renderScalarRGBA(values, 2, 1);
    expect(rgba[3]).toBe(255);
    expect(Array.from(rgba.slice(0, 3))).not.toEqual(Array.from(rgba.slice(4, 7)));
  });

  it("결정론적이다", () => {
    const values = new Float32Array([0.1, 0.5, 0.9]);
    const a = renderScalarRGBA(values, 3, 1);
    const b = renderScalarRGBA(values, 3, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
