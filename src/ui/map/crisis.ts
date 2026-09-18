/**
 * 지도 위기 표시 판정 (§26 색 유형 / DESIGN.md 마커 규칙).
 *
 * 도시 마커 색 — 위험색(주황·빨강)은 위기 상태 전용:
 *   안정(파랑) = 식량 잔여 2개월 이상
 *   주의(주황) = 2개월 미만
 *   위험(빨강) = 1개월 미만
 * 사건 다이아몬드 색 — 중요도 기반 위험도색.
 */
export type CrisisLevel = "stable" | "warning" | "danger";

export const CRISIS_COLORS: Record<CrisisLevel, string> = {
  stable: "#2563EB", // blue-600 — 안정 상태
  warning: "#EA580C", // orange-600 — 주의 (위험 전용 색)
  danger: "#DC2626", // red-600 — 위험 (위험 전용 색)
};

export function crisisLevel(foodMonthsRemaining: number): CrisisLevel {
  if (foodMonthsRemaining < 1) return "danger";
  if (foodMonthsRemaining < 2) return "warning";
  return "stable";
}

/** 사건 다이아몬드 색 — 위험도색 (중요도 80+ 빨강, 50+ 주황, 그 외 중립) */
export function eventMarkerColor(importance: number): string {
  if (importance >= 80) return CRISIS_COLORS.danger;
  if (importance >= 50) return CRISIS_COLORS.warning;
  return "#64748B"; // slate-500 — 중립
}

/** 원인 라벨 (§8.3 PopulationChangeCause) */
export const CAUSE_LABELS: Record<string, string> = {
  birth: "출생",
  natural: "자연 사망",
  starvation: "기아",
  disease: "질병",
  migration_in: "유입",
  migration_out: "유출",
  event: "사건",
};
