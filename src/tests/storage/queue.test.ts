import { describe, expect, it } from "vitest";
import { SnapshotQueue } from "@/simulation/snapshots/queue";
import { MemoryBackend, WorldStore } from "@/storage/worldStore";
import type { SerializedDynamicState } from "@/simulation/core/serialization";
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

/** put이 20ms 지연되는 백엔드 — flush 진행 중 재호차 레이스 재현 */
class SlowBackend extends MemoryBackend {
  override async put(store: string, value: { id: string }): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await super.put(store, value);
  }
}

/** 대상 스냅샷 1회만 용량 초과로 실패하는 백엔드 — §28.5 정리→재시도 재현 */
class QuotaOnceBackend extends MemoryBackend {
  private failed = false;
  override async put(store: string, value: { id: string }): Promise<void> {
    if (store === "snapshots" && value.id === "snap:w:main:1300" && !this.failed) {
      this.failed = true;
      throw Object.assign(new Error("할당량 초과"), { name: "QuotaExceededError" });
    }
    await super.put(store, value);
  }
}

async function seedAutoSnapshots(store: WorldStore, count: number): Promise<void> {
  const empty = {} as SerializedDynamicState;
  for (let i = 1; i <= count; i++) {
    await store.putSnapshot({
      id: `snap:w:main:${i * 12}`,
      worldId: "w",
      tick: i * 12,
      branchId: "main",
      label: "auto",
      createdAt: i,
      data: empty,
    });
  }
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

  it("스냅샷은 enqueue 시점의 상태로 저장된다 — 이후 틱 진행과 무관 (live 참조 금지)", async () => {
    const store = new WorldStore(new MemoryBackend());
    const queue = new SnapshotQueue(store);
    const gen = generateWorld({ ...createDefaultWorldConfig("q-live"), resolution: 128 });
    const engine = new SimulationEngine(initializeWorldState(gen));
    engine.applyTicks(12);
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "auto", state: engine.state });
    engine.applyTicks(12); // flush 전에 상태가 더 진행해도 틱 12 시점이 보존된다
    await queue.flushAll();
    await flushMicrotasks();
    const record = (await store.listSnapshots("w"))[0];
    expect(record?.tick).toBe(12);
    expect(record?.data.clock.currentTick).toBe(12); // 라벨 틱 === 내용 틱
  });

  it("flush 진행 중 새로 든 요청은 실제 저장 완료 뒤에야 resolve된다 (snapshotSaved 레이스)", async () => {
    const store = new WorldStore(new SlowBackend());
    const queue = new SnapshotQueue(store);
    const stateA = makeState("q-race-a", 12);
    const stateB = makeState("q-race-b", 24);
    queue.enqueue({ worldId: "w", tick: 12, branchId: "main", label: "auto", state: stateA });
    const first = queue.flushAll();
    await new Promise((resolve) => setTimeout(resolve, 5)); // 첫 flush가 put 대기 중
    queue.enqueue({ worldId: "w", tick: 24, branchId: "main", label: "user", state: stateB });
    const second = queue.flushAll();
    await second;
    // second resolve 시점에 틱 24 스냅샷이 이미 디스크에 있어야 한다
    const snapshots = await store.listSnapshots("w");
    expect(snapshots.map((s) => s.tick)).toContain(24);
    await first;
  });

  it("자동 스냅샷은 최근 100개만 유지된다 (§28.2/§28.5 — 사용자 지정 보호)", async () => {
    const store = new WorldStore(new MemoryBackend());
    await seedAutoSnapshots(store, 102);
    await store.putSnapshot({
      id: "snap:w:main:600",
      worldId: "w",
      tick: 600,
      branchId: "main",
      label: "user",
      createdAt: 0,
      data: {} as SerializedDynamicState,
    });
    const queue = new SnapshotQueue(store);
    const state = makeState("q-prune", 12);
    queue.enqueue({ worldId: "w", tick: 1236, branchId: "main", label: "auto", state });
    await queue.flushAll();
    await flushMicrotasks();
    const remaining = await store.listSnapshots("w");
    const autos = remaining.filter((s) => s.label === "auto");
    expect(autos.length).toBe(100); // 최근 100개
    expect(autos[autos.length - 1]?.tick).toBe(1236); // 방금 저장한 최신 유지
    expect(remaining.some((s) => s.label === "user")).toBe(true); // 사용자 지정 보호
  });

  it("용량 초과 시 정리 후 재시도한다 — 오류 보고 없이 회복 (§28.5)", async () => {
    const store = new WorldStore(new QuotaOnceBackend());
    await seedAutoSnapshots(store, 105);
    const queue = new SnapshotQueue(store);
    const errors: string[] = [];
    queue.onError = (message) => errors.push(message);
    const state = makeState("q-quota", 12);
    queue.enqueue({ worldId: "w", tick: 1300, branchId: "main", label: "user", state });
    await queue.flushAll();
    await flushMicrotasks();
    expect(errors).toEqual([]); // 정리 → 재시도로 회복
    const snapshots = await store.listSnapshots("w");
    expect(snapshots.some((s) => s.tick === 1300)).toBe(true);
    expect(snapshots.filter((s) => s.label === "auto").length).toBe(100); // 정리로 100개로 감소
  });
});
