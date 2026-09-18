/**
 * 이벤트 시스템 데이터 타입 (§12, §13) — Step 8.
 *
 * 모든 이벤트는 실행 가능한 구조화 데이터다. 템플릿은 조건(preconditions)·
 * 확률(probability)·효과(effects)·지속 기간(duration)·쿨다운으로 구성되며
 * 통지형/효과형(§12.4)으로 분류된다.
 */

export type EventCategory = "natural" | "health" | "social" | "economic" | "political";

/** §12.4 — 통지형(기록만) / 효과형(수정자 스택으로 실제 변화) */
export type EventKind = "notification" | "effect";

export type EventScope = "settlement" | "region" | "route" | "world";

export type ConditionOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

export interface EventCondition {
  metric: string;
  operator: ConditionOperator;
  value: number | [number, number];
}

export type EffectOperation = "add" | "multiply" | "clamp";

export interface EventEffect {
  targetMetric: string;
  operation: EffectOperation;
  value: number;
  minimum?: number;
  maximum?: number;
}

/** 확률 보정 인자 — 조건이 충족될 때만 곱해진다 (§13 M_condition) */
export interface ProbabilityFactor {
  source: string;
  condition: EventCondition;
  multiplier: number;
  explanation: string;
}

export interface ProbabilityDefinition {
  /** 월 단위 기본 확률 P_base */
  base: number;
  /** clamp 상한 P_max (기본 1) */
  max?: number;
  factors: ProbabilityFactor[];
}

export interface DurationDefinition {
  minTicks: number;
  maxTicks: number;
}

export interface FollowUpCandidate {
  eventTemplateId: string;
  minimumDelayTicks: number;
  maximumDelayTicks: number;
  baseWeight: number;
  conditions: EventCondition[];
}

export interface EventTemplate {
  id: string;
  version: number;
  category: EventCategory;
  kind: EventKind;
  name: string;
  descriptionTemplate: string;

  scope: EventScope;

  preconditions: EventCondition[];
  probability: ProbabilityDefinition;
  duration: DurationDefinition;

  /** 발생 시 1회 적용 (add/multiply — 영구 변경, §12.2.1) */
  immediateEffects: EventEffect[];
  /** 활성 동안 수정자 스택에 push (multiply — 종료 시 pop, §12.2.1) */
  ongoingEffects: EventEffect[];
  /** 종료 시 1회 적용 */
  resolutionEffects: EventEffect[];

  followUpCandidates: FollowUpCandidate[];

  cooldownTicks: number;
  maximumConcurrentInstances: number;

  /** 0~100 — 중요 사건 자동 일시 정지 임계(§9.5)와 필터(Step 10)의 기준 */
  importance: number;

  tags: string[];
  source: "builtin" | "llm" | "user";
}

/** 활성 이벤트 인스턴스 — 효과형 사건의 실행 상태 */
export interface ActiveWorldEvent {
  id: string;
  templateId: string;
  templateVersion: number;
  targetId: string;
  scope: EventScope;
  importance: number;
  startedTick: number;
  durationTicks: number;
  endsAtTick: number;
  /** 연쇄 깊이 — Step 9 후속 사건이 사용 */
  chainDepth: number;
  /** 연쇄 근거 사건 (인과관계 그래프, Step 9) */
  causedByEventId?: string;
}

/** 종료된 사건의 이력 — 타임라인·통계의 원천 */
export interface HistoricalEvent {
  id: string;
  templateId: string;
  targetId: string;
  scope: EventScope;
  importance: number;
  startedTick: number;
  endedTick: number;
  chainDepth: number;
  causedByEventId?: string;
}

/** 예정 이벤트 — 연쇄 후보의 지연 만료 관리 (Step 9) */
export interface ScheduledWorldEvent {
  id: string;
  templateId: string;
  targetId: string;
  /** 후보가 실제 발생할 수 있는 최초 틱 */
  activateAtTick: number;
  /** 이 틱까지 발생하지 않으면 만료 */
  expiresAtTick: number;
  baseWeight: number;
  chainDepth: number;
  causedByEventId: string;
}

/** §13.1 — 확률 계산 근거 보존 (UI·디버깅) */
export interface ProbabilityModifier {
  source: string;
  value: number;
  explanation: string;
}

export interface ProbabilityEvaluation {
  eventTemplateId: string;
  targetId: string;
  tick: number;
  baseProbability: number;
  modifiers: ProbabilityModifier[];
  finalProbability: number;
  randomValue: number;
  occurred: boolean;
}
