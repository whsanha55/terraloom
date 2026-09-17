/**
 * 도시 배치와 기본 연결망 (Step 4).
 *
 * 입지 점수 = 비옥도 + 강 인접 보너스 + 해안 보너스 (§ 완료 조건:
 * "도시가 바다, 강, 비옥한 평야 주변에 주로 생성됨").
 * 그리디 배치(점수 내림차순, 동률은 인덱스) + 최소 거리 제한.
 * 연결망은 MST(프림) — n-1 간선으로 전체 연결. 모두 결정론적.
 */
import { SIMULATION_VERSION } from "@/world/model/version";
import type { WorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";
import { createRng } from "@/world/random/rng";
import { deriveSeed } from "@/world/random/seed";

/** 정규화 유량이 이 값 이상인 셀을 강으로 본다 */
export const RIVER_VOLUME_THRESHOLD = 0.015;

const RIVER_BONUS = 0.25;
const COAST_BONUS = 0.2;
const NAME_SYLLABLES = [
  "아",
  "라",
  "렌",
  "카",
  "린",
  "벨",
  "도",
  "르",
  "미",
  "타",
  "세",
  "노",
  "바",
  "제",
  "오",
  "스",
  "펜",
  "하",
  "모",
  "크",
  "우",
  "질",
  "테",
  "안",
] as const;

export interface SettlementGen {
  id: string;
  name: string;
  x: number;
  y: number;
  score: number;
}

export interface RouteGen {
  id: string;
  settlementIds: [string, string];
}

export interface SettlementPlacement {
  settlements: SettlementGen[];
  routes: RouteGen[];
}

function generateName(rng: ReturnType<typeof createRng>, used: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const syllableCount = rng.nextInt(2, 4); // 2~3음절
    let name = "";
    for (let i = 0; i < syllableCount; i++) {
      name += NAME_SYLLABLES[rng.nextInt(0, NAME_SYLLABLES.length)];
    }
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `정착지-${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function isCoastal(map: WorldMap, index: number, seaLevel: number): boolean {
  const { width, height, elevation } = map;
  const x = index % width;
  const y = (index - (index % width)) / width;
  if (x > 0 && elevation[index - 1] < seaLevel) return true;
  if (x < width - 1 && elevation[index + 1] < seaLevel) return true;
  if (y > 0 && elevation[index - width] < seaLevel) return true;
  if (y < height - 1 && elevation[index + width] < seaLevel) return true;
  return false;
}

/** 프림 알고리즘으로 MST 간선을 만든다 — 동률은 (거리, id 쌍) 순 */
function buildRoutes(settlements: SettlementGen[]): RouteGen[] {
  const n = settlements.length;
  if (n < 2) return [];
  const inTree = new Uint8Array(n);
  const bestDistance = new Float64Array(n).fill(Infinity);
  const bestFrom = new Int32Array(n).fill(-1);
  inTree[0] = 1;
  for (let i = 1; i < n; i++) {
    const dx = settlements[0].x - settlements[i].x;
    const dy = settlements[0].y - settlements[i].y;
    bestDistance[i] = dx * dx + dy * dy;
    bestFrom[i] = 0;
  }
  const routes: RouteGen[] = [];
  for (let edge = 0; edge < n - 1; edge++) {
    let candidate = -1;
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      if (candidate === -1 || bestDistance[i] < bestDistance[candidate]) {
        candidate = i;
      }
    }
    inTree[candidate] = 1;
    const from = bestFrom[candidate];
    const ids: [string, string] =
      settlements[from].id < settlements[candidate].id
        ? [settlements[from].id, settlements[candidate].id]
        : [settlements[candidate].id, settlements[from].id];
    routes.push({ id: `route:${ids[0]}-${ids[1]}`, settlementIds: ids });
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const dx = settlements[candidate].x - settlements[i].x;
      const dy = settlements[candidate].y - settlements[i].y;
      const d = dx * dx + dy * dy;
      if (d < bestDistance[i]) {
        bestDistance[i] = d;
        bestFrom[i] = candidate;
      }
    }
  }
  return routes;
}

export function placeSettlements(
  map: WorldMap,
  config: WorldConfig,
  seaLevel: number,
  attempt: number,
): SettlementPlacement {
  const rng = createRng(
    deriveSeed({
      worldSeed: config.seed,
      simulationVersion: SIMULATION_VERSION,
      systemName: "worldgen.settlements",
      purpose: `attempt:${attempt}`,
    }),
  );

  const { width, height } = map;
  const minDistance = Math.max(8, Math.floor(Math.max(width, height) / 16));
  const minDistance2 = minDistance * minDistance;

  // 육지 후보를 입지 점수 내림차순으로 정렬 (동률은 인덱스 — 결정론)
  const candidates: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (map.elevation[i] >= seaLevel) candidates.push(i);
  }
  const scoreOf = (i: number): number => {
    let score = map.fertility[i];
    if (map.riverVolume[i] >= RIVER_VOLUME_THRESHOLD) score += RIVER_BONUS;
    if (isCoastal(map, i, seaLevel)) score += COAST_BONUS;
    return score;
  };
  candidates.sort((a, b) => {
    const sa = scoreOf(b);
    const sb = scoreOf(a);
    if (sa !== sb) return sa - sb; // 내림차순
    return a - b;
  });

  const picked: number[] = [];
  for (const candidate of candidates) {
    if (picked.length >= config.settlementCount) break;
    const cx = candidate % width;
    const cy = (candidate - (candidate % width)) / width;
    let tooClose = false;
    for (const existing of picked) {
      const ex = existing % width;
      const ey = (existing - (existing % width)) / width;
      const dx = cx - ex;
      const dy = cy - ey;
      if (dx * dx + dy * dy < minDistance2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) picked.push(candidate);
  }

  const usedNames = new Set<string>();
  const settlements: SettlementGen[] = picked.map((index, order) => ({
    id: `settlement:${order}`,
    name: generateName(rng, usedNames),
    x: index % width,
    y: (index - (index % width)) / width,
    score: scoreOf(index),
  }));

  return { settlements, routes: buildRoutes(settlements) };
}
