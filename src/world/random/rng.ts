/**
 * 결정론적 PRNG (mulberry32).
 *
 * §7 결정론 원칙: Math.random()은 금지 — 모든 난수는 시드의 함수다.
 * §7.1 허용 연산만 사용: 기본 산술과 Math.imul / `>>> 0`로 강제한 32비트 정수 연산.
 */
const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296; // 2^32

export interface Rng {
  /** [0, 2^32) 부호 없는 정수 */
  nextUint32(): number;
  /** [0, 1) 실수 */
  next(): number;
  /** [minInclusive, maxExclusive) 정수 */
  nextInt(minInclusive: number, maxExclusive: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const next = (): number => nextUint32() / UINT32_RANGE;

  const nextInt = (minInclusive: number, maxExclusive: number): number => {
    const span = maxExclusive - minInclusive;
    if (!Number.isInteger(span) || span <= 0) {
      throw new RangeError(`nextInt: 빈 구간 [${minInclusive}, ${maxExclusive})`);
    }
    // 나머지 편향은 span ≪ 2^32라 무시 가능 (2의 거듭제곱 span은 편향 0)
    return minInclusive + (nextUint32() % span);
  };

  return { nextUint32, next, nextInt };
}
