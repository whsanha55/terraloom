"use client";

import { Dices } from "lucide-react";
import { useCallback, useState } from "react";
import { generateClimate } from "@/world/generation/climate";
import { computeLandRatio } from "@/world/generation/elevation";
import { generateWorld, type WorldGenResult } from "@/world/generation/generator";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { CellInspector } from "./CellInspector";
import { MapCanvas, type MapLayer } from "./MapCanvas";

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

interface GenerationState extends WorldGenResult {
  seed: string;
}

export function GeneratorPanel() {
  const [seed, setSeed] = useState("");
  const [resolution, setResolution] = useState<number>(256);
  const [seaLevel, setSeaLevel] = useState(0.5);
  const [layer, setLayer] = useState<MapLayer>("elevation");
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [world, setWorld] = useState<GenerationState | null>(null);

  const generate = useCallback(() => {
    const effectiveSeed = seed.trim() === "" ? randomSeed() : seed.trim();
    const config = createDefaultWorldConfig(effectiveSeed);
    config.resolution = resolution;
    const result = generateWorld(config);
    setWorld({ ...result, seed: effectiveSeed });
    setSelectedCell(null);
    if (seed.trim() === "") setSeed(effectiveSeed); // 자동 생성 시드 표시
  }, [seed, resolution]);

  // 해수면 변경 → 기후·바이옴 즉시 재계산(고도 불변, 결정론 유지)
  const handleSeaLevelChange = (value: number) => {
    setSeaLevel(value);
    if (world) {
      const config = createDefaultWorldConfig(world.seed);
      config.resolution = resolution;
      generateClimate(world.map, config, value);
      setWorld({ ...world }); // map은 제자리 갱신 — 새 참조로 재렌더 트리거
    }
  };

  const landRatio = world ? computeLandRatio(world.map.elevation, seaLevel) : null;

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
          <div className="mt-lg flex flex-wrap items-center gap-md">
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
            seaLevel={seaLevel}
            layer={layer}
            settlements={world.settlements}
            routes={world.routes}
            onSelectCell={setSelectedCell}
          />

          {selectedCell && (
            <CellInspector map={world.map} cell={selectedCell} seaLevel={seaLevel} />
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
