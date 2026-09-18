/**
 * 시뮬레이션 엔진 오류 분류 (§22.1 / T7).
 *
 * 한 템플릿·한 저장의 문제가 전체 시뮬레이션을 죽이지 않게 한다.
 * 각 오류는 대응하는 격리 동작과 함께 사용된다.
 */

/** 템플릿이 허용 목록 밖 메트릭을 참조 — 템플릿 비활성화 + 경고 */
export class UnknownMetricError extends Error {
  constructor(
    public readonly metric: string,
    public readonly templateId: string,
  ) {
    super(`알 수 없는 메트릭 ${metric} (템플릿 ${templateId})`);
    this.name = "UnknownMetricError";
  }
}

/** 템플릿 스키마·범위 위반 — 등록 거부 (내장/LLM 공통) */
export class InvalidTemplateError extends Error {
  constructor(
    public readonly templateId: string,
    public readonly reason: string,
  ) {
    super(`유효하지 않은 이벤트 템플릿 ${templateId}: ${reason}`);
    this.name = "InvalidTemplateError";
  }
}

/** 스냅샷 손상·버전 불일치 — 로드 거부 (§28.6) */
export class SnapshotCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotCorruptError";
  }
}

/** 스냅샷 용량 초과 — 정리 후 재시도 (§28.5) */
export class SnapshotQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotQuotaError";
  }
}
