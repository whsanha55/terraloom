"use client";

import { Dices } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimulationClient } from "@/simulation/client";
import { computeLandRatio } from "@/world/generation/elevation";
import type { SettlementGen, RouteGen } from "@/world/generation/settlements";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";
import type {
  MigrationFlow,
  SettlementSnapshot,
  SimSpeed,
  StatsPoint,
  WorldSummary,
} from "@/workers/protocol";
import type { EventNotice } from "@/simulation/events/engine";
import { CellInspector } from "./CellInspector";
import { MapCanvas, type MapLayer } from "./MapCanvas";
import { StatsChart } from "./StatsChart";
import { TimeControls } from "./TimeControls";

const RESOLUTIONS = [256, 512] as const;
const LAYERS: Array<{ id: MapLayer; label: string }> = [
  { id: "elevation", label: "고도" },
  { id: "temperature", label: "온도" },
  { id: "moisture", label: "습도" },
  { id: "biome", label: "바이옴" },
];

/** 시드 자체는 결정론 대상이 아니므로 crypto로 생성한다(Math.random 미사용) */
function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface WorldView {
  seed: string;
  map: WorldMap;
  settlements: SettlementGen[];
  routes: RouteGen[];
  seaLevel: number;
  attempts: number;
  seaLevelCompensated: boolean;
}

const INITIAL_SUMMARY: WorldSummary = {
  tick: 0,
  year: 0,
  month: 0,
  season: "winter",
  totalPopulation: 0,
  totalFoodStock: 0,
  migrationTotal: 0,
  paused: true,
  speed: 1,
};

