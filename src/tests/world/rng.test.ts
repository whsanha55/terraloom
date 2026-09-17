import { describe, expect, it } from "vitest";
import { createRng } from "@/world/random/rng";

describe("createRng (mulberry32)", () => {
  it("같은 시드는 같은 난수열을 만든다", () => {
    const a = createRng(0x9e3779b9);
    const b = createRng(0x9e3779b9);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("다른 시드는 다른 난수열을 만든다", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("새 인스턴스는 같은 시드에서 같은 열을 반복한다 (새로고침 동등성)", () => {
    const r1 = createRng(77);
    const r2 = createRng(77);
    const seq1 = [r1.next(), r1.next(), r1.next()];
    const seq2 = [r2.next(), r2.next(), r2.next()];
    expect(seq1).toEqual(seq2);
  });

  it("next()는 [0, 1) 범위의 유한수다", () => {
    const rng = createRng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("nextUint32()는 부호 없는 32비트 정수다", () => {
    const rng = createRng(0);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextUint32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("nextInt(min, max)는 [min, max) 정수를 반환한다", () => {
    const rng = createRng(1234);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextInt(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
    }
  });

  it("nextInt는 빈 구간을 거부한다", () => {
    const rng = createRng(5);
    expect(() => rng.nextInt(5, 5)).toThrow(RangeError);
  });

  it("경계 시드(0, 0xffffffff)에서도 정상 동작한다", () => {
    for (const seed of [0, 0xffffffff]) {
      const rng = createRng(seed);
      expect(Number.isFinite(rng.next())).toBe(true);
    }
  });
});
