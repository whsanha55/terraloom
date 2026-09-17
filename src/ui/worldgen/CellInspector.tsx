import { BIOME_INFO, type Biome } from "@/world/generation/biome";
import type { WorldMap } from "@/world/model/worldMap";

interface CellInspectorProps {
  map: WorldMap;
  cell: { x: number; y: number };
  seaLevel: number;
}

/** 선택 셀의 계산값 확인 (Step 3 — 셀 상세 검사기) */
export function CellInspector({ map, cell, seaLevel }: CellInspectorProps) {
  const index = cell.y * map.width + cell.x;
  const biome = BIOME_INFO[map.biome[index] as Biome];
  const isLand = map.elevation[index] >= seaLevel;

  const rows: Array<{ label: string; value: string }> = [
    { label: "좌표", value: `(${cell.x}, ${cell.y})` },
    { label: "고도", value: map.elevation[index].toFixed(3) },
    { label: "온도", value: map.temperature[index].toFixed(3) },
    { label: "습도", value: map.moisture[index].toFixed(3) },
    { label: "비옥도", value: map.fertility[index].toFixed(3) },
    { label: "강 유량", value: map.riverVolume[index].toFixed(3) },
    { label: "바이옴", value: biome?.name ?? "알 수 없음" },
    { label: "구분", value: isLand ? "육지" : "바다" },
  ];

  return (
    <div
      data-testid="cell-inspector"
      className="mt-md rounded-md border border-border bg-accent p-md"
    >
      <p className="font-medium text-text">셀 상세</p>
      <dl className="mt-xs grid grid-cols-2 gap-x-lg gap-y-xs sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="font-numeric tnum text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
