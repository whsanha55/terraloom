import { describe, expect, it } from "vitest";
import { MAX_LAND_RATIO, MIN_LAND_RATIO, isLandRatioAcceptable } from "@/world/generation/validate";

describe("월드젠 품질 검증 (T5)", () => {
  it("허용 범위는 육지 10%~70%다", () => {
    expect(MIN_LAND_RATIO).toBe(0.1);
    expect(MAX_LAND_RATIO).toBe(0.7);
  });

  it("범위 내 비율은 허용한다", () => {
    expect(isLandRatioAcceptable(0.1)).toBe(true);
    expect(isLandRatioAcceptable(0.4)).toBe(true);
    expect(isLandRatioAcceptable(0.7)).toBe(true);
  });

  it("퇴화 비율은 거부한다", () => {
    expect(isLandRatioAcceptable(0.05)).toBe(false);
    expect(isLandRatioAcceptable(0.0)).toBe(false);
    expect(isLandRatioAcceptable(0.75)).toBe(false);
    expect(isLandRatioAcceptable(0.99)).toBe(false);
  });
});
