import { describe, expect, it } from "vitest";
import { MemoryBackend, WorldStore } from "@/storage/worldStore";
import { serializeDynamicState } from "@/simulation/core/serialization";
import { SimulationEngine } from "@/simulation/core/engine";
import { initializeWorldState } from "@/simulation/core/worldState";
import { generateWorld } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

function makeSnapshotData(seed: string, ticks: number) {
  const gen = generateWorld({ ...createDefaultWorldConfig(seed), resolution: 128 });
  const engine = new SimulationEngine(initializeWorldState(gen));
  engine.applyTicks(ticks);
  return serializeDynamicState(engine.state);
}

describe("WorldStore — IndexedDB 저장소 (§28.1, 백엔드 주입)", () => {
  it("세계 메타를 저장·조회한다", async () => {
    const store = new WorldStore(new MemoryBackend());
    await store.putWorld({
      id: "world:test",
      seed: "test",
      name: "test",
      createdAt: 1,
      lastTick: 12,
      simulationVersion: "0.1.0",
      generatorVersion: "g1",
    });
    const worlds = await store.listWorlds();
    expect(worlds.length).toBe(1);
    expect(worlds[0]?.seed).toBe("test");
  });

  it("스냅샷을 저장하고 틱 순서로 조회한다", async () => {
    const store = new WorldStore(new MemoryBackend());
    const data = makeSnapshotData("store-a", 12);
    for (const tick of [24, 0, 12]) {
      await store.putSnapshot({
        id: `snap:world:store-a:main:${tick}`,
        worldId: "world:store-a",
        tick,
        branchId: "main",
        label: "auto",
        createdAt: tick,
        data,
      });
    }
    const snapshots = await store.listSnapshots("world:store-a");
    expect(snapshots.map((s) => s.tick)).toEqual([0, 12, 24]);
  });

  it("자동 스냅샷 정리는 최근 N개만 남기고 사용자 지정은 보호한다 (§28.2/§28.5)", async () => {
    const store = new WorldStore(new MemoryBackend());
    const data = makeSnapshotData("store-b", 0);
    for (let tick = 0; tick <= 48; tick += 12) {
      await store.putSnapshot({
        id: `snap:w:main:${tick}`,
        worldId: "w",
        tick,
        branchId: "main",
        label: "auto",
        createdAt: tick,
        data,
      });
    }
    await store.putSnapshot({
      id: "snap:w:main:user:0",
      worldId: "w",
      tick: 0,
      branchId: "main",
      label: "user",
      createdAt: 0,
      data,
    });
    await store.pruneAutoSnapshots("w", "main", 2); // 최근 2개(연간) 유지
    const remaining = await store.listSnapshots("w");
    const auto = remaining.filter((s) => s.label === "auto").map((s) => s.tick);
    expect(auto).toEqual([36, 48]); // 최근 2개
    expect(remaining.some((s) => s.label === "user")).toBe(true); // 사용자 지정 보호
  });

  it("분기 메타를 저장·조회한다 (§29)", async () => {
    const store = new WorldStore(new MemoryBackend());
    await store.putBranch({
      id: "branch:1",
      worldId: "w",
      parentBranchId: "main",
      parentSnapshotId: "snap:w:main:12",
      name: "식량 지원 분기",
      createdAtTick: 12,
    });
    const branches = await store.listBranches("w");
    expect(branches.length).toBe(1);
    expect(branches[0]?.name).toBe("식량 지원 분기");
  });

  it("스냅샷 데이터는 KB 단위다 — 지도 미포함 (§28.3)", async () => {
    const data = makeSnapshotData("store-size", 36);
    const json = JSON.stringify(data);
    // 도시 18개 수준에서 수십 KB 이하 — 6.3MB 지도와는 차원이 다름
    expect(json.length).toBeLessThan(512 * 1024);
  });
});
