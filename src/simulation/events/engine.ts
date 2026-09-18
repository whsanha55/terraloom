/**
 * 규칙 기반 이벤트 엔진 (Step 8) — §9.3.11~14 틱 내부 순서 담당.
 *
 * 11. 사건 발생 조건 평가 → 12. 확률 계산 → 13. 신규 사건 생성(통지형은 기록만)
 * 14. 사건 종료 처리(수정자 pop — activeEvents 제거로 파생 스택이 자동 원복)
 *
 * 오류 격리(§22.1): UnknownMetricError가 나면 해당 템플릿만 비활성화하고
 * 나머지 평가는 계속한다. 결정론: 모든 판정·지속 기간은 파생 시드를 쓴다.
 */
import { clamp } from "../core/numeric";
import { UnknownMetricError } from "../errors";
import type { WorldState } from "../core/worldState";
import { evaluateCondition } from "./conditions";
import { applyEffect, type TemplateRegistry } from "./effects";
import { resolveMetric } from "./metrics";
import { evaluateOccurrence, rollDuration } from "./probability";
import { validateTemplate } from "./templates/validate";
import type {
  ActiveWorldEvent,
  EventKind,
  EventScope,
  EventTemplate,
  HistoricalEvent,
  ProbabilityEvaluation,
} from "./types";

/** 중요 사건 자동 일시 정지 임계 (§9.5, §17 — 중요도 80 이상) */
export const MAJOR_EVENT_IMPORTANCE = 80;

export interface EventNotice {
  id: string;
  templateId: string;
  name: string;
  kind: EventKind;
  scope: EventScope;
  targetId: string;
  targetName: string;
  importance: number;
  startedTick: number;
}

export class EventEngine {
  /** 검증을 통과한 템플릿 레지스트리 — id → 템플릿 */
  public readonly registry: TemplateRegistry = new Map();
  /** 격리된 템플릿 — id → 사유 (§22.1) */
  public readonly isolatedTemplates = new Map<string, string>();

  /** 직전 run()의 확률 평가 전체(미발생 포함) — 디버그·UI용 */
  public lastTickEvaluations: ProbabilityEvaluation[] = [];
  /** 직전 run()에서 발생·기록된 사건 통지 */
  public lastTickNotices: EventNotice[] = [];

  constructor(templates: EventTemplate[]) {
    for (const template of templates) {
      validateTemplate(template); // InvalidTemplateError — 등록 거부
      this.registry.set(template.id, template);
    }
  }

  run(state: WorldState): void {
    this.lastTickEvaluations = [];
    this.lastTickNotices = [];
    const tick = state.clock.currentTick;

    const templates = [...this.registry.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const template of templates) {
      for (const targetId of this.targetsFor(state, template.scope)) {
        this.evaluateTarget(state, template, targetId, tick);
      }
    }

    this.processEndings(state, tick);
  }

  private evaluateTarget(
    state: WorldState,
    template: EventTemplate,
    targetId: string,
    tick: number,
  ): void {
    const target =
      template.scope === "route"
        ? ({ kind: "route", id: targetId } as const)
      : ({ kind: "settlement", id: targetId } as const);

    const cooldownKey = `${template.id}:${targetId}`;
    const freeAt = state.eventCooldowns[cooldownKey] ?? 0;
    if (tick < freeAt) return;

    if (!this.checkPreconditions(state, template, target)) return;
    if (this.activeCount(state, template.id) >= template.maximumConcurrentInstances) return;

    if (template.kind === "notification") {
      // 통지형 — 기본 계산 결과가 임계값을 넘으면 기록만 남긴다 (§12.4)
      const record: HistoricalEvent = {
        id: `evt:${template.id}:${targetId}:${tick}`,
        templateId: template.id,
        targetId,
        scope: template.scope,
        importance: template.importance,
        startedTick: tick,
        endedTick: tick,
        chainDepth: 0,
      };
      state.eventHistory.push(record);
      state.eventCooldowns[cooldownKey] = tick + template.cooldownTicks;
      this.lastTickNotices.push(this.buildNotice(state, template, targetId, record.id, tick));
      return;
    }

    let evaluation: ProbabilityEvaluation;
    try {
      evaluation = evaluateOccurrence(state, template, target);
    } catch (error) {
      if (error instanceof UnknownMetricError) {
        this.isolate(template, error.message);
        return;
      }
      throw error;
    }

    // 최근 종료 직후 재발 억제 — M_cooldown (§13)
    if (freeAt > 0 && tick < freeAt + template.cooldownTicks) {
      const dampen = 0.5;
      evaluation.modifiers.push({
        source: "cooldown.recent",
        value: dampen,
        explanation: "최근 종료 직후 — 재발 억제",
      });
      evaluation.finalProbability = clamp(
        evaluation.finalProbability * dampen,
        0,
        template.probability.max ?? 1,
      );
      evaluation.occurred = evaluation.randomValue < evaluation.finalProbability;
    }

    this.lastTickEvaluations.push(evaluation);
    if (!evaluation.occurred) return;

    const duration = rollDuration(state, template, targetId);
    const event: ActiveWorldEvent = {
      id: `evt:${template.id}:${targetId}:${tick}`,
      templateId: template.id,
      templateVersion: template.version,
      targetId,
      scope: template.scope,
      importance: template.importance,
      startedTick: tick,
      durationTicks: duration,
      endsAtTick: tick + duration,
      chainDepth: 0,
    };
    state.activeEvents.push(event);
    if (target.kind === "settlement") {
      state.settlements[targetId]?.activeEventIds.push(event.id);
    }
    try {
      for (const effect of template.immediateEffects) applyEffect(state, target, effect);
    } catch (error) {
      if (error instanceof UnknownMetricError) {
        this.isolate(template, error.message);
        return;
      }
      throw error;
    }
    state.probabilityEvaluations.push(evaluation);
    this.lastTickNotices.push(this.buildNotice(state, template, targetId, event.id, tick));
  }

