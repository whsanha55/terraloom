/**
 * 시뮬레이션 세계 상태 (§10) 및 초기화.
 *
 * SettlementState는 월드젠 결과를 시뮬레이션 입력으로 바꾼 것 —
 * 도시 영역 계약(§10.4) 집계치를 생성 시 1회 캐시해 매 틱 재계산을 피한다.
 * map은 시드로 재생성 가능하므로 해시·스냅샷 대상에서 제외된다(§7.2, §28.3).
 */
import type { RouteGen } from "@/world/generation/settlements";
import type { WorldGenResult } from "@/world/generation/generator";
import { SIMULATION_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";
import { computeSettlementArea } from "@/world/model/territory";
import { ChangeLedger } from "@/simulation/systems/ledger";
import type {
  ActiveWorldEvent,
  HistoricalEvent,
  ProbabilityEvaluation,
  ScheduledWorldEvent,
} from "@/simulation/events/types";
import type { LLMGenerationRecord } from "@/llm/records";
import type { SimSpeed } from "@/workers/protocol";

export interface SimulationClock {
  currentTick: number;
  year: number;
  month: number;
  speed: SimSpeed;
  paused: boolean;
}

export interface SettlementState {
  id: string;
  name: string;
  x: number;
  y: number;
  status: "active" | "ruined"; // §8.2 폐허 상태 머신
  population: number;
  carryingCapacity: number;
  foodProduction: number;
  foodConsumption: number;
  foodStock: number;
  foodPriceIndex: number;
  waterSupply: number;
  stability: number;
  diseaseLevel: number;
  migrationPressure: number;
  connectedSettlementIds: string[];
  activeEventIds: string[];
  /** 이번 달 미충족 비율(§9.4) — 인구 정산에서 소진된다 */
  unmetRatio: number;
  /** 식량 잔여 개월 = 재고/월 수요 (§12.1 이벤트 조건의 입력) */
  foodMonthsRemaining: number;
  /** 영역 계약 캐시(§10.4) — 월드젠 시 1회 계산 */
  areaFertility: number;
  areaRiverVolume: number;
  areaBiomeCounts: number[];
}

export interface GlobalStatistics {
  totalPopulation: number[];
  totalFoodStock: number[];
}

export interface WorldState {
  id: string;
  name: string;
  seed: string;
  generatorVersion: string;
  simulationVersion: string;
  /** 현재 분기 — 기본 "main", 분기 생성 시 교체 (§29) */
  branchId: string;
  clock: SimulationClock;
  config: WorldConfig;
  map: WorldMap;
  settlements: Record<string, SettlementState>;
  routes: Record<string, RouteGen>;
  activeEvents: ActiveWorldEvent[];
  scheduledEvents: ScheduledWorldEvent[];
  eventHistory: HistoricalEvent[];
  /** `${templateId}:${targetId}` → 쿨다운 해제 틱 */
  eventCooldowns: Record<string, number>;
  /** 발생한 사건의 확률 평가 기록(§13.1) — 근거 보존 */
  probabilityEvaluations: ProbabilityEvaluation[];
  /** 승인된 LLM 생성 기록(§23) — 재현성. BYOK 키는 절대 포함되지 않는다 */
  llmRecords: LLMGenerationRecord[];
  /** 등록된 LLM 템플릿 — 스냅숏·복원 대상(재호출 없이 재사용 §23) */
  llmTemplates: import("@/simulation/events/types").EventTemplate[];
  globalStatistics: GlobalStatistics;
  /** 인구 변화 원장(§8.3) — 스냅샷·상태 해시 포함 */
  changeLedger: ChangeLedger;
}

/** 초기 비축 — 시작 시 3개월분 식량으로 시작한다 */
export const INITIAL_FOOD_STOCK_MONTHS = 3;

export function initializeWorldState(gen: WorldGenResult): WorldState {
  const { map, config } = gen;
  const seaLevel = gen.seaLevel;

  const settlements: Record<string, SettlementState> = {};
  for (const settlement of gen.settlements) {
    const area = computeSettlementArea(
      map,
      seaLevel,
      settlement.x,
      settlement.y,
      config.cityRadius,
    );
    const carryingCapacity = Math.round(
      3000 + area.fertility * 45000 + (area.riverVolume > 0 ? 4000 : 0),
    );
    settlements[settlement.id] = {
      id: settlement.id,
      name: settlement.name,
      x: settlement.x,
      y: settlement.y,
      status: "active",
      population: Math.round(carryingCapacity * 0.5),
      carryingCapacity,
      foodProduction: 0,
      foodConsumption: 0,
      foodStock: Math.round(carryingCapacity * 0.5) * INITIAL_FOOD_STOCK_MONTHS,
      foodPriceIndex: 1,
      waterSupply: area.riverVolume,
      stability: 70,
      diseaseLevel: 0,
      migrationPressure: 0,
      connectedSettlementIds: [],
      activeEventIds: [],
      unmetRatio: 0,
      foodMonthsRemaining: INITIAL_FOOD_STOCK_MONTHS,
      areaFertility: area.fertility,
      areaRiverVolume: area.riverVolume,
      areaBiomeCounts: area.biomeCounts,
    };
  }

  const routes: Record<string, RouteGen> = {};
  for (const route of gen.routes) {
    routes[route.id] = route;
    settlements[route.settlementIds[0]]?.connectedSettlementIds.push(route.settlementIds[1]);
    settlements[route.settlementIds[1]]?.connectedSettlementIds.push(route.settlementIds[0]);
  }

  let totalPopulation = 0;
  let totalFoodStock = 0;
  for (const settlement of Object.values(settlements)) {
    totalPopulation += settlement.population;
    totalFoodStock += settlement.foodStock;
  }

  return {
    id: `world:${config.seed}`,
    name: config.seed,
    seed: config.seed,
    generatorVersion: gen.generatorVersion,
    simulationVersion: SIMULATION_VERSION,
    branchId: "main",
    clock: { currentTick: 0, year: 0, month: 0, speed: 1, paused: true },
    config,
    map,
    settlements,
    routes,
    activeEvents: [],
    scheduledEvents: [],
    eventHistory: [],
    eventCooldowns: {},
    probabilityEvaluations: [],
    llmRecords: [],
    llmTemplates: [],
    globalStatistics: { totalPopulation: [totalPopulation], totalFoodStock: [totalFoodStock] },
    changeLedger: new ChangeLedger(),
  };
}
