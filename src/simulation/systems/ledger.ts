/**
 * 인구 변화 원장 (§8.3 / T3) — 핵심 가치 2.1("식량 부족 47%")의 데이터 원천.
 *
 * 매 틱, 각 도시의 인구 증감을 원인별로 기록한다.
 * - 이중 계상 금지: 기근과 질병이 동시에 작용해도 정산 순서(§9.4)에 따라 단일 원인 귀속
 * - 원장 원인별 합 = 총 인구 변화 (§33 불변식 테스트)
 * - 증분 집계(causeTotals)를 유지해 상태 해시가 O(1)에 원장을 반영한다
 */
export type PopulationChangeCause =
  "birth" | "natural" | "starvation" | "disease" | "migration_in" | "migration_out" | "event";

export const POPULATION_CHANGE_CAUSES: readonly PopulationChangeCause[] = [
  "birth",
  "natural",
  "starvation",
  "disease",
  "migration_in",
  "migration_out",
  "event",
];

export interface PopulationChangeEntry {
  tick: number;
  settlementId: string;
  cause: PopulationChangeCause;
  /** 양수 = 증가, 음수 = 감소 */
  amount: number;
  sourceEventId?: string;
}

export class ChangeLedger {
  private readonly entries: PopulationChangeEntry[] = [];
  private readonly causeTotals: Record<PopulationChangeCause, number>;

  constructor() {
    this.causeTotals = {} as Record<PopulationChangeCause, number>;
    for (const cause of POPULATION_CHANGE_CAUSES) {
      this.causeTotals[cause] = 0;
    }
  }

  record(entry: PopulationChangeEntry): void {
    if (entry.amount === 0) return; // 0 증감은 기록하지 않는다
    if (!Number.isFinite(entry.amount)) {
      throw new RangeError(`원장 기록이 유한수가 아닙니다: ${entry.amount}`);
    }
    this.entries.push(entry);
    this.causeTotals[entry.cause] += entry.amount;
  }

  get length(): number {
    return this.entries.length;
  }

  all(): readonly PopulationChangeEntry[] {
    return this.entries;
  }

  /** 도시·기간 필터 조회 */
  bySettlement(settlementId: string, fromTick = 0, toTick = Infinity): PopulationChangeEntry[] {
    return this.entries.filter(
      (entry) =>
        entry.settlementId === settlementId && entry.tick >= fromTick && entry.tick <= toTick,
    );
  }

  /** 도시·기간의 원인별 증감 집계 (§2.1 인과 분해) */
  aggregate(
    settlementId: string,
    fromTick = 0,
    toTick = Infinity,
  ): Record<PopulationChangeCause, number> {
    const result = {} as Record<PopulationChangeCause, number>;
    for (const cause of POPULATION_CHANGE_CAUSES) {
      result[cause] = 0;
    }
    for (const entry of this.bySettlement(settlementId, fromTick, toTick)) {
      result[entry.cause] += entry.amount;
    }
    return result;
  }

  /** 전체 증감 합 — 원장 총합 = 총 인구 변화 불변식 검증용 */
  total(): number {
    let sum = 0;
    for (const cause of POPULATION_CHANGE_CAUSES) {
      sum += this.causeTotals[cause];
    }
    return sum;
  }

  /** 원인별 전체 합 (상태 해시·통계용, O(1)) */
  totalsByCause(): Readonly<Record<PopulationChangeCause, number>> {
    return { ...this.causeTotals };
  }
}
