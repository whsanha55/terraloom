import { expect, test } from "@playwright/test";

async function generateWorld(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-food");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 1년 1월");
}

test("1년 진행 후 인구·식량 차트가 채워진다", async ({ page }) => {
  await generateWorld(page);
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 2년 1월");
  await expect(page.getByTestId("chart-population")).toBeVisible();
  await expect(page.getByTestId("chart-foodstock")).toBeVisible();
});

test("인구가 변화한다 (출생·사망 반영)", async ({ page }) => {
  await generateWorld(page);
  const initial = await page.getByTestId("total-population").textContent();
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect
    .poll(async () => page.getByTestId("total-population").textContent())
    .not.toBe(initial!);
});
