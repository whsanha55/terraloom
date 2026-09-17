/**
 * Worker↔UI 메시지 프로토콜 (§9.5 / T1) — 단일 소스.
 *
 * 요청(UI → Worker): SimRequest / 통지(Worker → UI): SimNotification.
 * tickBatch는 UI 프레임 기준 초당 최대 10회로 배치 통합한다(스로틀은 Worker 측).
 * 지도 등 대용량 TypedArray는 transfer list로 제로카피 전달한다(T16).
 */
import type { RouteGen, SettlementGen } from "@/world/generation/settlements";
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
  paused: boolean;
  speed: SimSpeed;
}

export interface StateChange {
  settlementId: string;
  fields: string[];
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
    }
  | { type: "majorEvent"; eventId: string; paused: boolean } // Step 8+
  | { type: "statsUpdate"; series: { tick: number; totalPopulation: number }[] } // Step 6+
  | {
      type: "systemStatus";
      level: "info" | "warning" | "error";
      code: string;
      message: string;
    }
  | { type: "progress"; phase: string; percent: number };
