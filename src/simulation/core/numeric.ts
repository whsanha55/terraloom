/**
 * 수치 안전 유틸 (§8.1 / T8).
 *
 * NaN/±Infinity는 결정론 테스트를 통과하는 침묵 오염이다.
 * 모든 시뮬레이션 공식의 나눗셈·범위 처리는 이 유틸을 통과한다.
 */

export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) {
    throw new RangeError(`clamp: 최솟값(${minimum})이 최댓값(${maximum})보다 큽니다`);
  }
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

/** 분모가 0이면 fallback을 반환한다 (분모 0 사전 검사, §8.1) */
export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return fallback;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}
