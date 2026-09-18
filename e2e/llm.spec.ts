import { expect, test } from "@playwright/test";

test("LLM 추천(모의 제공자) → 후보 표시 → 승인 → 등록 (Step 11)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-llm");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  const panel = page.getByTestId("llm-panel");
  await expect(panel).toBeVisible();

  // 수동 추천 요청 — 모의 제공자(기본)는 API 키 없이 동작한다
  await page.getByTestId("llm-request-button").click();
  const candidates = page.getByTestId("llm-candidates").locator("> li");
  await expect(candidates.first()).toBeVisible();
  const count = await candidates.count();
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(5);

  // 승인 — 사용자가 승인한 사건만 템플릿으로 등록된다
  await candidates.first().getByRole("button", { name: "승인" }).click();
  await expect(candidates.first().getByTestId(/llm-approved-/)).toBeVisible();
  await expect(candidates.first()).toContainText("발생 여부는 규칙 엔진이 결정");

  // 시뮬레이션은 계속 정상 동작 — 승인 후에도 시간 진행 가능
  await page.getByRole("button", { name: "1개월" }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력");
});
