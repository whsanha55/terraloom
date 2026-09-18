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
import type { EventTemplate } from "@/simulation/events/types";
import type { LLMInput } from "@/llm/gateway/summary";
import type { ChainContextInput, ChainScheduledSpec } from "@/llm/gateway/chain";
import type { BranchComparison, LLMPolicy } from "@/simulation/core/branch";
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
  | { type: "snapshot"; label?: "user" } // Step 13 — 수동 저장
  | { type: "listSnapshots" } // Step 13
  | { type: "restoreSnapshot"; snapshotId: string; llmPolicy: LLMPolicy; asBranch: boolean; name?: string } // Step 13
  | { type: "compareSnapshots"; snapshotAId: string; snapshotBId: string } // Step 13
  | { type: "listBranches" } // Step 13
  | { type: "listEventTemplates" } // Step 14 — 개입(사건 직접 발생) 대상 템플릿 목록
  | { type: "requestLLM"; mode?: "chain"; eventId?: string } // Step 11 세계 추천 / Step 12 연쇄 추천
  | {
      type: "registerLLMTemplate"; // Step 11 — 사용자가 승인한 후보 등록
      template: EventTemplate;
      inputHash: string;
      rawOutput: string;
      provider: string;
      model: string;
      promptVersion: string;
    }
  | {
      type: "registerChainTemplate"; // Step 12 — 연쇄 후보 등록 (자동 승인 포함)
      template: EventTemplate;
      scheduled: ChainScheduledSpec;
      inputHash: string;
      rawOutput: string;
      provider: string;
      model: string;
      promptVersion: string;
      approvedBy: "user" | "automatic";
      usage?: { promptTokens: number; outputTokens: number; estimatedCost?: number };
    };

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
  /** 개입 예산 (§24 — 제한된 자원) */
  interventionPoints: number;
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
  /** 활성 사건 (§14.1 도시별 최대 3) — 지도 다이아몬드·도시 상세·재난 대응 비용 미리보기용 */
  activeEvents: Array<{ id: string; name: string; importance: number; category: string }>;
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
      type: "llmRequest"; // Step 11 — 요약·입력 해시·등록된 이름 목록 전달
      input: LLMInput;
      inputHash: string;
      registeredNames: string[];
      tick: number;
      chain?: {
        context: ChainContextInput;
        contextHash: string; // Step 12 — 연쇄 문맥과 해시
      };
    }
  | {
      type: "llmRegistered"; // 승인 등록 결과
      ok: boolean;
      templateId?: string;
      reason?: string;
    }
  | { type: "snapshotSaved"; snapshotId: string; tick: number; branchId: string } // Step 13
  | {
      type: "interventionResult"; // Step 14 — 개입 적용 결과 (§27.6 확인 문구)
      ok: boolean;
      description: string;
      reason?: string;
      cost: number;
      remainingPoints: number;
    }
  | {
      type: "snapshotList";
      snapshots: Array<{ id: string; tick: number; branchId: string; label: string }>;
    }
  | { type: "worldRestored"; branchId: string; tick: number } // Step 13 — 복원/분기 전환
  | { type: "branchComparison"; comparison: BranchComparison }
  | {
      type: "branchList";
      branches: Array<{ id: string; name: string; parentBranchId: string; createdAtTick: number }>;
    }
  | {
      type: "systemStatus";
      level: "info" | "warning" | "error";
      code: string;
      message: string;
    }
  | { type: "eventTemplateList"; templates: Array<{ id: string; name: string }> } // Step 14
  | { type: "progress"; phase: string; percent: number };
