/**
 * 세계 생성 설정(§10 WorldConfig).
 *
 * resolution: 지도 한 변의 셀 수. 설계 파라미터는 512, 첫 세션 검증은 256(§34).
 * cityRadius: 도시 영역 계약(§10.4)의 반경 R. 기본 3.
 */
export interface WorldConfig {
  seed: string;
  resolution: number;
  cityRadius: number;
}

const DEFAULT_RESOLUTION = 512;
const DEFAULT_CITY_RADIUS = 3;

export function createDefaultWorldConfig(seed: string): WorldConfig {
  return { seed, resolution: DEFAULT_RESOLUTION, cityRadius: DEFAULT_CITY_RADIUS };
}

/** 구성 오류 목록을 반환한다. 빈 배열이면 유효하다 */
export function validateWorldConfig(config: WorldConfig): string[] {
  const errors: string[] = [];
  if (typeof config.seed !== "string" || config.seed.length === 0) {
    errors.push("seed는 빈 문자열이 아닌 문자열이어야 합니다");
  }
  if (!Number.isInteger(config.resolution) || config.resolution <= 0) {
    errors.push("resolution은 양의 정수여야 합니다");
  }
  if (!Number.isInteger(config.cityRadius) || config.cityRadius < 1) {
    errors.push("cityRadius는 1 이상의 정수여야 합니다");
  }
  return errors;
}