  /** §9.3.14 — 종료 처리: 해상도 효과 적용, 이력 이동, 쿨다운 설정, 수정자 pop */
  private processEndings(state: WorldState, tick: number): void {
    const remaining: ActiveWorldEvent[] = [];
    for (const event of [...state.activeEvents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (event.endsAtTick > tick) {
        remaining.push(event);
        continue;
      }
      const template = this.registry.get(event.templateId);
      if (!template) {
        // 템플릿이 격리돼도 진행 중 사건은 정상 종료시킨다 (효과 없이)
        this.finalize(state, event, tick, 0);
        continue;
      }
      const target =
        event.scope === "route"
          ? ({ kind: "route", id: event.targetId } as const)
          : ({ kind: "settlement", id: event.targetId } as const);
      for (const effect of template.resolutionEffects) applyEffect(state, target, effect);
      this.finalize(state, event, tick, template.cooldownTicks);
    }
    state.activeEvents = remaining;
  }

  private finalize(state: WorldState, event: ActiveWorldEvent, tick: number, cooldownTicks: number): void {
    state.eventHistory.push({
      id: event.id,
      templateId: event.templateId,
      targetId: event.targetId,
      scope: event.scope,
      importance: event.importance,
      startedTick: event.startedTick,
      endedTick: tick,
      chainDepth: event.chainDepth,
      causedByEventId: event.causedByEventId,
    });
    state.eventCooldowns[`${event.templateId}:${event.targetId}`] = tick + cooldownTicks;
    if (event.scope === "settlement") {
      const settlement = state.settlements[event.targetId];
      if (settlement) {
        settlement.activeEventIds = settlement.activeEventIds.filter((id) => id !== event.id);
      }
    }
  }

  private checkPreconditions(
    state: WorldState,
    template: EventTemplate,
    target: { kind: "settlement" | "route"; id: string } | { kind: "world" },
  ): boolean {
    try {
      for (const condition of template.preconditions) {
        const value = resolveMetric(state, target, condition.metric);
        if (!evaluateCondition(condition, value)) return false;
      }
      return true;
    } catch (error) {
      if (error instanceof UnknownMetricError) {
        this.isolate(template, error.message);
        return false;
      }
      throw error;
    }
  }

  private activeCount(state: WorldState, templateId: string): number {
    let count = 0;
    for (const event of state.activeEvents) {
      if (event.templateId === templateId) count += 1;
    }
    return count;
  }

  private targetsFor(state: WorldState, scope: EventScope): string[] {
    if (scope === "settlement") {
      return Object.values(state.settlements)
        .filter((s) => s.status === "active") // §8.2 폐허는 이벤트 대상이 아님
        .map((s) => s.id)
        .sort();
    }
    if (scope === "route") {
      return Object.keys(state.routes).sort();
    }
    return []; // region·world 스코프 내장 이벤트는 아직 없다
  }

  private buildNotice(
    state: WorldState,
    template: EventTemplate,
    targetId: string,
    eventId: string,
    tick: number,
  ): EventNotice {
    const settlement = state.settlements[targetId];
    return {
      id: eventId,
      templateId: template.id,
      name: template.name,
      kind: template.kind,
      scope: template.scope,
      targetId,
      targetName: settlement?.name ?? targetId,
      importance: template.importance,
      startedTick: tick,
    };
  }

  private isolate(template: EventTemplate, reason: string): void {
    this.registry.delete(template.id);
    this.isolatedTemplates.set(template.id, reason);
  }
}
