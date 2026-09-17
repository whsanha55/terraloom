import { describe, expect, it } from "vitest";
import { assertInBounds, cellCoords, cellIndex, isInBounds } from "@/world/model/coordinates";

describe("좌표 ↔ 인덱스 변환", () => {
  it("왕복 변환이 원본을 보존한다", () => {
    const width = 37; // 2의 거듭제곱이 아닌 폭에서도 검증
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < width; x++) {
        const index = cellIndex(x, y, width);
        expect(cellCoords(index, width)).toEqual({ x, y });
      }
    }
  });

  it("cellIndex는 row-major 순서다", () => {
    expect(cellIndex(0, 0, 10)).toBe(0);
    expect(cellIndex(9, 0, 10)).toBe(9);
    expect(cellIndex(0, 1, 10)).toBe(10);
    expect(cellIndex(4, 2, 10)).toBe(24);
  });

  it("isInBounds 경계 판정", () => {
    expect(isInBounds(0, 0, 4, 4)).toBe(true);
    expect(isInBounds(3, 3, 4, 4)).toBe(true);
    expect(isInBounds(4, 0, 4, 4)).toBe(false);
    expect(isInBounds(0, 4, 4, 4)).toBe(false);
    expect(isInBounds(-1, 0, 4, 4)).toBe(false);
    expect(isInBounds(0.5, 0, 4, 4)).toBe(false);
  });

  it("assertInBounds는 범위 밖에서 RangeError를 던진다", () => {
    expect(() => assertInBounds(4, 0, 4, 4)).toThrow(RangeError);
    expect(() => assertInBounds(3, 3, 4, 4)).not.toThrow();
  });
});
