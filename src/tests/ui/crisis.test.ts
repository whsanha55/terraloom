import { describe, expect, it } from "vitest";
import { crisisLevel, eventMarkerColor } from "@/ui/map/crisis";

describe("위기 표시 판정 (§26 색 유형 — 주황·빨강은 위험 전용)", () => {
  it("식량 잔여 2개월 이상은 안정(파랑)", () => {
    expect(crisisLevel(2)).toBe("stable");
    expect(crisisLevel(9)).toBe("stable");
  });

  it("2개월 미만은 주의(주황)", () => {
    expect(crisisLevel(1.99)).toBe("warning");
    expect(crisisLevel(1)).toBe("warning");
  });

  it("1개월 미만은 위험(빨강)", () => {
    expect(crisisLevel(0.99)).toBe("danger");
    expect(crisisLevel(0)).toBe("danger");
  });

  it("사건 마커는 중요도에 따른 위험도색만 쓴다", () => {
    expect(eventMarkerColor(80)).toBe("#DC2626");
    expect(eventMarkerColor(79)).toBe("#EA580C");
    expect(eventMarkerColor(50)).toBe("#EA580C");
    expect(eventMarkerColor(49)).toBe("#64748B");
  });
});
