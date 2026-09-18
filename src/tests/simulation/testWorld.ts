import type { SettlementState, WorldState } from "@/simulation/core/worldState";
import { ChangeLedger } from "@/simulation/systems/ledger";
import { Biome } from "@/world/generation/biome";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import { createWorldMap } from "@/world/model/worldMap";
import { BIOME_COUNT } from "@/world/model/territory";
import { SIMULATION_VERSION } from "@/world/model/version";

function grasslandCounts(): number[] {
  const counts = new Array<number>(BIOME_COUNT).fill(0);
  counts[Biome.Grassland] = 7;
  return counts;
}

export function makeSettlement(
  overrides: Partial<SettlementState> & { id: string },
): SettlementState {
  return {
    name: overrides.id,
    x: 1,
    y: 1,
    status: "active",
    population: 5000,
    carryingCapacity: 10000,
    foodProduction: 0,
    foodConsumption: 0,
    foodStock: 15000,
    foodPriceIndex: 1,
    waterSupply: 0,
    stability: 70,
    diseaseLevel: 0,
    migrationPressure: 0,
    connectedSettlementIds: [],
    activeEventIds: [],
    areaFertility: 0.6,
    areaRiverVolume: 0,
    areaBiomeCounts: grasslandCounts(),
    unmetRatio: 0,
    foodMonthsRemaining: 3,
    ...overrides,
  };
}

export function makeWorld(
  settlements: SettlementState[],
  routePairs: Array<[string, string]> = [],
  seed = "test",
): WorldState {
  const settlementRecord: Record<string, SettlementState> = {};
  for (const settlement of settlements) {
    settlementRecord[settlement.id] = settlement;
  }
  const routes: WorldState["routes"] = {};
  for (const [a, b] of routePairs) {
    const id = `route:${a}-${b}`;
    routes[id] = { id, settlementIds: [a, b] };
    settlementRecord[a]?.connectedSettlementIds.push(b);
    settlementRecord[b]?.connectedSettlementIds.push(a);
  }
  let totalPopulation = 0;
  let totalFoodStock = 0;
  for (const settlement of settlements) {
    totalPopulation += settlement.population;
    totalFoodStock += settlement.foodStock;
  }
  const config = createDefaultWorldConfig(seed);
  config.resolution = 4;
  return {
    id: `world:${seed}`,
    name: seed,
    seed,
    generatorVersion: "test",
    simulationVersion: SIMULATION_VERSION,
    clock: { currentTick: 0, year: 0, month: 0, speed: 1, paused: true },
    config,
    map: createWorldMap(4, 4),
    settlements: settlementRecord,
    routes,
    activeEvents: [],
    scheduledEvents: [],
    eventHistory: [],
    globalStatistics: { totalPopulation: [totalPopulation], totalFoodStock: [totalFoodStock] },
    changeLedger: new ChangeLedger(),
  };
}
