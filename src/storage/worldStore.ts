/**
 * 세계 저장소 (§28.1 / T6) — IndexedDB 백엔드 + 테스트용 메모리 백엔드.
 *
 * 스키마: worlds(메타) · snapshots(동적 상태, 지도 미포함 §28.3) · branches(§29).
 * 백엔드 인터페이스를 주입해 Worker/테스트 양쪽에서 동작한다.
 * IndexedDB 오류는 §22.1 오류 분류로 매핑된다.
 */
import { SnapshotQuotaError } from "@/simulation/errors";
import type { SerializedDynamicState } from "@/simulation/core/serialization";

export interface KeyValueBackend {
  put(store: string, value: { id: string }): Promise<void>;
  get<T>(store: string, id: string): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  delete(store: string, id: string): Promise<void>;
}

/** 테스트·폴백용 인메모리 백엔드 */
export class MemoryBackend implements KeyValueBackend {
  private readonly data = new Map<string, Map<string, { id: string }>>();

  private store(name: string): Map<string, { id: string }> {
    let store = this.data.get(name);
    if (!store) {
      store = new Map();
      this.data.set(name, store);
    }
    return store;
  }

  async put(name: string, value: { id: string }): Promise<void> {
    this.store(name).set(value.id, { ...value });
  }

  async get<T>(name: string, id: string): Promise<T | undefined> {
    return this.store(name).get(id) as T | undefined;
  }

  async getAll<T>(name: string): Promise<T[]> {
    return [...this.store(name).values()] as T[];
  }

  async delete(name: string, id: string): Promise<void> {
    this.store(name).delete(id);
  }
}

const DB_NAME = "terraloom";
const DB_VERSION = 1;
const STORES = ["worlds", "snapshots", "branches"] as const;

/** 실제 IndexedDB 백엔드 — Worker 안에서도 동작한다 */
export class IndexedDbBackend implements KeyValueBackend {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open 실패"));
    });
  }

  private run<T>(mode: IDBTransactionMode, store: string, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    if (!this.db) return Promise.reject(new Error("IndexedDB가 열려 있지 않습니다"));
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, mode);
      const request = work(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청 실패"));
    });
  }

  async put(store: string, value: { id: string }): Promise<void> {
    try {
      await this.run("readwrite", store, (s) => s.put(value));
    } catch (error) {
      throw toQuotaError(error);
    }
  }

  async get<T>(store: string, id: string): Promise<T | undefined> {
    try {
      return (await this.run<T | undefined>("readonly", store, (s) => s.get(id) as IDBRequest<T | undefined>)) ?? undefined;
    } catch (error) {
      throw toQuotaError(error);
    }
  }

  async getAll<T>(store: string): Promise<T[]> {
    try {
      return (await this.run<T[]>("readonly", store, (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
    } catch (error) {
      throw toQuotaError(error);
    }
  }

  async delete(store: string, id: string): Promise<void> {
    try {
      await this.run("readwrite", store, (s) => s.delete(id));
    } catch (error) {
      throw toQuotaError(error);
    }
  }
}

function toQuotaError(error: unknown): unknown {
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") {
    return new SnapshotQuotaError("저장 공간이 부족합니다 — 오래된 자동 스냅샷을 정리합니다 (§28.5)");
  }
  return error;
}

export interface WorldMetaRecord {
  id: string;
  seed: string;
  name: string;
  createdAt: number;
  lastTick: number;
  simulationVersion: string;
  generatorVersion: string;
}

export interface SnapshotLike {
  id: string;
  worldId: string;
  tick: number;
  branchId: string;
  label: "auto" | "user" | "branch";
  createdAt: number;
  data: SerializedDynamicState;
}

export interface BranchRecord {
  id: string;
  worldId: string;
  parentBranchId: string;
  parentSnapshotId: string;
  name: string;
  createdAtTick: number;
}

export class WorldStore {
  constructor(private readonly backend: KeyValueBackend) {}

  async putWorld(meta: WorldMetaRecord): Promise<void> {
    await this.backend.put("worlds", meta);
  }

  async listWorlds(): Promise<WorldMetaRecord[]> {
    const worlds = await this.backend.getAll<WorldMetaRecord>("worlds");
    return worlds.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.backend.delete("worlds", id);
    for (const snapshot of await this.listSnapshots(id)) {
      await this.backend.delete("snapshots", snapshot.id);
    }
    for (const branch of await this.listBranches(id)) {
      await this.backend.delete("branches", branch.id);
    }
  }

  async putSnapshot(record: SnapshotLike): Promise<void> {
    await this.backend.put("snapshots", record);
  }

  async getSnapshot(id: string): Promise<SnapshotLike | undefined> {
    return this.backend.get<SnapshotLike>("snapshots", id);
  }

  async listSnapshots(worldId: string): Promise<SnapshotLike[]> {
    const snapshots = await this.backend.getAll<SnapshotLike>("snapshots");
    return snapshots.filter((s) => s.worldId === worldId).sort((a, b) => a.tick - b.tick);
  }

  /** §28.2 — 자동 스냅샷은 분기별 최근 keepYears개만 유지. 사용자 지정 보호 */
  async pruneAutoSnapshots(worldId: string, branchId: string, keepCount: number): Promise<void> {
    const snapshots = (await this.listSnapshots(worldId)).filter(
      (s) => s.branchId === branchId && s.label === "auto",
    );
    const removable = snapshots.slice(0, Math.max(0, snapshots.length - keepCount));
    for (const snapshot of removable) {
      await this.backend.delete("snapshots", snapshot.id);
    }
  }

  async putBranch(branch: BranchRecord): Promise<void> {
    await this.backend.put("branches", branch);
  }

  async listBranches(worldId: string): Promise<BranchRecord[]> {
    const branches = await this.backend.getAll<BranchRecord>("branches");
    return branches.filter((b) => b.worldId === worldId);
  }
}
