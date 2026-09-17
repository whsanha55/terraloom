/**
 * 시드 문자열 해시(FNV-1a 32비트)와 파생 시드(§7).
 *
 * randomSeed = hash(worldSeed, simulationVersion, currentTick,
 *                   systemName, entityId, randomPurpose)
 *
 * 각 필드는 NUL 구분자로 결합해 직렬화한다 — 필드 경계가 모호해지는
 * 단순 문자열 연결과 달리 위치 기반 충돌이 없다.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const FIELD_SEPARATOR = "\u0000";

/** FNV-1a 32비트. 공식 벡터: "" → 0x811c9dc5, "a" → 0xe40c292c */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export interface SeedParts {
  worldSeed: string;
  simulationVersion: string;
  systemName: string;
  /** 시뮬레이션 틱(월 단위). 월드젠 단계에서는 생략한다 */
  tick?: number;
  entityId?: string;
  /** 난수 용도(§7 randomPurpose) */
  purpose?: string;
}

/** 구조화된 입력에서 [0, 2^32) 파생 시드를 계산한다 */
export function deriveSeed(parts: SeedParts): number {
  const canonical = [
    parts.worldSeed,
    parts.simulationVersion,
    String(parts.tick ?? 0),
    parts.systemName,
    parts.entityId ?? "",
    parts.purpose ?? "",
  ].join(FIELD_SEPARATOR);
  return fnv1a32(canonical);
}
