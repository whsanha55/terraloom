import { describe, expect, it } from "vitest";
import { TickBatcher } from "@/simulation/core/scheduler";

describe("TickBatcher (tickBatch 쓰로틀 초당 10회 §9.5)", () => {
  it("첫 틱은 즉시 배출된다", () => {
    const batcher = new TickBatcher(100);
    expect(batcher.onTick(0, 0)).toEqual({ fromTick: 0, toTick: 0 });
  });

  it("최소 간격(100ms) 미만의 틱들은 하나의 배치로 통합된다", () => {
    const batcher = new TickBatcher(100);
    expect(batcher.onTick(0, 0)).toEqual({ fromTick: 0, toTick: 0 });
    expect(batcher.onTick(1, 10)).toBeNull();
    expect(batcher.onTick(2, 30)).toBeNull();
    expect(batcher.onTick(3, 60)).toBeNull();
    expect(batcher.onTick(4, 100)).toEqual({ fromTick: 1, toTick: 4 });
  });

  it("100배속에서도 초당 최대 10회만 배출된다", () => {
    const batcher = new TickBatcher(100);
    let flushed = 0;
    // 1초간 20ms 간격 50틱 (100배속)
    for (let t = 0; t < 1000; t += 20) {
      if (batcher.onTick(t / 20, t)) flushed++;
    }
    expect(flushed).toBeLessThanOrEqual(10);
  });

  it("flush()는 보류 중 배치를 즉시 배출한다 (단계 진행 피드백)", () => {
    const batcher = new TickBatcher(100);
    batcher.onTick(0, 0);
    expect(batcher.onTick(1, 5)).toBeNull();
    expect(batcher.flush(5)).toEqual({ fromTick: 1, toTick: 1 });
    expect(batcher.flush(6)).toBeNull(); // 보류 없음
  });
});
