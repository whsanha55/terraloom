"use client";

import { Dices } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { computeLandRatio } from "@/world/generation/elevation";
import { generateWorld, type WorldGenResult } from "@/world/generation/generator";
import { renderElevationRGBA } from "@/world/rendering/elevationRender";

const RESOLUTIONS = [256, 512] as const;

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
  const [world, setWorld] = useState<GenerationState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const generate = useCallback(() => {
    const effectiveSeed = seed.trim() === "" ? randomSeed() : seed.trim();
    const result = generateWorld({ seed: effectiveSeed, resolution, cityRadius: 3 });
    setWorld({ ...result, seed: effectiveSeed });
    if (seed.trim() === "") setSeed(effectiveSeed); // 자동 생성 시드 표시
  }, [seed, resolution]);

  // 지도 렌더링 — 결과 또는 해수면 변경 시 즉시 재판정(Step 2 완료 조건)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgba = renderElevationRGBA(
      world.map.elevation,
      world.map.width,
      world.map.height,
      seaLevel,
    );
    canvas.width = world.map.width;
    canvas.height = world.map.height;
    const imageData = ctx.createImageData(world.map.width, world.map.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
  }, [world, seaLevel]);

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
          onChange={(e) => setSeaLevel(Number(e.target.value))}
          className="mt-xs w-full accent-primary"
        />
      </label>

      {world ? (
        <>
          <p
            className="mt-lg flex flex-wrap items-center gap-x-md gap-y-xs text-text-muted"
            data-testid="world-stats"
          >
            <span>
              육지{" "}
              <span data-testid="land-ratio" className="font-numeric tnum font-medium text-text">
                {Math.round((landRatio ?? 0) * 100)}%
              </span>
            </span>
            <span className="font-numeric tnum">
              시도 {world.attempts}/5{world.attempts > 1 ? " (재구성)" : ""}
            </span>
            {world.seaLevelCompensated && (
              <span className="rounded-full bg-[#FFF7ED] px-sm py-1 font-medium text-warning">
                해수면 보정됨
              </span>
            )}
          </p>
          <canvas
            ref={canvasRef}
            aria-label="고도 지도"
            className="mt-md w-full rounded-md border border-border [image-rendering:pixelated]"
          />
        </>
      ) : (
        <p className="mt-lg text-text-muted">
          시드를 입력하고 세계를 생성해보세요. 같은 시드는 항상 같은 세계를 만듭니다.
        </p>
      )}
    </section>
  );
}
