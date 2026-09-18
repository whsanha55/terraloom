/**
 * Worker 내 저장 큐 (§28.4 / T6) — 틱 루프와 저장을 인터리브하지 않는다.
 *
 * 스냅샷 생성 요청은 큐에 쌓이고, 틱 사이 배치로 비동기 flush된다 —
 * "스냅샷 저장으로 장시간 정지가 발생하지 않음"(§34)의 메커니즘.
 * 저장 실패는 큐를 비우고 오류 보고로 전환 — 시뮬레이션은 계속된다(§22.1).
 */
import { serializeDynamicState, type SerializedDynamicState } from "../core/serialization";
import type { WorldState } from "../core/worldState";
import type { WorldStore } from "@/storage/worldStore";

export interface SnapshotRequest {
  worldId: string;
  tick: number;
  branchId: string;
  label: "auto" | "user" | "branch";
  state: WorldState;
}

export class SnapshotQueue {
  /** 저장 실패 보고 — Worker가 systemStatus 배너로 노출한다 */
  onError?: (message: string) => void;
  private readonly requests = new Map<string, SnapshotRequest>(); // (branchId:tick) → 마지막 요청
  private flushing = false;

  constructor(private readonly store: WorldStore) {}

  static isYearBoundary(tick: number): boolean {
    return tick > 0 && tick % 12 === 0;
  }

  get pending(): number {
    return this.requests.size;
  }

  enqueue(request: SnapshotRequest): void {
    const key = `${request.branchId}:${request.tick}`;
    const existing = this.requests.get(key);
    // 같은 지점 중복 저장은 하나로 — 수동(user) 저장이 자동 저장을 대체한다
    if (!existing || (existing.label === "auto" && request.label !== "auto")) {
      this.requests.set(key, request);
    }
  }

  /** 틱 사이 배치 flush — 비동기, 결과는 onError로만 보고 */
  async flushAll(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const requests = [...this.requests.values()].sort((a, b) => a.tick - b.tick);
      this.requests.clear();
      for (const request of requests) {
        try {
          let data: SerializedDynamicState;
          try {
            data = serializeDynamicState(request.state);
          } catch {
            this.onError?.("스냅샷 직렬화 실패 — 해당 지점 저장을 건너뜁니다");
            continue;
          }
          await this.store.putSnapshot({
            id: `snap:${request.worldId}:${request.branchId}:${request.tick}`,
            worldId: request.worldId,
            tick: request.tick,
            branchId: request.branchId,
            label: request.label,
            createdAt: Date.now(),
            data,
          });
        } catch (error) {
          this.onError?.(
            `스냅샷 저장 실패 — ${error instanceof Error ? error.message : "알 수 없음"} (시뮬레이션은 계속됩니다)`,
          );
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
