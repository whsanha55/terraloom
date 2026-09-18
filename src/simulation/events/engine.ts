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
import { computeProbability, evaluateOccurrence, rollDuration, rollEvent as eventRoll } from "./probability";
import { validateTemplate } from "./templates/validate";
import type {
  ActiveWorldEvent,
  EventKind,
  EventScope,
  EventTemplate,
  HistoricalEvent,
  ProbabilityEvaluation,
  ProbabilityModifier,
  ScheduledWorldEvent,
} from "./types";

/** 중요 사건 자동 일시 정지 임계 (§9.5, §17 — 중요도 80 이상) */
export const MAJOR_EVENT_IMPORTANCE = 80;

/** §14.1 무한 연쇄 방지 — MVP 권장값 */
export const MAX_CHAIN_DEPTH = 4;
export const MAX_SETTLEMENT_ACTIVE_EVENTS = 3;
export const MAX_WORLD_MAJOR_EVENTS = 20;
export const MAX_FOLLOW_UP_CANDIDATES = 5;
/** "중요 사건" 분류 기준(§14.1 세계 상한 산정용) */
export const MAJOR_EVENT_CLASSIFICATION = 50;

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
  /** 연쇄 근거 사건 이름 — 인과관계 UI 추적용 (Step 9) */
  causedByName?: string;
}

export interface CausalNode {
  id: string;
  templateId: string;
  targetId: string;
  chainDepth: number;
}

