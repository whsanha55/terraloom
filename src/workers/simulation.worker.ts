/**
 * 시뮬레이션 Worker (Step 5 / T1·T16) — 결정론 코드의 단일 소스.
 *
 * 월드젠·시뮬레이션 모두 이 Worker에서 실행한다(§31). UI는 렌더링만 담당.
 * 지도 버퍼는 worldReady 시 transfer list로 UI에 제로카피 이전한다(T16) —
 * 이전 후 Worker의 map 배열은 detached 되며, 이후 엔진은 도시 영역 캐시
 * (§10.4, initializeWorldState가 1회 계산)만 사용하므로 문제없다.
 *
 * 배속 스케줄링: 1x=2초/틱, 10x=200ms, 100x=20ms(§9.1). MAX는
 * macrotask마다 대량 배치를 돌아 처리율 상한으로 동작한다.
 * 통지는 TickBatcher가 초당 최대 10회로 배치 통합한다.
 */
import { SimulationEngine } from "@/simulation/core/engine";
import { TickBatcher } from "@/simulation/core/scheduler";
import { initializeWorldState } from "@/simulation/core/worldState";
import { MAJOR_EVENT_IMPORTANCE, type EventNotice } from "@/simulation/events/engine";
import { describeEvent } from "@/simulation/events/detail";
import { POPULATION_CHANGE_CAUSES } from "@/simulation/systems/ledger";
import { summarizeForLLM, computeInputHash } from "@/llm/gateway/summary";
import {
  summarizeChainContext,
  computeChainContextHash,
} from "@/llm/gateway/chain";
import { registerLLMTemplate, registerChainTemplate } from "@/llm/records";
import { registeredTemplateNames } from "@/llm/validation/safety";
import { generateWorld } from "@/world/generation/generator";
import { IndexedDbBackend, WorldStore } from "@/storage/worldStore";
import { SnapshotQueue } from "@/simulation/snapshots/queue";
import { buildBranchState, compareSnapshots, type LLMPolicy } from "@/simulation/core/branch";
import { applyIntervention } from "@/simulation/systems/interventions";
import type {
  CityDetail,
  Season,
  SettlementSnapshot,
  SimNotification,
  SimRequest,
  SimSpeed,
  StatsPoint,
  WorldSummary,
} from "./protocol";

const TICK_INTERVAL_MS: Record<1 | 10 | 100, number> = { 1: 2000, 10: 200, 100: 20 };
const MAX_BATCH_TICKS = 2000;

