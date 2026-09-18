/**
 * 조건 평가기 (§12.1) — 순수 함수.
 * 값은 resolveMetric으로 이미 산출된 상태에서 비교만 담당한다.
 */
import type { EventCondition } from "./types";

export function evaluateCondition(condition: EventCondition, value: number): boolean {
  if (!Number.isFinite(value)) return false; // §8.1 — NaN/Infinity는 거짓 취급
  const threshold = condition.value as number;
  switch (condition.operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "between": {
      const [minimum, maximum] = condition.value as [number, number];
      return value >= minimum && value <= maximum;
    }
    default:
      return false;
  }
}