export function GeneratorPanel() {
  const [seed, setSeed] = useState("");
  const [resolution, setResolution] = useState<number>(256);
  const [seaLevel, setSeaLevel] = useState(0.5);
  const [layer, setLayer] = useState<MapLayer>("elevation");
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [summary, setSummary] = useState<WorldSummary>(INITIAL_SUMMARY);
  const [stats, setStats] = useState<StatsPoint[]>([]);
  const [liveSettlements, setLiveSettlements] = useState<Record<string, SettlementSnapshot>>({});
  const [migrations, setMigrations] = useState<MigrationFlow[]>([]);
  const [eventLog, setEventLog] = useState<EventNotice[]>([]);
  const [majorEvent, setMajorEvent] = useState<EventNotice | null>(null);
  const clientRef = useRef<SimulationClient | null>(null);
  const initSeqRef = useRef(0);

  useEffect(() => {
    const client = new SimulationClient({
      onTickBatch: (notification) => {
        setSummary(notification.summary);
        setMigrations(notification.migrations);
        setLiveSettlements((prev) => {
          const next = { ...prev };
          for (const snapshot of notification.settlements) {
            next[snapshot.id] = snapshot;
          }
          return next;
        });
        if (notification.events.length > 0) {
          setEventLog((prev) => [...notification.events, ...prev].slice(0, 30));
        }
      },
      onStatsUpdate: (series) => setStats((prev) => [...prev, ...series]),
      onMajorEvent: (notice) => setMajorEvent(notice),
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const initWorld = useCallback(
    async (seedValue: string, options?: { seaLevel?: number; revealSeed?: boolean }) => {
      const client = clientRef.current;
      if (!client) return;
      const seq = ++initSeqRef.current;
      const config = createDefaultWorldConfig(seedValue);
      config.resolution = resolution;
      const payload = await client.init(config, options?.seaLevel ?? seaLevel);
      if (seq !== initSeqRef.current) return; // 이후 재요청이 있으면 폐기
      setWorld({
        seed: seedValue,
        map: payload.map,
        settlements: payload.settlements,
        routes: payload.routes,
        seaLevel: payload.seaLevel,
        attempts: payload.attempts,
        seaLevelCompensated: payload.seaLevelCompensated,
      });
      setSelectedCell(null);
      setStats([]);
      setLiveSettlements({});
      setMigrations([]);
      setEventLog([]);
      setMajorEvent(null);
      if (options?.revealSeed) setSeed(seedValue);
    },
    [resolution, seaLevel],
  );

  const generate = useCallback(() => {
    const effectiveSeed = seed.trim() === "" ? randomSeed() : seed.trim();
    void initWorld(effectiveSeed, { revealSeed: seed.trim() === "" });
  }, [initWorld, seed]);

  // 해수면 변경 → Worker에서 전체 재생성(같은 시드 → 같은 고도, 새 기후) 후 즉시 반영
  const handleSeaLevelChange = (value: number) => {
    setSeaLevel(value);
    if (world) {
      void initWorld(world.seed, { seaLevel: value });
    }
  };

  const handleSetSpeed = (speed: SimSpeed) => {
    clientRef.current?.setSpeed(speed);
  };

  const handleStep = (ticks: 1 | 12) => {
    clientRef.current?.step(ticks);
  };

  const landRatio = world ? computeLandRatio(world.map.elevation, world.seaLevel) : null;

  return (
    <section className="w-full max-w-3xl rounded-lg border border-border bg-surface p-xl shadow-panel">
      <div className="flex flex-col gap-md sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-xs block font-medium text-text-muted">세계 시드</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="비우면 무작위 생성"
            className="w-full rounded-md border border-border bg-surface px-md py-sm text-text placeholder:text-text-muted/60 focus:border-primary focus:outline-none"
          />
        </label>
        <label>
          <span className="mb-xs block font-medium text-text-muted">해상도</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-md py-sm text-text focus:border-primary focus:outline-none"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}×{r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          className="rounded-md bg-primary px-lg py-sm font-medium text-on-primary hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          세계 생성
        </button>
        <button
          type="button"
          onClick={() => setSeed(randomSeed())}
          aria-label="무작위 시드"
          title="무작위 시드"
          className="rounded-md border border-border bg-surface p-sm text-text-muted hover:bg-accent hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Dices size={16} aria-hidden />
        </button>
      </div>

      <label className="mt-lg block">
        <span className="flex items-baseline justify-between font-medium text-text-muted">
          <span>해수면</span>
          <span className="font-numeric tnum">{seaLevel.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={seaLevel}
          onChange={(e) => handleSeaLevelChange(Number(e.target.value))}
          className="mt-xs w-full accent-primary"
        />
      </label>

      {world ? (
        <>
          <TimeControls summary={summary} onSetSpeed={handleSetSpeed} onStep={handleStep} />

          {majorEvent && (
            <p
              data-testid="major-event-banner"
              className="mt-sm rounded-md bg-[#FFF7ED] px-md py-sm text-sm font-medium text-warning"
            >
              사건 정지: {majorEvent.name} — {majorEvent.targetName} (중요도{" "}
              <span className="font-numeric tnum">{majorEvent.importance}</span>) · 재생으로 계속
            </p>
          )}

          {eventLog.length > 0 && (
            <section className="mt-md" aria-label="최근 사건 로그">
              <h2 className="text-sm font-semibold text-text">최근 사건 (디버그)</h2>
              <ul data-testid="event-log" className="mt-xs max-h-40 overflow-y-auto rounded-md border border-border">
                {eventLog.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-baseline gap-md border-b border-border px-md py-xs last:border-b-0 text-sm"
                  >
                    <span className="font-numeric tnum text-text-muted">
                      {Math.floor(event.startedTick / 12) + 1}년 {(event.startedTick % 12) + 1}월
                    </span>
                    <span className="text-text">{event.name}</span>
                    <span className="text-text-muted">{event.targetName}</span>
                    <span className="font-numeric tnum ml-auto text-text-muted">
                      중요도 {event.importance}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-md flex flex-wrap items-center gap-md">
            <p className="flex flex-wrap items-center gap-x-md gap-y-xs text-text-muted">
              <span>
                육지{" "}
                <span data-testid="land-ratio" className="font-numeric tnum font-medium text-text">
                  {Math.round((landRatio ?? 0) * 100)}%
                </span>
              </span>
              <span className="font-numeric tnum">
                시도 {world.attempts}/5{world.attempts > 1 ? " (재구성)" : ""}
              </span>
              <span className="font-numeric tnum">
                도시 <span data-testid="settlement-count">{world.settlements.length}</span> · 교역로{" "}
                {world.routes.length}
              </span>
              {world.seaLevelCompensated && (
                <span className="rounded-full bg-[#FFF7ED] px-sm py-1 font-medium text-warning">
                  해수면 보정됨
                </span>
              )}
            </p>
            <div
              role="group"
              aria-label="지도 레이어"
              className="ml-auto flex overflow-hidden rounded-md border border-border"
            >
              {LAYERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={layer === item.id}
                  onClick={() => setLayer(item.id)}
                  className={
                    layer === item.id
                      ? "bg-primary px-md py-xs font-medium text-on-primary"
                      : "px-md py-xs text-text-muted hover:bg-accent hover:text-text"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <MapCanvas
            map={world.map}
            seaLevel={world.seaLevel}
            layer={layer}
            settlements={world.settlements}
            routes={world.routes}
            live={liveSettlements}
            migrations={migrations}
            onSelectCell={setSelectedCell}
          />

          <StatsChart history={stats} />

          {selectedCell && (
            <CellInspector map={world.map} cell={selectedCell} seaLevel={world.seaLevel} />
          )}
        </>
      ) : (
        <p className="mt-lg text-text-muted">
          시드를 입력하고 세계를 생성해보세요. 같은 시드는 항상 같은 세계를 만듭니다.
        </p>
      )}
    </section>
  );
}
