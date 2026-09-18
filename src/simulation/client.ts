/**
 * SimulationClient — UI 측 Worker 래퍼 (Step 5).
 *
 * 타입 안전한 요청 전송과 통지 구독을 제공한다. UI는 이 클라이언트를 통해서만
 * 시뮬레이션 상태에 접근한다(렌더링 전담, §31).
 */
import type {
  CityDetail,
  SimNotification,
  SimRequest,
  SimSpeed,
  StatsPoint,
  WorldReadyPayload,
} from "@/workers/protocol";
import type { EventNotice } from "@/simulation/events/engine";
import type { EventDetailData } from "@/simulation/events/detail";
import type { LLMInput } from "@/llm/gateway/summary";
import type { ChainContextInput, ChainScheduledSpec } from "@/llm/gateway/chain";
import type { BranchComparison, LLMPolicy } from "@/simulation/core/branch";
import type { EventTemplate } from "@/simulation/events/types";
import type { WorldConfig } from "@/world/model/worldConfig";

export type TickBatchNotification = Extract<SimNotification, { type: "tickBatch" }>;
export type SystemStatusNotification = Extract<SimNotification, { type: "systemStatus" }>;
export type MajorEventNotification = Extract<SimNotification, { type: "majorEvent" }>;

export interface LLMRegisterPayload {
  template: EventTemplate;
  inputHash: string;
  rawOutput: string;
  provider: string;
  model: string;
  promptVersion: string;
}

export interface SimulationClientHandlers {
  onWorldReady?: (world: WorldReadyPayload) => void;
  onTickBatch?: (notification: TickBatchNotification) => void;
  onStatsUpdate?: (series: StatsPoint[]) => void;
  onSystemStatus?: (notification: SystemStatusNotification) => void;
  onMajorEvent?: (notice: EventNotice, paused: boolean) => void;
  onEventDetail?: (detail: EventDetailData | null) => void;
  onCityDetail?: (detail: CityDetail | null) => void;
  onLLMRequest?: (
    input: LLMInput,
    inputHash: string,
    registeredNames: string[],
    tick: number,
    chain?: { context: ChainContextInput; contextHash: string },
  ) => void;
  onLLMRegistered?: (result: { ok: boolean; templateId?: string; reason?: string }) => void;
  onSnapshotSaved?: (result: { snapshotId: string; tick: number; branchId: string }) => void;
  onSnapshotList?: (snapshots: Array<{ id: string; tick: number; branchId: string; label: string }>) => void;
  onWorldRestored?: (result: { branchId: string; tick: number }) => void;
  onBranchComparison?: (comparison: BranchComparison) => void;
  onBranchList?: (branches: Array<{ id: string; name: string; parentBranchId: string; createdAtTick: number }>) => void;
  onInterventionResult?: (result: {
    ok: boolean;
    description: string;
    reason?: string;
    cost: number;
    remainingPoints: number;
  }) => void;
}

export class SimulationClient {
  private readonly worker: Worker;
  private pendingInit: ((world: WorldReadyPayload) => void) | null = null;

  constructor(handlers: SimulationClientHandlers = {}) {
    this.worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url));
    this.worker.onmessage = (event: MessageEvent<SimNotification>) => {
      const message = event.data;
      switch (message.type) {
        case "worldReady":
          this.pendingInit?.(message.world);
          this.pendingInit = null;
          handlers.onWorldReady?.(message.world);
          break;
        case "tickBatch":
          handlers.onTickBatch?.(message);
          break;
        case "statsUpdate":
          handlers.onStatsUpdate?.(message.series);
          break;
        case "systemStatus":
          handlers.onSystemStatus?.(message);
          break;
        case "majorEvent":
          handlers.onMajorEvent?.(message.notice, message.paused);
          break;
        case "eventDetailResult":
          handlers.onEventDetail?.(message.detail);
          break;
        case "cityDetailResult":
          handlers.onCityDetail?.(message.detail);
          break;
        case "llmRequest":
          handlers.onLLMRequest?.(
            message.input,
            message.inputHash,
            message.registeredNames,
            message.tick,
            message.chain,
          );
          break;
        case "llmRegistered":
          handlers.onLLMRegistered?.({ ok: message.ok, templateId: message.templateId, reason: message.reason });
          break;
        case "snapshotSaved":
          handlers.onSnapshotSaved?.({ snapshotId: message.snapshotId, tick: message.tick, branchId: message.branchId });
          break;
        case "snapshotList":
          handlers.onSnapshotList?.(message.snapshots);
          break;
        case "worldRestored":
          handlers.onWorldRestored?.({ branchId: message.branchId, tick: message.tick });
          break;
        case "branchComparison":
          handlers.onBranchComparison?.(message.comparison);
          break;
        case "branchList":
          handlers.onBranchList?.(message.branches);
          break;
        case "interventionResult":
          handlers.onInterventionResult?.({
            ok: message.ok,
            description: message.description,
            reason: message.reason,
            cost: message.cost,
            remainingPoints: message.remainingPoints,
          });
          break;
        default:
          break;
      }
    };
  }

  /** 세계 생성 요청 — worldReady 응답으로 resolve된다 */
  init(config: WorldConfig, seaLevel?: number): Promise<WorldReadyPayload> {
    return new Promise((resolve) => {
      this.pendingInit = resolve;
      this.send({ type: "init", config, seaLevel });
    });
  }

  setSpeed(speed: SimSpeed): void {
    this.send({ type: "setSpeed", speed });
  }

  step(ticks: 1 | 12): void {
    this.send({ type: "step", ticks });
  }

  requestEventDetail(eventId: string): void {
    this.send({ type: "eventDetail", eventId });
  }

  requestCityDetail(settlementId: string): void {
    this.send({ type: "cityDetail", settlementId });
  }

  setMajorThreshold(threshold: number): void {
    this.send({ type: "setMajorThreshold", threshold });
  }

  requestLLM(): void {
    this.send({ type: "requestLLM" });
  }

  requestLLMChain(eventId: string): void {
    this.send({ type: "requestLLM", mode: "chain", eventId });
  }

  registerChainTemplate(payload: {
    template: EventTemplate;
    scheduled: ChainScheduledSpec;
    inputHash: string;
    rawOutput: string;
    provider: string;
    model: string;
    promptVersion: string;
    approvedBy: "user" | "automatic";
    usage?: { promptTokens: number; outputTokens: number; estimatedCost?: number };
  }): void {
    this.send({ type: "registerChainTemplate", ...payload });
  }

  registerLLMTemplate(payload: LLMRegisterPayload): void {
    this.send({ type: "registerLLMTemplate", ...payload });
  }

  saveSnapshot(): void {
    this.send({ type: "snapshot", label: "user" });
  }

  listSnapshots(): void {
    this.send({ type: "listSnapshots" });
  }

  restoreSnapshot(snapshotId: string, options: { llmPolicy: LLMPolicy; asBranch: boolean; name?: string }): void {
    this.send({ type: "restoreSnapshot", snapshotId, ...options });
  }

  compareSnapshots(snapshotAId: string, snapshotBId: string): void {
    this.send({ type: "compareSnapshots", snapshotAId, snapshotBId });
  }

  listBranches(): void {
    this.send({ type: "listBranches" });
  }

  intervene(intervention: {
    id: string;
    tick: number;
    type: string;
    targetIds: string[];
    parameters: Record<string, number | string | boolean>;
  }): void {
    this.send({ type: "intervene", intervention });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private send(request: SimRequest): void {
    this.worker.postMessage(request);
  }
}
