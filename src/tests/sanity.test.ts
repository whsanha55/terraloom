import { describe, expect, it } from "vitest";

describe("테스트 환경 (Step 0 sanity)", () => {
  it("vitest가 정상 동작한다", () => {
    expect(1 + 1).toBe(2);
  });

  it("@ 별칭이 src를 가리킨다", async () => {
    const mod = await import("@/app/page");
    expect(mod.default).toBeTypeOf("function");
  });
});
