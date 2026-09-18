/**
 * 세계 상태 요약기 (§18) — LLM에 전달하는 데이터의 전부다.
 *
 * 전체 WorldState를 보내지 않는다: 도시별 핵심 지표 + 최근 역사 + 활성 주요 사건 +
 * 허용 메트릭 목록만. 시드·버전·원장 전체는 프롬프트에 절대 포함되지 않는다.
 * 입력 해시는 늦은 응답 폐기 판정(§23)의 기준이 된다.
 */
import type { WorldState } from "@/simulation/core/worldState";
import { fnv1a32 } from "@/world/random/seed";
import { EVENT_EDITABLE_METRICS } from "@/simulation/events/metrics";

export interface LLMSettlementSummary {
  id: string;
  population: number;
  foodMonthsRemaining: number;
  stability: number;
  migrationPressure: number;
}

export interface LLMInput {
  world: {
    year: number;
    season: "spring" | "summer" | "autumn" | "winter";
    globalPopulation: number;
    activeMajorEvents: string[];
  };
  settlements: LLMSettlementSummary[];
  recentHistory: Array<{ type: string; tick: number }>;
  allowedMetrics: string[];
}

const SEASONS = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"] as const;

export function summarizeForLLM(state: WorldState): LLMInput {
  const active = Object.values(state.settlements).filter((s) => s.status === "active");
  let globalPopulation = 0;
  const settlements: LLMSettlementSummary[] = [];
  for (const settlement of active) {
    globalPopulation += settlement.population;
    settlements.push({
      id: settlement.id,
      population: settlement.population,
      foodMonthsRemaining: Number(settlement.foodMonthsRemaining.toFixed(2)),
      stability: Math.round(settlement.stability),
      migrationPressure: Number(settlement.migrationPressure.toFixed(2)),
    });
  }
  // 위기 순 정렬 — 응답 크기 상한: 도시 10개 (§18 요약 원칙)
  settlements.sort(
    (a, b) => a.foodMonthsRemaining - b.foodMonthsRemaining || a.stability - b.stability,
  );

  const recentHistory = state.eventHistory
    .slice(-8)
    .reverse()
    .map((event) => ({ type: `${event.templateId}_occurred`, tick: event.startedTick }));

  const activeMajorEvents = [...state.activeEvents]
    .filter((e) => e.importance >= 50)
    .map((e) => e.templateId);

  return {
    world: {
      year: state.clock.year,
      season: SEASONS[state.clock.month] ?? "spring",
      globalPopulation,
      activeMajorEvents,
    },
    settlements: settlements.slice(0, 10),
    recentHistory,
    allowedMetrics: [...EVENT_EDITABLE_METRICS],
  };
}

/** 늦은 응답 판정용 입력 해시 — 요약의 정규화 직렬화에서 계산 (§23) */
export function computeInputHash(input: LLMInput): string {
  const canonical = JSON.stringify({
    w: [input.world.year, input.world.season, input.world.globalPopulation, input.world.activeMajorEvents],
    s: input.settlements.map((s) => [s.id, s.population, s.foodMonthsRemaining, s.stability, s.migrationPressure]),
    h: input.recentHistory.map((e) => [e.type, e.tick]),
  });
  return fnv1a32(canonical).toString(16);
}