/** dom lib와 webworker lib 충돌 없이 Worker 스코프를 쓰기 위한 최소 인터페이스 */
interface WorkerScope {
  postMessage(message: SimNotification, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let engine: SimulationEngine | null = null;
let batcher = new TickBatcher(100);
/** 저장 큐(§28.4) — IndexedDbBackend(실패 시 메모리 폴백) */
let store: WorldStore = new WorldStore(new IndexedDbBackend());
let snapshotQueue: SnapshotQueue | null = null;
let storageReady = false;
let worldKey = ""; // `${worldId}` — 스냅숏 키 기준
let timer: ReturnType<typeof setTimeout> | null = null;
let speed: SimSpeed = 1;
let paused = true;
/** 중요 사건 자동 정지 임계 (§25 — 설정에서 조절 가능) */
let majorThreshold = MAJOR_EVENT_IMPORTANCE;
/** 직전 틱 이주 총인원 */
function lastFlowsTotal(): number {
  if (!engine) return 0;
  let total = 0;
  for (const flow of engine.lastMigrationFlows) total += flow.amount;
  return total;
}

/** 마지막 statsUpdate 이후 쌓인 증분 통계 지점 */
let pendingStats: StatsPoint[] = [];
/** 마지막 tickBatch 이후 쌓인 사건 통지 */
let pendingNotices: EventNotice[] = [];
/** 이미 통지한 격리 템플릿 (systemStatus 중복 방지, §22.1) */
const reportedIsolations = new Set<string>();

function post(message: SimNotification, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(message, transfer);
  } else {
    ctx.postMessage(message);
  }
}

function seasonOf(month: number): Season {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

function buildSummary(): WorldSummary {
  if (!engine) throw new Error("summary: 엔진이 없습니다");
  const clock = engine.state.clock;
  let totalPopulation = 0;
  let totalFoodStock = 0;
  for (const settlement of Object.values(engine.state.settlements)) {
    if (settlement.status === "active") {
      totalPopulation += settlement.population;
      totalFoodStock += settlement.foodStock;
    }
  }
  return {
    tick: clock.currentTick,
    year: clock.year,
    month: clock.month,
    season: seasonOf(clock.month),
    totalPopulation,
    totalFoodStock,
    migrationTotal: lastFlowsTotal(),
    paused,
    speed,
    interventionPoints: engine.state.interventionPoints,
  };
}

function settlementSnapshots(): SettlementSnapshot[] {
  if (!engine) return [];
  return Object.values(engine.state.settlements).map((settlement) => ({
    id: settlement.id,
    population: settlement.population,
    status: settlement.status,
    foodStock: settlement.foodStock,
    foodMonthsRemaining: settlement.foodMonthsRemaining,
    stability: settlement.stability,
    migrationPressure: settlement.migrationPressure,
    diseaseLevel: settlement.diseaseLevel,
    activeEvents: settlement.activeEventIds
      .map((id) => engine!.state.activeEvents.find((e) => e.id === id))
      .filter((e) => e !== undefined)
      .map((e) => ({
        id: e!.id,
        name: engine!.eventEngine.registry.get(e!.templateId)?.name ?? e!.templateId,
        importance: e!.importance,
        category: engine!.eventEngine.registry.get(e!.templateId)?.category ?? "social",
      })),
  }));
}

function emitTickBatch(fromTick: number, toTick: number): void {
  post({
    type: "tickBatch",
    fromTick,
    toTick,
    summary: buildSummary(),
    changes: [],
    settlements: settlementSnapshots(),
    migrations: engine ? engine.lastMigrationFlows : [],
    events: pendingNotices,
  });
  pendingNotices = [];
  if (pendingStats.length > 0) {
    post({ type: "statsUpdate", series: pendingStats });
    pendingStats = [];
  }
}

/** 격리된 템플릿을 사용자에게 노출한다 (§22.1 — swallow and continue 금지) */
function reportIsolations(): void {
  if (!engine) return;
  for (const [templateId, reason] of engine.eventEngine.isolatedTemplates) {
    if (reportedIsolations.has(templateId)) continue;
    reportedIsolations.add(templateId);
    post({
      type: "systemStatus",
      level: "warning",
      code: "event_template_isolated",
      message: `사건 템플릿 ${templateId} 비활성화됨 — ${reason}`,
    });
  }
}

function scheduleSnapshot(label: "auto" | "user"): void {
  if (!engine || !snapshotQueue) return;
  snapshotQueue.enqueue({
    worldId: worldKey,
    tick: engine.state.clock.currentTick,
    branchId: engine.state.branchId,
    label,
    state: engine.state,
  });
  void snapshotQueue.flushAll().then(() => {
    if (engine && storageReady) {
      void store.putWorld({
        id: worldKey,
        seed: engine.state.seed,
        name: engine.state.name,
        createdAt: Date.now(),
        lastTick: engine.state.clock.currentTick,
        simulationVersion: engine.state.simulationVersion,
        generatorVersion: engine.state.generatorVersion,
      });
    }
  });
}

function runTicks(count: number): void {
  if (!engine) return;
  const now = performance.now();
  for (let i = 0; i < count; i++) {
    engine.tick();
    // §28.2 — 1년마다 자동 스냅샷 (큐가 틱 사이에 비동기 flush)
    if (SnapshotQueue.isYearBoundary(engine.state.clock.currentTick)) {
      scheduleSnapshot("auto");
    }
    const stats = engine.state.globalStatistics;
    pendingStats.push({
      tick: engine.state.clock.currentTick,
      totalPopulation: stats.totalPopulation[stats.totalPopulation.length - 1] ?? 0,
      totalFoodStock: stats.totalFoodStock[stats.totalFoodStock.length - 1] ?? 0,
    });
    pendingNotices.push(...engine.lastTickNotices);

    // §9.5 — 중요 사건 즉시 통지 + 자체 정지. UI 응답 전 추가 틱 없음
    const major = engine.lastTickNotices.find((n) => n.importance >= majorThreshold);
    if (major) {
      paused = true;
      engine.state.clock.paused = true;
      engine.state.clock.speed = 0;
      speed = 0;
      const batch = batcher.flush(performance.now());
      if (batch) emitTickBatch(batch.fromTick, batch.toTick);
      else emitTickBatch(engine.state.clock.currentTick, engine.state.clock.currentTick);
      post({ type: "majorEvent", notice: major, paused: true });
      reportIsolations();
      return;
    }

    const batch = batcher.onTick(engine.state.clock.currentTick, now);
    if (batch) {
      emitTickBatch(batch.fromTick, batch.toTick);
    }
  }
  reportIsolations();
}

function schedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (paused || !engine) return;
  if (speed === "MAX") {
    timer = setTimeout(() => {
      runTicks(MAX_BATCH_TICKS);
      schedule();
    }, 0);
  } else if (speed === 1 || speed === 10 || speed === 100) {
    timer = setTimeout(() => {
      runTicks(1);
      schedule();
    }, TICK_INTERVAL_MS[speed]);
  }
}

async function openStorage(): Promise<void> {
  if (storageReady) return;
  try {
    const backend = new IndexedDbBackend();
    await backend.open();
    store = new WorldStore(backend);
  } catch {
    store = new WorldStore(new (await import("@/storage/worldStore")).MemoryBackend()); // 폴백
  }
  storageReady = true;
}

function handleInit(request: Extract<SimRequest, { type: "init" }>): void {
  const gen = generateWorld(request.config, { seaLevel: request.seaLevel });
  engine = new SimulationEngine(initializeWorldState(gen));
  worldKey = engine.state.id;
  void openStorage().then(() => {
    snapshotQueue = new SnapshotQueue(store);
    snapshotQueue.onError = (message) =>
      post({ type: "systemStatus", level: "error", code: "snapshot_save_failed", message });
    // §28.4 — 시드는 생성 즉시 저장소에 보관된다
    scheduleSnapshot("auto");
  });
  batcher = new TickBatcher(100);
  speed = 1;
  paused = true;
  pendingStats = [];
  pendingNotices = [];
  reportedIsolations.clear();
  schedule(); // 일시 정지 상태로 시작 — 타이머 없음

  const { map } = gen;
  post(
    {
      type: "worldReady",
      world: {
        map,
        settlements: gen.settlements,
        routes: gen.routes,
        seaLevel: gen.seaLevel,
        attempts: gen.attempts,
        landRatio: gen.landRatio,
        seaLevelCompensated: gen.seaLevelCompensated,
        generatorVersion: gen.generatorVersion,
      },
    },
    [
      map.elevation.buffer,
      map.temperature.buffer,
      map.moisture.buffer,
      map.fertility.buffer,
      map.biome.buffer,
      map.riverVolume.buffer,
      map.regionId.buffer,
    ],
  );
  // 초기 요약 즉시 통지 — UI가 재생 전 상태를 표시할 수 있게
  emitTickBatch(0, 0);
  pendingStats = [
    {
      tick: 0,
      totalPopulation:
        engine.state.globalStatistics.totalPopulation[
          engine.state.globalStatistics.totalPopulation.length - 1
        ] ?? 0,
      totalFoodStock:
        engine.state.globalStatistics.totalFoodStock[
          engine.state.globalStatistics.totalFoodStock.length - 1
        ] ?? 0,
    },
  ];
  post({ type: "statsUpdate", series: pendingStats });
  pendingStats = [];
}

function handleSetSpeed(request: Extract<SimRequest, { type: "setSpeed" }>): void {
  speed = request.speed;
  paused = request.speed === 0;
  if (engine) {
    engine.state.clock.speed = speed;
    engine.state.clock.paused = paused;
  }
  schedule();
  // 즉시 피드백 — 보류 배치 flush, 없어도 현재 상태 통지
  const now = performance.now();
  const batch = batcher.flush(now);
  if (batch) {
    emitTickBatch(batch.fromTick, batch.toTick);
  } else if (engine) {
    emitTickBatch(engine.state.clock.currentTick, engine.state.clock.currentTick);
  }
}

/** 도시 상세 — 원장 집계(§8.3)로 인구 변화 원인 분해를 만든다 (§2.1) */
function buildCityDetail(settlementId: string): CityDetail | null {
  if (!engine) return null;
  const settlement = engine.state.settlements[settlementId];
  if (!settlement) return null;
  const toTick = engine.state.clock.currentTick;
  const fromTick = Math.max(0, toTick - 60); // 최근 5년
  const aggregate = engine.state.changeLedger.aggregate(settlementId, fromTick, toTick);
  const causeBreakdown = POPULATION_CHANGE_CAUSES.filter((cause) => aggregate[cause] !== 0).map(
    (cause) => ({ cause, amount: aggregate[cause] }),
  );
  return {
    settlementId,
    name: settlement.name,
    status: settlement.status,
    population: settlement.population,
    carryingCapacity: settlement.carryingCapacity,
    foodStock: settlement.foodStock,
    foodMonthsRemaining: settlement.foodMonthsRemaining,
    stability: settlement.stability,
    diseaseLevel: settlement.diseaseLevel,
    causeBreakdown,
    breakdownFromTick: fromTick,
    currentTick: toTick,
    activeEvents: settlement.activeEventIds
      .map((id) => engine!.state.activeEvents.find((e) => e.id === id))
      .filter((e) => e !== undefined)
      .map((e) => ({
        id: e!.id,
        name: engine!.eventEngine.registry.get(e!.templateId)?.name ?? e!.templateId,
        importance: e!.importance,
        startedTick: e!.startedTick,
      })),
  };
}

ctx.onmessage = (event: MessageEvent<SimRequest>) => {
  const request = event.data;
  switch (request.type) {
    case "init":
      handleInit(request);
      break;
    case "setSpeed":
      handleSetSpeed(request);
      break;
    case "step":
      if (!engine) break;
      runTicks(request.ticks);
      {
        const now = performance.now();
        const batch = batcher.flush(now);
        if (batch) emitTickBatch(batch.fromTick, batch.toTick);
      }
      break;
    case "eventDetail":
      if (!engine) {
        post({ type: "eventDetailResult", detail: null });
        break;
      }
      post({
        type: "eventDetailResult",
        detail: describeEvent(engine.state, engine.eventEngine.registry, request.eventId),
      });
      break;
    case "cityDetail":
      post({ type: "cityDetailResult", detail: buildCityDetail(request.settlementId) });
      break;
    case "intervene":
      if (!engine) break;
      {
        const effect = applyIntervention(engine.state, request.intervention, engine.eventEngine);
        post({
          type: "interventionResult",
          ok: effect.ok,
          description: effect.description,
          reason: effect.reason,
          cost: effect.cost,
          remainingPoints: engine.state.interventionPoints,
        });
        emitTickBatch(engine.state.clock.currentTick, engine.state.clock.currentTick);
      }
      break;
    case "setMajorThreshold":
      majorThreshold = Math.max(0, Math.min(100, request.threshold));
      break;
    case "snapshot":
      if (!engine) break;
      {
        // 요청 시점의 틱·분기를 통지에 그대로 쓴다 — flush 완료 시점 값과 어긋나지 않게
        const tick = engine.state.clock.currentTick;
        const branchId = engine.state.branchId;
        scheduleSnapshot(request.label === "user" ? "user" : "auto");
        // 실제 저장 완료 후 통지 — 목록 조회 경쟁 방지.
        // flushAll은 진행 중 flush 뒤에 체인되므로 resolve 시점엔 이 요청이 저장돼 있다
        void snapshotQueue?.flushAll().then(() => {
          post({
            type: "snapshotSaved",
            snapshotId: `snap:${worldKey}:${branchId}:${tick}`,
            tick,
            branchId,
          });
        });
      }
      break;
    case "listEventTemplates":
      if (!engine) break;
      {
        // 개입(사건 직접 발생) 대상 — 런타임 레지스트리 기준 (격리 제외·LLM 등록 포함)
        const templates = [...engine.eventEngine.registry.values()]
          .filter((t) => t.kind === "effect" && t.scope === "settlement")
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((t) => ({ id: t.id, name: t.name }));
        post({ type: "eventTemplateList", templates });
      }
      break;
    case "listSnapshots":
      void (async () => {
        await openStorage();
        const snapshots = await store.listSnapshots(worldKey);
        post({
          type: "snapshotList",
          snapshots: snapshots.map((s) => ({ id: s.id, tick: s.tick, branchId: s.branchId, label: s.label })),
        });
      })();
      break;
    case "listBranches":
      void (async () => {
        await openStorage();
        const branches = await store.listBranches(worldKey);
        post({
          type: "branchList",
          branches: branches.map((b) => ({
            id: b.id,
            name: b.name,
            parentBranchId: b.parentBranchId,
            createdAtTick: b.createdAtTick,
          })),
        });
      })();
      break;
    case "restoreSnapshot":
      void (async () => {
        await openStorage();
        if (!engine) return;
        const record = await store.getSnapshot(request.snapshotId);
        if (!record) {
          post({ type: "systemStatus", level: "warning", code: "snapshot_missing", message: "스냅숏을 찾을 수 없습니다" });
          return;
        }
        try {
          let branchId = record.branchId;
          if (request.asBranch) {
            const existing = await store.listBranches(worldKey);
            branchId = `branch:${record.tick}:${existing.length + 1}`;
            await store.putBranch({
              id: branchId,
              worldId: worldKey,
              parentBranchId: record.branchId,
              parentSnapshotId: record.id,
              name: request.name ?? `분기 ${existing.length + 1}`,
              createdAtTick: record.tick,
            });
          }
          const restored = buildBranchState({
            snapshot: record.data,
            base: { config: engine.state.config, map: engine.state.map },
            branchId,
            llmPolicy: request.llmPolicy as LLMPolicy,
          });
          engine = new SimulationEngine(restored);
          batcher = new TickBatcher(100);
          pendingStats = [];
          pendingNotices = [];
          speed = 0;
          paused = true;
          emitTickBatch(engine.state.clock.currentTick, engine.state.clock.currentTick);
          post({ type: "worldRestored", branchId, tick: engine.state.clock.currentTick });
        } catch (error) {
          post({
            type: "systemStatus",
            level: "error",
            code: "snapshot_corrupt",
            message: `복원 실패 — ${error instanceof Error ? error.message : "알 수 없음"} (§28.6)`,
          });
        }
      })();
      break;
    case "compareSnapshots":
      void (async () => {
        await openStorage();
        const a = await store.getSnapshot(request.snapshotAId);
        const b = await store.getSnapshot(request.snapshotBId);
        if (!a || !b) {
          post({ type: "systemStatus", level: "warning", code: "compare_missing", message: "비교할 스냅숏이 없습니다" });
          return;
        }
        post({ type: "branchComparison", comparison: compareSnapshots(a, b) });
      })();
      break;
    case "requestLLM":
      if (!engine) break;
      // §18 요약 + §23 입력 해시 + 중복 검사용 등록 이름 목록 (LLM은 UI 게이트웨이가 담당)
      {
        const input = summarizeForLLM(engine.state);
        const chain =
          request.mode === "chain" && request.eventId
            ? (() => {
                const context = summarizeChainContext(
                  engine!.state,
                  engine!.eventEngine.registry,
                  request.eventId!,
                );
                return context
                  ? { context, contextHash: computeChainContextHash(context) }
                  : undefined;
              })()
            : undefined;
        if (request.mode === "chain" && !chain) {
          // 문맥 생성 실패 — 일반 추천 요청으로 위장해 보내지 않는다 (UI 상태 머신 보호)
          post({
            type: "systemStatus",
            level: "info",
            code: "llm_chain_no_context",
            message: "연쇄 문맥을 만들 수 없습니다 — 진행 중인 사건을 선택하세요",
          });
          break;
        }
        post({
          type: "llmRequest",
          input,
          inputHash: computeInputHash(input),
          registeredNames: [...registeredTemplateNames(engine.eventEngine.registry)],
          tick: engine.state.clock.currentTick,
          chain,
        });
      }
      break;
    case "registerChainTemplate":
      if (!engine) break;
      {
        const result = registerChainTemplate(engine.state, engine.eventEngine, {
          template: request.template,
          scheduled: request.scheduled,
          inputHash: request.inputHash,
          rawOutput: request.rawOutput,
          provider: request.provider,
          model: request.model,
          promptVersion: request.promptVersion,
          approvedBy: request.approvedBy,
          usage: request.usage,
        });
        if (result.ok) {
          post({ type: "llmRegistered", ok: true, templateId: result.templateId });
        } else {
          post({ type: "systemStatus", level: "warning", code: "llm_register_rejected", message: result.reason ?? "등록 거부" });
          post({ type: "llmRegistered", ok: false, reason: result.reason });
        }
      }
      break;
    case "registerLLMTemplate":
      if (!engine) break;
      {
        const result = registerLLMTemplate(engine.state, engine.eventEngine, {
          template: request.template,
          inputHash: request.inputHash,
          rawOutput: request.rawOutput,
          provider: request.provider,
          model: request.model,
          promptVersion: request.promptVersion,
        });
        if (result.ok) {
          post({ type: "llmRegistered", ok: true, templateId: result.templateId });
        } else {
          post({ type: "systemStatus", level: "warning", code: "llm_register_rejected", message: result.reason ?? "등록 거부" });
          post({ type: "llmRegistered", ok: false, reason: result.reason });
        }
      }
      break;
    default: {
      const exhaustive: never = request;
      void exhaustive;
    }
  }
};
