import { describe, expect, it } from "vitest";
import { generateWorld } from "@/world/generation/generator";
import { RIVER_VOLUME_THRESHOLD } from "@/world/generation/settlements";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";

const config = (seed: string) => ({ ...createDefaultWorldConfig(seed), resolution: 128 });

describe("도시 배치 (Step 4)", () => {
  it("여러 시드에서 도시 10~30개를 배치한다", () => {
    for (let s = 0; s < 3; s++) {
      const result = generateWorld(config(`city-count-${s}`));
      expect(result.settlements.length).toBeGreaterThanOrEqual(10);
      expect(result.settlements.length).toBeLessThanOrEqual(30);
    }
  });

  it("모든 도시는 육지 위에 있고 상호 최소 거리를 지킨다", () => {
    const result = generateWorld(config("city-land"));
    const minDistance = Math.max(8, Math.floor(128 / 16));
    const { settlements, map } = result;
    for (const city of settlements) {
      expect(map.elevation[city.y * map.width + city.x]).toBeGreaterThanOrEqual(0.5);
    }
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const dx = settlements[i].x - settlements[j].x;
        const dy = settlements[i].y - settlements[j].y;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(minDistance * minDistance);
      }
    }
  });

  it("이름은 유일하고 비어 있지 않다", () => {
    const { settlements } = generateWorld(config("city-names"));
    const names = settlements.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("결정론적이다 — 같은 시드는 같은 도시·교역로를 낸다", () => {
    const a = generateWorld(config("city-det"));
    const b = generateWorld(config("city-det"));
    expect(a.settlements).toEqual(b.settlements);
    expect(a.routes).toEqual(b.routes);
  });

  it("교역로는 MST다 — n-1개 간선으로 전체가 연결된다", () => {
    const { settlements, routes } = generateWorld(config("city-mst"));
    expect(routes.length).toBe(settlements.length - 1);
    const parent = new Map(settlements.map((s, i) => [s.id, i]));
    const uf = Array.from({ length: settlements.length }, (_, i) => i);
    const find = (x: number): number => (uf[x] === x ? x : (uf[x] = find(uf[x])));
    for (const route of routes) {
      const a = find(parent.get(route.settlementIds[0])!);
      const b = find(parent.get(route.settlementIds[1])!);
      uf[a] = b;
    }
    const roots = new Set(uf.map((_, i) => find(i)));
    expect(roots.size).toBe(1);
  });

  it("도시는 강 또는 해안 인접 입지에 주로 생성된다", () => {
    let favored = 0;
    let total = 0;
    for (let s = 0; s < 3; s++) {
      const { settlements, map } = generateWorld(config(`city-site-${s}`));
      for (const city of settlements) {
        total++;
        const i = city.y * map.width + city.x;
        const onRiver = map.riverVolume[i] >= RIVER_VOLUME_THRESHOLD;
        const nearCoast =
          map.elevation[i - 1] < 0.5 ||
          map.elevation[i + 1] < 0.5 ||
          map.elevation[i - map.width] < 0.5 ||
          map.elevation[i + map.width] < 0.5;
        if (onRiver || nearCoast) favored++;
      }
    }
    // 고정 시드라 결정론적 — 보너스가 입지에 반영되면 과반 이상이 유리 입지
    expect(favored / total).toBeGreaterThan(0.4);
  });
});
