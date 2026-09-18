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
import type { WorldConfig } from "@/world/model/worldConfig";

export type TickBatchNotification = Extract<SimNotification, { type: "tickBatch" }>;
export type SystemStatusNotification = Extract<SimNotification, { type: "systemStatus" }>;
export type MajorEventNotification = Extract<SimNotification, { type: "majorEvent" }>;

export interface SimulationClientHandlers {
  onWorldReady?: (world: WorldReadyPayload) => void;
  onTickBatch?: (notification: TickBatchNotification) => void;
  onStatsUpdate?: (series: StatsPoint[]) => void;
  onSystemStatus?: (notification: SystemStatusNotification) => void;
  onMajorEvent?: (notice: EventNotice, paused: boolean) => void;
  onEventDetail?: (detail: EventDetailData | null) => void;
  onCityDetail?: (detail: CityDetail | null) => void;
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

  dispose(): void {
    this.worker.terminate();
  }

  private send(request: SimRequest): void {
    this.worker.postMessage(request);
  }
}
