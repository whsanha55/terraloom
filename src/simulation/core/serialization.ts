/**
 * 동적 상태 직렬화 (§28.3 전신 — Step 8 완료 조건 "저장 후 재실행 결과가 동일").
 *
 * 지도 레이어는 시드로 재생성 가능하므로 제외하고 동적 상태만 직렬화한다.
 * 결과는 JSON 안전(구조적 복제·IndexedDB 저장 가능). Step 13의 스냅샷 저장이
 * 이 표준 위에 IndexedDB 저장소를 얹는다. 버전 정책은 §28.6를 따른다.
 */
import { SnapshotCorruptError } from "../errors";
import { ChangeLedger, type PopulationChangeEntry } from "../systems/ledger";
import { SIMULATION_VERSION } from "@/world/model/version";
import type { WorldState } from "./worldState";
import type { WorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";

export interface SerializedLedger {
  entries: PopulationChangeEntry[];
}

export interface SerializedDynamicState {
  simulationVersion: string;
  generatorVersion: string;
  seed: string;
  clock: {
    currentTick: number;
    year: number;
    month: number;
  };
  settlements: WorldState["settlements"];
  routes: WorldState["routes"];
  activeEvents: WorldState["activeEvents"];
  scheduledEvents: WorldState["scheduledEvents"];
  eventHistory: WorldState["eventHistory"];
  eventCooldowns: WorldState["eventCooldowns"];
  probabilityEvaluations: WorldState["probabilityEvaluations"];
  globalStatistics: WorldState["globalStatistics"];
  changeLedger: SerializedLedger;
}

export function serializeDynamicState(state: WorldState): SerializedDynamicState {
  return {
    simulationVersion: state.simulationVersion,
    generatorVersion: state.generatorVersion,
    seed: state.seed,
    clock: {
      currentTick: state.clock.currentTick,
      year: state.clock.year,
      month: state.clock.month,
    },
    settlements: structuredClone(state.settlements),
    routes: structuredClone(state.routes),
    activeEvents: structuredClone(state.activeEvents),
    scheduledEvents: structuredClone(state.scheduledEvents),
    eventHistory: structuredClone(state.eventHistory),
    eventCooldowns: structuredClone(state.eventCooldowns),
    probabilityEvaluations: structuredClone(state.probabilityEvaluations),
    globalStatistics: structuredClone(state.globalStatistics),
    changeLedger: { entries: [...state.changeLedger.all()] },
  };
}

export function deserializeDynamicState(
  data: SerializedDynamicState,
  base: { config: WorldConfig; map: WorldMap },
): WorldState {
  if (!data || typeof data !== "object") {
    throw new SnapshotCorruptError("스냅샷 데이터가 손상되었습니다");
  }
  if (data.simulationVersion !== SIMULATION_VERSION) {
    throw new SnapshotCorruptError(
      `버전이 달라 열 수 없음 — 스냅샷 ${data.simulationVersion}, 현재 ${SIMULATION_VERSION} (§28.6)`,
    );
  }
  const ledger = new ChangeLedger();
  for (const entry of data.changeLedger.entries) {
    ledger.record(entry);
  }
  return {
    id: `world:${data.seed}`,
    name: data.seed,
    seed: data.seed,
    generatorVersion: data.generatorVersion,
    simulationVersion: data.simulationVersion,
    clock: {
      currentTick: data.clock.currentTick,
      year: data.clock.year,
      month: data.clock.month,
      speed: 1,
      paused: true,
    },
    config: base.config,
    map: base.map,
    settlements: structuredClone(data.settlements),
    routes: structuredClone(data.routes),
    activeEvents: structuredClone(data.activeEvents),
    scheduledEvents: structuredClone(data.scheduledEvents),
    eventHistory: structuredClone(data.eventHistory),
    eventCooldowns: structuredClone(data.eventCooldowns),
    probabilityEvaluations: structuredClone(data.probabilityEvaluations),
    globalStatistics: structuredClone(data.globalStatistics),
    changeLedger: ledger,
  };
}