/** 인과 경로 조회 — 루트 사건부터 해당 사건까지 (§14 인과관계 그래프) */
export function causalChain(state: WorldState, eventId: string): CausalNode[] {
  const path: CausalNode[] = [];
  let currentId: string | undefined = eventId;
  const visited = new Set<string>(); // 방어: 비정상 순환 입력
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const active = state.activeEvents.find((e) => e.id === currentId);
    const event = active ?? state.eventHistory.find((e) => e.id === currentId);
    if (!event) break;
    path.push({
      id: event.id,
      templateId: event.templateId,
      targetId: event.targetId,
      chainDepth: event.chainDepth,
    });
    currentId = event.causedByEventId;
  }
  return path.reverse();
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

  /**
   * §9.3.2 — 예정된 이벤트 활성화(연쇄 후보 판정, Step 9).
   * 최소 지연 경과 → 조건 확인 → M_chain 확률 계산 → 결정론 판정 → 발생 또는 후보 유지·만료.
   */
  activateScheduled(state: WorldState): void {
    this.lastTickEvaluations = [];
    this.lastTickNotices = [];
    const tick = state.clock.currentTick;
    const fired = new Set<string>();
    const kept: ScheduledWorldEvent[] = [];
    const originalCount = state.scheduledEvents.length;

    for (const candidate of [...state.scheduledEvents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (tick > candidate.expiresAtTick) continue; // 만료 — 후보 목록에서 제거
      kept.push(candidate);
      if (tick < candidate.activateAtTick) continue; // 아직 최소 지연 전
      if (this.evaluateScheduled(state, candidate, tick)) {
        fired.add(candidate.id);
      }
    }
    // 평가 도중 발생한 사건이 새로 등록한 후보(배열 끝에 push됨)는 보존한다
    const newlyRegistered = state.scheduledEvents.slice(originalCount);
    state.scheduledEvents = kept.filter((c) => !fired.has(c.id)).concat(newlyRegistered);
  }

  /** 후보 1건 판정 — 발생하면 true(후보 소진) */
  private evaluateScheduled(
    state: WorldState,
    candidate: ScheduledWorldEvent,
    tick: number,
  ): boolean {
    const template = this.registry.get(candidate.templateId);
    if (!template) return true; // 템플릿 소멸(격리 등) — 후보 제거
    const target =
      template.scope === "route"
        ? ({ kind: "route", id: candidate.targetId } as const)
        : ({ kind: "settlement", id: candidate.targetId } as const);

    const cooldownKey = `${template.id}:${candidate.targetId}`;
    if (tick < (state.eventCooldowns[cooldownKey] ?? 0)) return false;

    // 후보 조건 + 템플릿 사전 조건을 매 틱 재확인 — 조건이 개선되면 미발생 (§14)
    if (!this.checkPreconditions(state, template, target)) return false;
    for (const condition of candidate.conditions) {
      try {
        if (!evaluateCondition(condition, resolveMetric(state, target, condition.metric))) return false;
      } catch (error) {
        if (error instanceof UnknownMetricError) {
          this.isolate(template, error.message);
          return true;
        }
        throw error;
      }
    }
    if (this.activeCount(state, template.id) >= template.maximumConcurrentInstances) return false;
    if (template.scope === "settlement" && !this.hasCapacity(state, template, candidate.targetId)) {
      return false;
    }

    if (template.kind === "notification") {
      const record: HistoricalEvent = {
        id: `evt:${template.id}:${candidate.targetId}:${tick}`,
        templateId: template.id,
        targetId: candidate.targetId,
        scope: template.scope,
        importance: template.importance,
        startedTick: tick,
        endedTick: tick,
        chainDepth: candidate.chainDepth,
        causedByEventId: candidate.causedByEventId,
      };
      state.eventHistory.push(record);
      state.eventCooldowns[cooldownKey] = tick + template.cooldownTicks;
      this.lastTickNotices.push(this.buildNotice(state, template, candidate.targetId, record.id, tick, candidate.causedByEventId));
      return true;
    }

    // M_chain — 선행 사건의 확률 보정 (§13, §14)
    let probability: number;
    let baseProbability: number;
    let conditionModifiers: ProbabilityModifier[];
    try {
      const computation = computeProbability(state, template, target);
      baseProbability = computation.baseProbability;
      conditionModifiers = computation.modifiers;
      probability = clamp(
        computation.finalProbability * candidate.baseWeight,
        0,
        template.probability.max ?? 1,
      );
    } catch (error) {
      if (error instanceof UnknownMetricError) {
        this.isolate(template, error.message);
        return true;
      }
      throw error;
    }
    const chainModifier: ProbabilityModifier = {
      source: "chain.weight",
      value: candidate.baseWeight,
      explanation: `선행 사건 ${this.eventNameOf(state, candidate.causedByEventId) ?? candidate.causedByEventId}에서 파생된 연쇄`,
    };
    const randomValue = eventRoll(state, template.id, candidate.targetId, "chain-roll");
    const occurred = randomValue < probability;
    this.lastTickEvaluations.push({
      eventTemplateId: template.id,
      targetId: candidate.targetId,
      tick,
      baseProbability,
      modifiers: [...conditionModifiers, chainModifier],
      finalProbability: probability,
      randomValue,
      occurred,
    });
    if (!occurred) return false;

    const duration = rollDuration(state, template, candidate.targetId);
    const event: ActiveWorldEvent = {
      id: `evt:${template.id}:${candidate.targetId}:${tick}`,
      templateId: template.id,
      templateVersion: template.version,
      targetId: candidate.targetId,
      scope: template.scope,
      importance: template.importance,
      startedTick: tick,
      durationTicks: duration,
      endsAtTick: tick + duration,
      chainDepth: candidate.chainDepth,
      causedByEventId: candidate.causedByEventId,
    };
    this.createEvent(state, template, target, event, {
      eventTemplateId: template.id,
      targetId: candidate.targetId,
      tick,
      baseProbability,
      modifiers: [...conditionModifiers, chainModifier],
      finalProbability: probability,
      randomValue,
      occurred: true,
    });
    return true;
  }

  /** 발생 처리 공통 — 상태 반영·후속 후보 등록·통지 */
  private createEvent(
    state: WorldState,
    template: EventTemplate,
    target: { kind: "settlement" | "route"; id: string },
    event: ActiveWorldEvent,
    evaluation?: ProbabilityEvaluation,
  ): void {
    state.activeEvents.push(event);
    if (target.kind === "settlement") {
      state.settlements[target.id]?.activeEventIds.push(event.id);
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
    if (evaluation) {
      state.probabilityEvaluations.push({
        ...evaluation,
        eventTemplateId: template.id,
        targetId: target.id,
        tick: event.startedTick,
      });
    }
    this.lastTickNotices.push(
      this.buildNotice(state, template, target.id, event.id, event.startedTick, event.causedByEventId),
    );
    this.registerFollowUps(state, template, event);
  }

  /** 선행 사건 발생 → 후속 후보 등록 (§14). 깊이·순환·중복 제한 적용. */
  private registerFollowUps(state: WorldState, template: EventTemplate, event: ActiveWorldEvent): void {
    for (let index = 0; index < template.followUpCandidates.length; index++) {
      const candidate = template.followUpCandidates[index];
      if (!candidate) continue;
      const childDepth = event.chainDepth + 1;
      if (childDepth > MAX_CHAIN_DEPTH) continue; // 연쇄 깊이 제한
      if (!this.registry.has(candidate.eventTemplateId)) continue;
      if (hasTemplateInChain(state, event.id, candidate.eventTemplateId)) continue; // 순환 탐지
      if (this.hasPendingCandidate(state, candidate.eventTemplateId, event.targetId)) continue; // 중복 방지
      state.scheduledEvents.push({
        id: `sch:${event.id}:${index}`,
        templateId: candidate.eventTemplateId,
        targetId: event.targetId,
        activateAtTick: event.startedTick + candidate.minimumDelayTicks,
        expiresAtTick: event.startedTick + candidate.maximumDelayTicks,
        baseWeight: candidate.baseWeight,
        chainDepth: childDepth,
        causedByEventId: event.id,
        conditions: candidate.conditions,
      });
    }
  }

  private hasPendingCandidate(state: WorldState, templateId: string, targetId: string): boolean {
    return state.scheduledEvents.some((c) => c.templateId === templateId && c.targetId === targetId);
  }

  /** 도시별 상한·세계 중요 사건 상한 여유 확인 */
  private hasCapacity(state: WorldState, template: EventTemplate, targetId: string): boolean {
    if (template.scope === "settlement") {
      let onTarget = 0;
      for (const event of state.activeEvents) {
        if (event.targetId === targetId) onTarget += 1;
      }
      if (onTarget >= MAX_SETTLEMENT_ACTIVE_EVENTS) return false;
    }
    if (template.importance >= MAJOR_EVENT_CLASSIFICATION) {
      let majors = 0;
      for (const event of state.activeEvents) {
        if (event.importance >= MAJOR_EVENT_CLASSIFICATION) majors += 1;
      }
      if (majors >= MAX_WORLD_MAJOR_EVENTS) return false;
    }
    return true;
  }

  /** 인과 체인에 해당 템플릿이 이미 있는지 — 순환 탐지 (§14.1) */
  private eventNameOf(state: WorldState, eventId: string | undefined): string | undefined {
    if (!eventId) return undefined;
    const active = state.activeEvents.find((e) => e.id === eventId);
    const event = active ?? state.eventHistory.find((e) => e.id === eventId);
    if (!event) return undefined;
    return this.registry.get(event.templateId)?.name;
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

    // 후속 후보가 대기 중이면 연쇄 경로가 이 (사건,대상)을 소유한다 — 중복 롤 방지
    if (this.hasPendingCandidate(state, template.id, targetId)) return;
    if (!this.hasCapacity(state, template, targetId)) return;

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
    this.createEvent(state, template, target, event, evaluation);
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
    causedByEventId?: string,
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
      causedByName: causedByEventId ? this.eventNameOf(state, causedByEventId) : undefined,
    };
  }

  private isolate(template: EventTemplate, reason: string): void {
    this.registry.delete(template.id);
    this.isolatedTemplates.set(template.id, reason);
  }
}

/** 인과 체인 위쪽에 해당 템플릿이 이미 있는지 — 순환 탐지 (§14.1) */
function hasTemplateInChain(state: WorldState, eventId: string, templateId: string): boolean {
  let currentId: string | undefined = eventId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const active = state.activeEvents.find((e) => e.id === currentId);
    const event = active ?? state.eventHistory.find((e) => e.id === currentId);
    if (!event) break;
    if (event.templateId === templateId) return true;
    currentId = event.causedByEventId;
  }
  return false;
}
