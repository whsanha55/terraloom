/**
 * 인구 변화 (§8 / T3) — 출생·사망의 원장 기록과 폐허 전환.
 *
 * §9.3.8: 식량 정산(§9.4)이 미충족을 확정한 뒤에 실행된다 —
 * 같은 달 도착한 교역이 이미 반영된 상태에서 기아 사망이 정해진다.
 * 모든 증감은 원장(§8.3)에 원인별로 기록된다.
 */
import type { WorldState } from "../core/worldState";

export const BIRTH_RATE = 0.002; // 월 출생률
export const NATURAL_DEATH_RATE = 0.001; // 월 자연 사망률
export const OVERCROWDING_RATE = 0.02; // 수용력 초과분당 추가 사망률
export const STARVATION_RATE = 0.3; // 미충족 인구의 월 사망 비율
/** 질병 수준당 월 사망 비율 (§9.3.8 — 전염병 이벤트와 연결) */
export const DISEASE_DEATH_RATE = 0.03;
/** 거의 완전한 기근에서는 최소 이만큼 사망 — 마을이 0으로 소멸할 수 있다 */
const FAMINE_MIN_DEATHS = 1;
const FAMINE_THRESHOLD = 0.9;

export function runPopulationChange(state: WorldState): void {
  const ledger = state.changeLedger;
  const tick = state.clock.currentTick;
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.status !== "active") continue;

    const population = settlement.population;
    const overRatio =
      population > settlement.carryingCapacity && settlement.carryingCapacity > 0
        ? (population - settlement.carryingCapacity) / settlement.carryingCapacity
        : 0;

    const births = Math.round(population * BIRTH_RATE);
    const natural = Math.round(population * (NATURAL_DEATH_RATE + OVERCROWDING_RATE * overRatio));
    const disease = Math.round(population * settlement.diseaseLevel * DISEASE_DEATH_RATE);
    let starvation = Math.round(population * settlement.unmetRatio * STARVATION_RATE);
    if (settlement.unmetRatio > FAMINE_THRESHOLD) {
      starvation = Math.max(starvation, FAMINE_MIN_DEATHS);
    }

    let next = population + births - natural - disease - starvation;
    if (!Number.isFinite(next) || next < 0) {
      next = 0; // §33 불변식: 인구는 음수가 되지 않는다
    }
    settlement.population = next;

    ledger.record({ tick, settlementId: settlement.id, cause: "birth", amount: births });
    ledger.record({ tick, settlementId: settlement.id, cause: "natural", amount: -natural });
    ledger.record({ tick, settlementId: settlement.id, cause: "disease", amount: -disease });
    ledger.record({
      tick,
      settlementId: settlement.id,
      cause: "starvation",
      amount: -starvation,
    });

    // §8.2 — 인구 0 도달 시 폐허. 자연 회복 전환은 없다(재건은 Step 14 개입)
    if (settlement.population === 0) {
      settlement.status = "ruined";
    }
    settlement.unmetRatio = 0; // 소진 — 다음 틱 식량 정산에서 재산정
  }
}
