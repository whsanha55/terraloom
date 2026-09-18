import { expect, test } from "@playwright/test";

test("개입 → 기록·예산 차감 → 분기 비교로 효과 확인 (Step 14)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-branch3");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  const panel = page.getByTestId("intervention-panel");
  await expect(panel).toBeVisible();
  const pointsBefore = Number(await page.getByTestId("intervention-points").textContent());

  // 1년 진행 후 긴급 식량 지원 3개월
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 2년 1월");
  await page.getByTestId("intervention-type").selectOption("foodAid");
  await page.getByTestId("intervention-months").fill("3");
  await page.getByTestId("intervention-run").click();

  // 적용 확인 배너 — §27.6 확인 문구 + 예산 차감
  const log = page.getByTestId("intervention-log");
  await expect(log.locator("li").first()).toBeVisible({ timeout: 10_000 });
  await expect(log.locator("li").first()).toContainText("적용됨");
  const pointsAfter = Number(await page.getByTestId("intervention-points").textContent());
  expect(pointsAfter).toBe(pointsBefore - 300); // 100 × 3개월

  // 사건 직접 발생 — 세계 편집 (§24.3)
  await page.getByTestId("intervention-type").selectOption("triggerEvent");
  await page.getByTestId("intervention-template").selectOption("flood");
  await page.getByTestId("intervention-run").click();
  await expect(log.locator("li").first()).toContainText("홍수", { timeout: 10_000 });

  // what-if — 개입 후 시간 진행 → 저장 → 분기 비교로 원본과 차이 확인
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await page.getByTestId("save-button").click();
  await page.getByRole("button", { name: "목록 갱신" }).click();
  await page.getByTestId("compare-button").click();
  const table = page.getByTestId("branch-comparison");
  await expect(table).toBeVisible({ timeout: 10_000 });
  await expect(table).toContainText("총인구");
});
