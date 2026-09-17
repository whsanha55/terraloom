/**
 * 월드젠 품질 검증·재생성 규칙 (T5, Step 2).
 *
 * 퇴화 지도(육지 0%/99%)가 화면에 도달하지 않게 한다.
 * 허용 범위 밖이면 파생 시드로 재생성한다(최대 5회 — generator.ts).
 */
export const MIN_LAND_RATIO = 0.1;
export const MAX_LAND_RATIO = 0.7;

export function isLandRatioAcceptable(landRatio: number): boolean {
  return landRatio >= MIN_LAND_RATIO && landRatio <= MAX_LAND_RATIO;
}
