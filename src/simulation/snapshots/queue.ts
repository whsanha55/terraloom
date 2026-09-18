/**
 * Worker 내 저장 큐 (§28.4 / T6) — 틱 루프와 저장을 인터리브하지 않는다.
 *
 * 스냅샷 생성 요청은 enqueue 시점에 직렬화돼 큐에 쌓이고, 틱 사이 배치로
 * 비동기 flush된다 — "스냅샷 저장으로 장시간 정지가 발생하지 않음"(§34)의 메커니즘.
 * enqueue에서 직렬화하므로 라벨 틱과 저장 내용 틱이 항상 일치한다(live 참조 금지).
 * 저장 실패는 §28.5 정리→재시도로 회복하고, 못 이기면 오류 보고로 전환 —
 * 시뮬레이션은 계속된다(§22.1).
 */
import { serializeDynamicState, type SerializedDynamicState } from "../core/serialization";
import type { WorldState } from "../core/worldState";
import type { WorldStore } from "@/storage/worldStore";
import { SnapshotQuotaError } from "../errors";

export interface SnapshotRequest {
  worldId: string;
  tick: number;
  branchId: string;
  label: "auto" | "user" | "branch";
  state: WorldState;
}

/** 큐에 담기는 항목 — 이미 직렬화된 상태만 다닌다 */
interface QueuedSnapshot {
  worldId: string;
  tick: number;
  branchId: string;
  label: "auto" | "user" | "branch";
  data: SerializedDynamicState;
}

/** §28.2 — 분기별 자동 스냅숏 유지 개수 (최근 100년) */
const AUTO_SNAPSHOT_KEEP = 100;

export class SnapshotQueue {
  /** 저장 실패 보고 — Worker가 systemStatus 배너로 노출한다 */
  onError?: (message: string) => void;
  private readonly requests = new Map<string, QueuedSnapshot>(); // (branchId:tick) → 마지막 요청
  /** flush 순서 체인 — 진행 중 호출도 자기 요청 저장 완료 뒤에 resolve된다 */
  private flushChain: Promise<void> = Promise.resolve();

  constructor(private readonly store: WorldStore) {}

  static isYearBoundary(tick: number): boolean {
    return tick > 0 && tick % 12 === 0;
  }

  get pending(): number {
    return this.requests.size;
  }

  /** enqueue 시점에 동기 직렬화 — 이후 틱 진행과 무관하게 해당 틱 상태가 보존된다 */
  enqueue(request: SnapshotRequest): void {
    let data: SerializedDynamicState;
    try {
      data = serializeDynamicState(request.state);
    } catch {
      this.onError?.("스냅숏 직렬화 실패 — 해당 지점 저장을 건너뜁니다");
      return;
    }
    const key = `${request.branchId}:${request.tick}`;
    const existing = this.requests.get(key);
    // 같은 지점 중복 저장은 하나로 — 수동(user) 저장이 자동 저장을 대체한다
    if (!existing || (existing.label === "auto" && request.label !== "auto")) {
      this.requests.set(key, {
        worldId: request.worldId,
        tick: request.tick,
        branchId: request.branchId,
        label: request.label,
        data,
      });
    }
  }

  /**
   * 큐를 flush한다. 이미 flush가 진행 중이면 그 뒤에 체인되며, 호출자의 await는
   * 자신의 요청이 실제로 저장된 뒤에야 끝난다 (snapshotSaved 통지 경쟁 방지).
   */
  flushAll(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    const requests = [...this.requests.values()].sort((a, b) => a.tick - b.tick);
    this.requests.clear();
    for (const request of requests) {
      try {
        await this.putWithQuotaRecovery(request);
        if (request.label === "auto") {
          // §28.2/§28.5 — 자동 스냅숏은 최근 100개만 유지 (사용자 지정 보호)
          try {
            await this.store.pruneAutoSnapshots(
              request.worldId,
              request.branchId,
              AUTO_SNAPSHOT_KEEP,
            );
          } catch {
            // 정리 실패는 저장 성공을 해치지 않는다 — 다음 저장 때 재시도된다
          }
        }
      } catch (error) {
        this.onError?.(
          `스냅숏 저장 실패 — ${error instanceof Error ? error.message : "알 수 없음"} (시뮬레이션은 계속됩니다)`,
        );
      }
    }
  }

  /** §28.5 — 용량 초과(SnapshotQuotaError) 시 오래된 자동 스냅숏 정리 후 1회 재시도 */
  private async putWithQuotaRecovery(request: QueuedSnapshot): Promise<void> {
    const record = {
      id: `snap:${request.worldId}:${request.branchId}:${request.tick}`,
      worldId: request.worldId,
      tick: request.tick,
      branchId: request.branchId,
      label: request.label,
      createdAt: Date.now(),
      data: request.data,
    };
    try {
      await this.store.putSnapshot(record);
    } catch (error) {
      if (!(error instanceof SnapshotQuotaError)) throw error;
      await this.store.pruneAutoSnapshots(request.worldId, request.branchId, AUTO_SNAPSHOT_KEEP);
      await this.store.putSnapshot(record);
    }
  }
}
