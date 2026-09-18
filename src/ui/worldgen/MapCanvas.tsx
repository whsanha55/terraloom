"use client";

import { useEffect, useRef } from "react";
import type { RouteGen, SettlementGen } from "@/world/generation/settlements";
import type { WorldMap } from "@/world/model/worldMap";
import type { MigrationFlow, SettlementSnapshot } from "@/workers/protocol";
import { renderElevationRGBA } from "@/world/rendering/elevationRender";
import { renderBiomeRGBA, renderScalarRGBA } from "@/world/rendering/layerRender";
import { crisisLevel, CRISIS_COLORS, eventMarkerColor } from "@/ui/map/crisis";

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
  /** 선택 도시 — 링 강조 (DESIGN.md map-marker-selected) */
  selectedSettlementId?: string | null;
  onSelectCell?: (cell: { x: number; y: number }) => void;
  /** 도시 마커 클릭 — 셀 클릭보다 우선한다 */
  onSelectSettlement?: (settlementId: string) => void;
}

export function MapCanvas({
  map,
  seaLevel,
  layer,
  settlements,
  routes,
  live,
  migrations,
  selectedSettlementId,
  onSelectCell,
  onSelectSettlement,
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

      // 도시 = 원, 면적 ∝ 인구 (DESIGN.md). 채움색은 식량 위기 수준(§26 위험은 주황·빨강).
      // 폐허는 중립 흔적(§8.2). 활성 사건은 위험도색 다이아몬드로 오버레이.
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
        ctx.fillStyle = CRISIS_COLORS[crisisLevel(snapshot?.foodMonthsRemaining ?? 99)];
        ctx.strokeStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 선택 링 — 모든 상태에서 동일 방식 (DESIGN.md map-marker-selected)
        if (settlement.id === selectedSettlementId) {
          ctx.strokeStyle = "#2563EB";
          ctx.lineWidth = Math.max(1.5, scale * 2.5);
          ctx.beginPath();
          ctx.arc(cx, cy, radius + Math.max(1.5, scale * 2), 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = Math.max(1, scale);
        }

        // 활성 사건 다이아몬드 (DESIGN.md — 사건 = 위험도색 다이아몬드)
        const maxImportance = snapshot?.activeEvents?.reduce(
          (max, e) => Math.max(max, e.importance),
          0,
        );
        if (maxImportance && maxImportance > 0) {
          const size = Math.max(2.5, scale * 3);
          ctx.fillStyle = eventMarkerColor(maxImportance);
          ctx.beginPath();
          ctx.moveTo(cx + size, cy - radius - size);
          ctx.lineTo(cx + size * 2, cy - radius);
          ctx.lineTo(cx + size, cy - radius + size);
          ctx.lineTo(cx, cy - radius);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = Math.max(0.75, scale * 0.75);
          ctx.stroke();
          ctx.lineWidth = Math.max(1, scale);
        }
      }
    }
  }, [map, seaLevel, layer, settlements, routes, live, migrations, selectedSettlementId]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
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
    // 도시 마커 클릭이 셀 검사보다 우선한다 (§27.4 도시 상세 진입)
    if (onSelectSettlement) {
      const scale = map.width / 256;
      let nearest: { id: string; distance2: number } | null = null;
      for (const settlement of settlements) {
        const live0 = live?.[settlement.id];
        if (live0?.status === "ruined") continue;
        const dx = settlement.x + 0.5 - x;
        const dy = settlement.y + 0.5 - y;
        const distance2 = dx * dx + dy * dy;
        const threshold = Math.max(3, 7 * scale + 2);
        if (distance2 <= threshold * threshold && (!nearest || distance2 < nearest.distance2)) {
          nearest = { id: settlement.id, distance2 };
        }
      }
      if (nearest) {
        onSelectSettlement(nearest.id);
        return;
      }
    }
    onSelectCell?.({ x, y });
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
