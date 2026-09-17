import { describe, expect, it } from "vitest";
import { createDefaultWorldConfig, validateWorldConfig } from "@/world/model/worldConfig";

describe("WorldConfig", () => {
  it("기본값은 resolution 512(§34), cityRadius 3(§10.4)다", () => {
    const config = createDefaultWorldConfig("seed-1");
    expect(config.seed).toBe("seed-1");
    expect(config.resolution).toBe(512);
    expect(config.cityRadius).toBe(3);
  });

  it("유효한 설정은 오류를 보고하지 않는다", () => {
    expect(validateWorldConfig(createDefaultWorldConfig("x"))).toEqual([]);
  });

  it("빈 시드·잘못된 수치를 보고한다", () => {
    expect(validateWorldConfig({ seed: "", resolution: 512, cityRadius: 3 })).not.toEqual([]);
    expect(validateWorldConfig({ seed: "x", resolution: 0, cityRadius: 3 })).not.toEqual([]);
    expect(validateWorldConfig({ seed: "x", resolution: 256.5, cityRadius: 3 })).not.toEqual([]);
    expect(validateWorldConfig({ seed: "x", resolution: 256, cityRadius: 0 })).not.toEqual([]);
  });
});
