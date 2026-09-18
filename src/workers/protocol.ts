/**
 * Worker↔UI 메시지 프로토콜 (§9.5 / T1) — 단일 소스.
 *
 * 요청(UI → Worker): SimRequest / 통지(Worker → UI): SimNotification.
 * tickBatch는 UI 프레임 기준 초당 최대 10회로 배치 통합한다(스로틀은 Worker 측).
 * 지도 등 대용량 TypedArray는 transfer list로 제로카피 전달한다(T16).
 */
import type { RouteGen, SettlementGen } from "@/world/generation/settlements";
import type { EventNotice } from "@/simulation/events/engine";
import type { EventDetailData } from "@/simulation/events/detail";
import type { WorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";

export type SimSpeed = 0 | 1 | 10 | 100 | "MAX";

export interface UserIntervention {
  id: string;
  tick: number;
  type: string;
  targetIds: string[];
  parameters: Record<string, number | string | boolean>;
}

export type SimRequest =
  | { type: "init"; config: WorldConfig; seaLevel?: number }
  | { type: "setSpeed"; speed: SimSpeed }
  | { type: "step"; ticks: 1 | 12 }
  | { type: "eventDetail"; eventId: string } // Step 10 — 사건 상세 요청
  | { type: "cityDetail"; settlementId: string } // Step 10 — 도시 상세(원인 분해) 요청
  | { type: "setMajorThreshold"; threshold: number } // Step 10 — 자동 정지 임계(§25)
  | { type: "intervene"; intervention: UserIntervention } // Step 14
  | { type: "snapshot" } // Step 13
  | { type: "load"; snapshotId: string } // Step 13
  | { type: "requestLLM" }; // Step 11

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface WorldSummary {
  tick: number;
  /** 0-based — 표시 시 +1 */
  year: number;
  month: number;
  season: Season;
  totalPopulation: number;
  totalFoodStock: number;
  /** 직전 틱 이주 총인원 */
  migrationTotal: number;
  paused: boolean;
  speed: SimSpeed;
}

export interface StateChange {
  settlementId: string;
  fields: string[];
}

/** 도시 라이브 스냅숏 — 지도 마커·상세 표시용 */
export interface SettlementSnapshot {
  id: string;
  population: number;
  status: "active" | "ruined";
  foodStock: number;
  foodMonthsRemaining: number;
  stability: number;
  migrationPressure: number;
  diseaseLevel: number;
  /** 활성 사건 (§14.1 도시별 최대 3) — 지도 다이아몬드·도시 상세용 */
  activeEvents: Array<{ id: string; name: string; importance: number }>;
}

/** 도시 상세 — 원장 기반 인구 변화 원인 분해(§2.1) 포함 */
export interface CityDetail {
  settlementId: string;
  name: string;
  status: "active" | "ruined";
  population: number;
  carryingCapacity: number;
  foodStock: number;
  foodMonthsRemaining: number;
  stability: number;
  diseaseLevel: number;
  /** 최근 5년(60틱) 원인별 증감 — §8.3 원장 집계 */
  causeBreakdown: Array<{ cause: string; amount: number }>;
  breakdownFromTick: number;
  currentTick: number;
  activeEvents: Array<{ id: string; name: string; importance: number; startedTick: number }>;
}

/** 직전 틱의 이주 흐름 — 지도 화살표 시각화(§25) */
export interface MigrationFlow {
  fromId: string;
  toId: string;
  amount: number;
}

export interface StatsPoint {
  tick: number;
  totalPopulation: number;
  totalFoodStock: number;
}

export interface WorldReadyPayload {
  /** 버퍼는 transfer되어 UI 소유가 된다(T16) */
  map: WorldMap;
  settlements: SettlementGen[];
  routes: RouteGen[];
  seaLevel: number;
  attempts: number;
  landRatio: number;
  seaLevelCompensated: boolean;
  generatorVersion: string;
}

export type SimNotification =
  | { type: "worldReady"; world: WorldReadyPayload }
  | {
      type: "tickBatch";
      fromTick: number;
      toTick: number;
      summary: WorldSummary;
      changes: StateChange[];
      settlements: SettlementSnapshot[];
      migrations: MigrationFlow[];
      /** 이 배치 구간에 발생·기록된 사건 (Step 8) */
      events: EventNotice[];
    }
  | { type: "majorEvent"; notice: EventNotice; paused: boolean } // Step 8 — 중요 사건 자동 정지
  | { type: "statsUpdate"; series: StatsPoint[] } // 마지막 통지 이후 증분
  | { type: "eventDetailResult"; detail: EventDetailData | null } // Step 10
  | { type: "cityDetailResult"; detail: CityDetail | null } // Step 10
  | {
      type: "systemStatus";
      level: "info" | "warning" | "error";
      code: string;
      message: string;
    }
  | { type: "progress"; phase: string; percent: number };
