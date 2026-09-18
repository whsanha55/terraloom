/**
 * 이벤트 템플릿 검증 (§20.1 / §20.2 / InvalidTemplateError §22.1).
 *
 * 등록 시점(내장·LLM·사용자 공통)에 스키마·메트릭·범위를 검사해
 * 잘못된 템플릿이 엔진에 들어오지 못하게 한다.
 */
import { InvalidTemplateError } from "../../errors";
import { MAX_FOLLOW_UP_CANDIDATES } from "../engine";
import { KNOWN_METRICS } from "../metrics";
import type { EventCondition, EventEffect, EventTemplate } from "../types";

const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 400;

function checkCondition(template: EventTemplate, condition: EventCondition): void {
  if (!KNOWN_METRICS.has(condition.metric)) {
    throw new InvalidTemplateError(template.id, `알 수 없는 조건 메트릭 ${condition.metric}`);
  }
  if (condition.operator === "between") {
    if (!Array.isArray(condition.value) || condition.value[0] > condition.value[1]) {
      throw new InvalidTemplateError(template.id, `between 범위가 뒤집힘: ${JSON.stringify(condition.value)}`);
    }
  } else if (Array.isArray(condition.value)) {
    throw new InvalidTemplateError(template.id, `단일 연산자에 배열 값: ${condition.operator}`);
  }
}

function checkEffect(template: EventTemplate, effect: EventEffect): void {
  if (!KNOWN_METRICS.has(effect.targetMetric)) {
    throw new InvalidTemplateError(template.id, `알 수 없는 효과 메트릭 ${effect.targetMetric}`);
  }
  const prefix = template.scope === "route" ? "route." : "settlement.";
  if (!effect.targetMetric.startsWith(prefix)) {
    throw new InvalidTemplateError(
      template.id,
      `scope(${template.scope})와 효과 대상(${effect.targetMetric}) 불일치`,
    );
  }
  if (!Number.isFinite(effect.value)) {
    throw new InvalidTemplateError(template.id, `효과 값이 유한수가 아님: ${effect.value}`);
  }
}

export function validateTemplate(template: EventTemplate): void {
  if (!template.id || template.id.length === 0) {
    throw new InvalidTemplateError("(이름 없음)", "id가 비었습니다");
  }
  if (template.version < 1) {
    throw new InvalidTemplateError(template.id, "version은 1 이상이어야 합니다");
  }
  if (!template.name || template.name.length > NAME_MAX_LENGTH) {
    throw new InvalidTemplateError(template.id, `name 길이 초과 (≤${NAME_MAX_LENGTH})`);
  }
  if (template.descriptionTemplate.length > DESCRIPTION_MAX_LENGTH) {
    throw new InvalidTemplateError(template.id, `설명 길이 초과 (≤${DESCRIPTION_MAX_LENGTH})`);
  }
  if (template.importance < 0 || template.importance > 100) {
    throw new InvalidTemplateError(template.id, "importance는 0~100이어야 합니다");
  }
  if (template.probability.base <= 0 || template.probability.base > 1) {
    throw new InvalidTemplateError(template.id, `기본 확률 범위 위반: ${template.probability.base}`);
  }
  if (template.probability.max !== undefined && (template.probability.max <= 0 || template.probability.max > 1)) {
    throw new InvalidTemplateError(template.id, `확률 상한 범위 위반: ${template.probability.max}`);
  }
  for (const factor of template.probability.factors) {
    if (!Number.isFinite(factor.multiplier) || factor.multiplier <= 0) {
      throw new InvalidTemplateError(template.id, `확률 인자 배율 위반: ${factor.multiplier}`);
    }
    checkCondition(template, factor.condition);
  }
  const { minTicks, maxTicks } = template.duration;
  if (minTicks < 0 || minTicks > maxTicks) {
    throw new InvalidTemplateError(template.id, `지속 기간 범위 위반: ${minTicks}~${maxTicks}`);
  }
  if (template.kind === "effect" && minTicks < 1) {
    throw new InvalidTemplateError(template.id, "효과형 사건의 지속 기간은 최소 1틱입니다");
  }
  if (template.kind === "notification" && (template.immediateEffects.length > 0 || template.ongoingEffects.length > 0 || template.resolutionEffects.length > 0)) {
    throw new InvalidTemplateError(template.id, "통지형 사건은 효과를 가질 수 없습니다 (§12.4)");
  }
  if (template.cooldownTicks < 0) {
    throw new InvalidTemplateError(template.id, "cooldownTicks는 0 이상이어야 합니다");
  }
  if (template.maximumConcurrentInstances < 1) {
    throw new InvalidTemplateError(template.id, "maximumConcurrentInstances는 1 이상이어야 합니다");
  }
  for (const condition of template.preconditions) checkCondition(template, condition);
  for (const effect of template.immediateEffects) checkEffect(template, effect);
  for (const effect of template.ongoingEffects) checkEffect(template, effect);
  for (const effect of template.resolutionEffects) checkEffect(template, effect);
  if (template.followUpCandidates.length > MAX_FOLLOW_UP_CANDIDATES) {
    throw new InvalidTemplateError(
      template.id,
      `후속 후보는 최대 ${MAX_FOLLOW_UP_CANDIDATES}개입니다 (§14.1)`,
    );
  }
  for (const followUp of template.followUpCandidates) {
    if (!followUp.eventTemplateId || followUp.eventTemplateId.length === 0) {
      throw new InvalidTemplateError(template.id, "후속 후보 템플릿 id가 비었습니다");
    }
    if (!Number.isFinite(followUp.baseWeight) || followUp.baseWeight <= 0) {
      throw new InvalidTemplateError(template.id, `후속 후보 가중치 위반: ${followUp.baseWeight}`);
    }
    if (followUp.minimumDelayTicks < 0 || followUp.minimumDelayTicks > followUp.maximumDelayTicks) {
      throw new InvalidTemplateError(template.id, `후속 지연 범위 위반: ${followUp.eventTemplateId}`);
    }
    for (const condition of followUp.conditions) checkCondition(template, condition);
  }
}
