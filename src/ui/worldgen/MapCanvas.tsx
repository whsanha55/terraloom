"use client";

import { useEffect, useRef } from "react";
import type { WorldMap } from "@/world/model/worldMap";
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
  onSelectCell?: (cell: { x: number; y: number }) => void;
}

export function MapCanvas({ map, seaLevel, layer, onSelectCell }: MapCanvasProps) {
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
  }, [map, seaLevel, layer]);

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
