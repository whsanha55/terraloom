"use client";

import { useEffect, useRef } from "react";
import type { RouteGen, SettlementGen } from "@/world/generation/settlements";
import type { WorldMap } from "@/world/model/worldMap";
import type { MigrationFlow, SettlementSnapshot } from "@/workers/protocol";
import { renderElevationRGBA } from "@/world/rendering/elevationRender";
import { renderBiomeRGBA, renderScalarRGBA } from "@/world/rendering/layerRender";

export type MapLayer = "elevation" | "temperature" | "moisture" | "biome";

const TEMPERATURE_RAMP = {
  low: [49, 46, 129], // 한랭
  mid: [33, 145, 140],
  high: [253, 231, 97], // 고온
} as const;

const MOISTURE_RAMP = {
  low: [253, 231, 97], // 건조
  mid: [141, 148, 82],
  high: [33, 144, 141], // 습윤
} as const;

interface MapCanvasProps {
  map: WorldMap;
  seaLevel: number;
  layer: MapLayer;
  settlements: SettlementGen[];
  routes: RouteGen[];
  /** 라이브 도시 상태 (인구·폐허 여부) — 도착 전까지 정적 표시 */
  live?: Record<string, SettlementSnapshot>;
  /** 직전 틱 이주 흐름 — 파란 화살표 (DESIGN.md map-path-migration) */
  migrations?: MigrationFlow[];
  onSelectCell?: (cell: { x: number; y: number }) => void;
}

export function MapCanvas({
  map,
  seaLevel,
  layer,
  settlements,
  routes,
  live,
  migrations,
  onSelectCell,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgba =
      layer === "elevation"
        ? renderElevationRGBA(map.elevation, map.width, map.height, seaLevel)
        : layer === "temperature"
          ? renderScalarRGBA(
              map.temperature,
              map.width,
              map.height,
              TEMPERATURE_RAMP.low,
              TEMPERATURE_RAMP.mid,
              TEMPERATURE_RAMP.high,
            )
          : layer === "moisture"
            ? renderScalarRGBA(
                map.moisture,
                map.width,
                map.height,
                MOISTURE_RAMP.low,
                MOISTURE_RAMP.mid,
                MOISTURE_RAMP.high,
              )
            : renderBiomeRGBA(map.biome, map.width, map.height);

    canvas.width = map.width;
    canvas.height = map.height;
    const imageData = ctx.createImageData(map.width, map.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    // 강·도시·교역로 오버레이 — 지형 계열 레이어에만 표시(데이터 레이어는 값 그대로)
    const scale = map.width / 256;
    ctx.lineWidth = Math.max(1, scale * 1.5);
    ctx.strokeStyle = "rgba(15, 23, 42, 0.5)";
    if (layer === "elevation" || layer === "biome") {
      const byId = new Map(settlements.map((s) => [s.id, s]));
      ctx.beginPath();
      for (const route of routes) {
        const a = byId.get(route.settlementIds[0]);
        const b = byId.get(route.settlementIds[1]);
        if (!a || !b) continue;
        ctx.moveTo(a.x + 0.5, a.y + 0.5);
        ctx.lineTo(b.x + 0.5, b.y + 0.5);
      }
      ctx.stroke();

      // 이주 경로 — 항상 파란 화살표 (DESIGN.md). 각도 계산은 렌더링 전용
      // (시뮬레이션·월드젠의 허용 연산 제한 §7.1 대상 아님)
      for (const flow of migrations ?? []) {
        const from = byId.get(flow.fromId);
        const to = byId.get(flow.toId);
        if (!from || !to || flow.amount <= 0) continue;
        const x1 = from.x + 0.5;
        const y1 = from.y + 0.5;
        const x2 = to.x + 0.5;
        const y2 = to.y + 0.5;
        const headX = x1 + (x2 - x1) * 0.75;
        const headY = y1 + (y2 - y1) * 0.75;
        ctx.strokeStyle = "#0EA5E9";
        ctx.lineWidth = Math.max(1, scale * Math.min(3, 0.8 + flow.amount / 300));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(headX, headY);
        ctx.stroke();
        const headSize = 2 + 3 * scale;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.translate(headX, headY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-headSize, headSize * 0.5);
        ctx.lineTo(-headSize, -headSize * 0.5);
        ctx.closePath();
        ctx.fillStyle = "#0EA5E9";
        ctx.fill();
        ctx.restore();
      }

      // 도시 = 파란 원, 면적 ∝ 인구 (DESIGN.md). 폐허는 중립 흔적(§8.2)
      ctx.lineWidth = Math.max(1, scale);
      for (const settlement of settlements) {
        const snapshot = live?.[settlement.id];
        const population = snapshot?.population ?? 0;
        const cx = settlement.x + 0.5;
        const cy = settlement.y + 0.5;
        if (snapshot?.status === "ruined") {
          ctx.strokeStyle = "rgba(100, 116, 139, 0.6)";
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1.5, scale * 1.5), 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const radius = Math.min(
          Math.max(Math.sqrt(Math.max(population, 1) / 3000) * 1.6 * scale, 2 * scale),
          7 * scale,
        );
        ctx.fillStyle = "#2563EB";
        ctx.strokeStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [map, seaLevel, layer, settlements, routes, live, migrations]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelectCell) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(
      map.width - 1,
      Math.max(0, Math.floor((event.clientX - rect.left) * (map.width / rect.width))),
    );
    const y = Math.min(
      map.height - 1,
      Math.max(0, Math.floor((event.clientY - rect.top) * (map.height / rect.height))),
    );
    onSelectCell({ x, y });
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      aria-label={`${layer} 지도`}
      className="mt-md w-full cursor-crosshair rounded-md border border-border [image-rendering:pixelated]"
    />
  );
}
