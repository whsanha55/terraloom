/**
 * 분기 시뮬레이션 (§29) — 복원·분기 생성·비교.
 *
 * 분기는 특정 스냅샷에서 새로운 역사를 시작한다. 복원 상태는 스냅샷 데이터의
 * 깊은 복사로 만들어진다(원본 불변). LLM 정책(§23)은 재사용/새 생성/규칙만.
 */
import {
  deserializeDynamicState,
  type SerializedDynamicState,
} from "./serialization";
import type { WorldState } from "./worldState";
import type { SnapshotLike } from "@/storage/worldStore";

export type { SnapshotLike };

export type LLMPolicy = "reuse" | "fresh" | "off";

export interface BuildBranchOptions {
  snapshot: SerializedDynamicState;
  base: { config: WorldState["config"]; map: WorldState["map"] };
  branchId: string;
  llmPolicy: LLMPolicy;
}

/** 스냅숏에서 복원/분기 상태를 만든다 — 원본 데이터는 불변 */
export function buildBranchState(options: BuildBranchOptions): WorldState {
  const state = deserializeDynamicState(options.snapshot, options.base);
  state.branchId = options.branchId;
  if (options.llmPolicy === "off" || options.llmPolicy === "fresh") {
    // LLM 결과 재사용 안 함 — 기록과 템플릿을 비운다 (§23 분기 옵션)
    state.llmRecords = [];
    state.llmTemplates = [];
  }
  return state;
}

export interface BranchComparisonMetric {
  a: number;
  b: number;
  diff: number;
}

export interface BranchComparison {
  a: { branchId: string; tick: number };
  b: { branchId: string; tick: number };
  metrics: {
    totalPopulation: BranchComparisonMetric;
    totalFoodStock: BranchComparisonMetric;
    deaths: BranchComparisonMetric;
    migrationOut: BranchComparisonMetric;
    eventCount: BranchComparisonMetric;
    ruinedCities: BranchComparisonMetric;
  };
}

/** 두 스냅숏의 통계 비교 (§29 비교 항목) */
export function compareSnapshots(a: SnapshotLike, b: SnapshotLike): BranchComparison {
  const metric = (valueA: number, valueB: number): BranchComparisonMetric => ({
    a: valueA,
    b: valueB,
    diff: valueA - valueB,
  });
  const read = (snapshot: SnapshotLike) => {
    const data = snapshot.data;
    let population = 0;
    let food = 0;
    let ruined = 0;
    for (const settlement of Object.values(data.settlements)) {
      if (settlement.status === "active") {
        population += settlement.population;
        food += settlement.foodStock;
      } else {
        ruined += 1;
      }
    }
    const totals = data.changeLedger.entries;
    let deaths = 0;
    let migrationOut = 0;
    for (const entry of totals) {
      if (entry.cause === "starvation" || entry.cause === "disease" || entry.cause === "natural") {
        deaths += -entry.amount;
      } else if (entry.cause === "migration_out") {
        migrationOut += -entry.amount;
      }
    }
    return { population, food, ruined, deaths, migrationOut, events: data.eventHistory.length };
  };
  const ra = read(a);
  const rb = read(b);
  return {
    a: { branchId: a.branchId, tick: a.tick },
    b: { branchId: b.branchId, tick: b.tick },
    metrics: {
      totalPopulation: metric(ra.population, rb.population),
      totalFoodStock: metric(ra.food, rb.food),
      deaths: metric(ra.deaths, rb.deaths),
      migrationOut: metric(ra.migrationOut, rb.migrationOut),
      eventCount: metric(ra.events, rb.events),
      ruinedCities: metric(ra.ruined, rb.ruined),
    },
  };
}
