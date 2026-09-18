import { describe, expect, it } from "vitest";
import { SnapshotQueue } from "@/simulation/snapshots/queue";
import { MemoryBackend, WorldStore } from "@/storage/worldStore";
import { serializeDynamicState } from "@/simulation/core/serialization";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState } from "@/simulation/core/worldState";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

function makeState(seed: string, ticks: number) {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  const engine = new SimulationEngine(initializeWorldState(gen));
  engine.applyTicks(ticks);
  return engine.state;
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SnapshotQueue — Worker 저장 큐 (§28.4)", () => {
  it("큐에 넣은 스냅샷은 비동기로 flush되고 저장된다", async () => {
    const store = new WorldStore(new MemoryBackend());
    const queue = new SnapshotQueue(store);
    const state = makeState("q-1", 12);
    queue.enqueue({
      worldId: "world:q-1",
      tick: 12,
      branchId: "main",
      label: "auto",
      state,
    });
    expect(queue.pending).toBe(1);
    await queue.flushAll();
    await flushMicrotasks();
    const snapshots = await store.listSnapshots("world:q-1");
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.tick).toBe(12);
    expect(queue.pending).toBe(0);
  });

  it("연도 경계(12틱마다) 자동 저장 판정", () => {
    expect(SnapshotQueue.isYearBoundary(12)).toBe(true);
    expect(SnapshotQueue.isYearBoundary(24)).toBe(true);
    expect(SnapshotQueue.isYearBoundary(11)).toBe(false);
    expect(SnapshotQueue.isYearBoundary(0)).toBe(false); // 초기 틱은 제외
  });

  it("저장 실패(용량 초과 매핑) 시 큐는 비우고 오류를 보고한다 — 시뮬레이션은 계속", async () => {
    const store = new WorldStore(new MemoryBackend());
    const queue = new SnapshotQueue(store);
    const state = makeState("q-2", 12);
    const errors: string[] = [];
    queue.onError = (message) => errors.push(message);
    // 백엔드를 고장내 해보기 — put이 거부되는 스토어로 교체
    (store as unknown as { backend: unknown }).backend = {
      put: () => Promise.reject(new Error("QuotaExceededError")),
      get: () => Promise.resolve(undefined),
      getAll: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    };
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "auto", state });
    await queue.flushAll();
    await flushMicrotasks();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("저장");
    expect(queue.pending).toBe(0);
  });

  it("같은 (분기,틱) 중복 저장은 하나로 합쳐진다", async () => {
    const store = new WorldStore(new MemoryBackend());
    const queue = new SnapshotQueue(store);
    const state = makeState("q-3", 12);
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "auto", state });
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "user", state });
    await queue.flushAll();
    await flushMicrotasks();
    const snapshots = await store.listSnapshots("w");
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.label).toBe("user"); // 수동 저장이 우선
  });

  it("스냅샷 데이터는 지도를 포함하지 않는다 (§28.3)", async () => {
    const store = new WorldStore(new MemoryBackend());
    const queue = new SnapshotQueue(store);
    const state = makeState("q-4", 12);
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "auto", state });
    await queue.flushAll();
    await flushMicrotasks();
    const record = (await store.listSnapshots("w"))[0];
    const data = record?.data as unknown as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data).not.toHaveProperty("map");
    expect(JSON.stringify(data)).not.toContain("Float32Array");
  });
});
