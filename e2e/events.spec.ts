import { expect, test } from "@playwright/test";

/** e2e-events 시드는 36틱(3년) 내 풍년·홍수·가뭄 등 7건이 확정적으로 발생한다 (결정론) */
test("시간을 진행하면 사건 로그에 기록되고 대형 사건이 자동 정지한다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-events");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  for (let year = 0; year < 3; year++) {
    await page.getByRole("button", { name: "1년", exact: true }).click();
  }

  const log = page.getByTestId("event-log");
  await expect(log).toBeVisible();
  const entries = await log.locator("li").count();
  expect(entries).toBeGreaterThan(0);

  // 가뭄(중요도 80)이 이 시드에서 발생 — 자동 정지 배너 표시
  await expect(page.getByTestId("major-event-banner")).toContainText("사건 정지");
});
