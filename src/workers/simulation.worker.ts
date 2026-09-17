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
import { generateWorld } from "@/world/generation/generator";
import type { Season, SimNotification, SimRequest, SimSpeed, WorldSummary } from "./protocol";

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
let timer: ReturnType<typeof setTimeout> | null = null;
let speed: SimSpeed = 1;
let paused = true;

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
  for (const settlement of Object.values(engine.state.settlements)) {
    if (settlement.status === "active") totalPopulation += settlement.population;
  }
  return {
    tick: clock.currentTick,
    year: clock.year,
    month: clock.month,
    season: seasonOf(clock.month),
    totalPopulation,
    paused,
    speed,
  };
}

function emitTickBatch(fromTick: number, toTick: number): void {
  post({ type: "tickBatch", fromTick, toTick, summary: buildSummary(), changes: [] });
}

function runTicks(count: number): void {
  if (!engine) return;
  const now = performance.now();
  for (let i = 0; i < count; i++) {
    engine.tick();
    const batch = batcher.onTick(engine.state.clock.currentTick, now);
    if (batch) {
      emitTickBatch(batch.fromTick, batch.toTick);
    }
  }
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

function handleInit(request: Extract<SimRequest, { type: "init" }>): void {
  const gen = generateWorld(request.config, { seaLevel: request.seaLevel });
  engine = new SimulationEngine(initializeWorldState(gen));
  batcher = new TickBatcher(100);
  speed = 1;
  paused = true;
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
    default:
      post({
        type: "systemStatus",
        level: "info",
        code: "not_implemented",
        message: `요청 ${request.type}은 이후 Step에서 구현됩니다`,
      });
  }
};
