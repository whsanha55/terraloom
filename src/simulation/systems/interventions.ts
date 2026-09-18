/**
 * 사용자 개입 (§24 / Step 14) — 즉시 개입·정책 개입·세계 편집.
 *
 * 모든 개입은 비용을 차감하고 기록으로 저장된다(재현성 — 개입 시퀀스 재실행 동일).
 * 규칙 엔진이 효과를 적용한다 — 개입은 상태 전이를 유발하는 입력일 뿐이다(§6).
 */
import { clamp } from "../core/numeric";
import type { WorldState } from "../core/worldState";
import type { EventEngine } from "../events/engine";
import { FOOD_PER_PERSON } from "./food";
import type { UserIntervention } from "@/workers/protocol";

export interface InterventionEffect {
  ok: boolean;
  reason?: string;
  description: string;
  cost: number;
}

export interface InterventionDefinition {
  label: string;
  baseCost: number;
}

export const INTERVENTION_TYPES: Record<string, InterventionDefinition> = {
  foodAid: { label: "긴급 식량 지원", baseCost: 100 },
  disasterResponse: { label: "재난 대응", baseCost: 150 },
  migrationPolicy: { label: "이민 개방도 조절", baseCost: 50 },
  tradePriority: { label: "교역 우선순위 조절", baseCost: 50 },
  irrigation: { label: "관개 투자", baseCost: 200 },
  triggerEvent: { label: "사건 직접 발생", baseCost: 80 },
};

const OPENNESS_RANGE: [number, number] = [0.2, 1.8];
const TRADE_RANGE: [number, number] = [0.2, 1.8];
const IRRIGATION_FERTILITY = 0.05;
const IRRIGATION_CAPACITY = 2500;

function numberParam(intervention: UserIntervention, key: string, fallback: number): number {
  const value = intervention.parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function applyIntervention(
  state: WorldState,
  intervention: UserIntervention,
  eventEngine: EventEngine,
): InterventionEffect {
  const definition = INTERVENTION_TYPES[intervention.type];
  if (!definition) {
    return { ok: false, reason: "알 수 없는 개입 유형", description: "", cost: 0 };
  }
  const targets = intervention.targetIds
    .map((id) => state.settlements[id])
    .filter((settlement): settlement is NonNullable<typeof settlement> => settlement !== undefined);
  if (targets.length === 0) {
    return { ok: false, reason: "존재하지 않는 대상", description: "", cost: 0 };
  }
  if (targets.some((t) => t.status !== "active")) {
    return { ok: false, reason: "폐허 도시에는 개입할 수 없습니다 (§8.2)", description: "", cost: 0 };
  }

  // 비용 산정 — 적용 전에 검사한다 (거부 시 상태 불변)
  const months = intervention.type === "foodAid"
    ? clamp(Math.round(numberParam(intervention, "months", 1)), 1, 24)
    : 0;
  let cost = definition.baseCost * (intervention.type === "foodAid" ? months : 1);
  if (intervention.type === "disasterResponse") {
    // 종료할 자연재해가 없으면 아예 실행하지 않는다 — 비용도 없다
    let count = 0;
    for (const target of targets) {
      for (const eventId of target.activeEventIds) {
        const event = state.activeEvents.find((e) => e.id === eventId);
        const template = event ? eventEngine.registry.get(event.templateId) : undefined;
        if (template?.category === "natural") count += 1;
      }
    }
    if (count === 0) {
      return { ok: false, reason: "종료할 자연재해가 없습니다", description: "", cost: 0 };
    }
    cost = definition.baseCost * count;
  }
  if (state.interventionPoints < cost) {
    return {
      ok: false,
      reason: `개입 비용 부족 — 필요 ${cost}, 잔여 ${state.interventionPoints}`,
      description: "",
      cost,
    };
  }

  let description = "";
  switch (intervention.type) {
    case "foodAid": {
      for (const target of targets) {
        target.foodStock += target.population * FOOD_PER_PERSON * months;
      }
      description = `${namesOf(targets)}에 ${months}개월분 긴급 식량 지원 — 재고에 즉시 반영됩니다`;
      break;
    }
    case "disasterResponse": {
      let ended = 0;
      for (const target of targets) {
        for (const eventId of [...target.activeEventIds]) {
          const event = state.activeEvents.find((e) => e.id === eventId);
          if (!event) continue;
          const template = eventEngine.registry.get(event.templateId);
          if (template?.category !== "natural") continue; // 자연재해만 강제 종료
          eventEngine.forceEnd(state, eventId);
          ended += 1;
        }
      }
      description = `${namesOf(targets)} 재난 대응 — 자연재해 ${ended}건 강제 종료 (수정자 원복)`;
      break;
    }
    case "migrationPolicy": {
      const openness = clamp(numberParam(intervention, "openness", 1), OPENNESS_RANGE[0], OPENNESS_RANGE[1]);
      for (const target of targets) {
        target.policies.migrationOpenness = openness;
      }
      description = `${namesOf(targets)} 이민 개방도 ${openness.toFixed(1)} — 이주 유출에 반영됩니다`;
      break;
    }
    case "tradePriority": {
      const priority = clamp(numberParam(intervention, "priority", 1), TRADE_RANGE[0], TRADE_RANGE[1]);
      for (const target of targets) {
        target.policies.tradePriority = priority;
      }
      description = `${namesOf(targets)} 교역 우선순위 ${priority.toFixed(1)} — 잉여 식량 이동 분율에 반영됩니다`;
      break;
    }
    case "irrigation": {
      for (const target of targets) {
        target.areaFertility = clamp(target.areaFertility + IRRIGATION_FERTILITY, 0, 1);
        target.carryingCapacity += IRRIGATION_CAPACITY;
      }
      description = `${namesOf(targets)} 관개 투자 — 비옥도·수용력이 영구 증가합니다`;
      break;
    }
    case "triggerEvent": {
      const templateId = String(intervention.parameters.templateId ?? "");
      const template = eventEngine.registry.get(templateId);
      if (!template) {
        return { ok: false, reason: `알 수 없는 사건: ${templateId}`, description: "", cost: 0 };
      }
      for (const target of targets) {
        eventEngine.forceStart(state, templateId, target.id, intervention.tick);
      }
      description = `${namesOf(targets)}에 ${template.name} 강제 발생 — 세계 편집 (§24.3)`;
      break;
    }
    default:
      return { ok: false, reason: "미구현 개입", description: "", cost: 0 };
  }

  state.interventionPoints -= cost;
  state.interventions.push(intervention);
  return { ok: true, description: `${description} · 적용됨 — 원장·기록에 저장됩니다`, cost };
}

function namesOf(targets: Array<{ name: string }>): string {
  return targets.map((t) => t.name).join(", ");
}
