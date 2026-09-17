/**
 * tickBatch 배치 통합(§9.5 쓰로틀) — 순수 로직, 시간은 주입받는다.
 *
 * 목표: UI로의 통지를 초당 최대 10회(최소 간격 100ms)로 제한하고,
 * 그 사이의 틱들을 fromTick~toTick 배치 하나로 합친다.
 * 첫 틱은 즉시 배출해 조작 직후 반응성을 보장한다.
 */
export interface TickBatchRange {
  fromTick: number;
  toTick: number;
}

export class TickBatcher {
  private pendingFrom: number | null = null;
  private pendingTo = 0;
  private lastFlushAt = -Infinity;

  constructor(private readonly minIntervalMs = 100) {}

  /** 틱 실행 후 호출 — 플러시 조건이면 배치를 반환, 아니면 null */
  onTick(tick: number, nowMs: number): TickBatchRange | null {
    if (this.pendingFrom === null) {
      this.pendingFrom = tick;
    }
    this.pendingTo = tick;
    return this.tryFlush(nowMs);
  }

  tryFlush(nowMs: number): TickBatchRange | null {
    if (this.pendingFrom === null) return null;
    if (nowMs - this.lastFlushAt < this.minIntervalMs) return null;
    return this.flush(nowMs);
  }

  /** 보류 중 배치를 조건 없이 즉시 배출 (단계 진행·일시정지 피드백용) */
  flush(nowMs: number): TickBatchRange | null {
    if (this.pendingFrom === null) return null;
    const batch = { fromTick: this.pendingFrom, toTick: this.pendingTo };
    this.pendingFrom = null;
    this.lastFlushAt = nowMs;
    return batch;
  }
}
