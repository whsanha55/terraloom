import { expect, test } from "@playwright/test";

async function generateWorld(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-time");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 1년 1월");
}

test("재생하면 세계력이 흐른다 (1배속 = 2초/틱)", async ({ page }) => {
  await generateWorld(page);
  await page.getByRole("button", { name: "재생" }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 1년 2월", {
    timeout: 5000,
  });
});

test("일시 정지하면 시간이 멈춘다", async ({ page }) => {
  await generateWorld(page);
  await page.getByRole("button", { name: "재생" }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 1년 2월", {
    timeout: 5000,
  });
  await page.getByRole("button", { name: "일시 정지" }).click();
  const paused = await page.getByTestId("world-clock").textContent();
  await page.waitForTimeout(1500);
  const still = await page.getByTestId("world-clock").textContent();
  expect(still).toBe(paused);
});

test("1년 진행은 정확히 12틱을 진행한다", async ({ page }) => {
  await generateWorld(page);
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 2년 1월");
});

test("배속을 전환할 수 있다", async ({ page }) => {
  await generateWorld(page);
  await page.getByRole("button", { name: "100x" }).click();
  await expect(page.getByRole("button", { name: "100x" })).toHaveAttribute("aria-pressed", "true");
  // 100배속은 빠르게 지나가므로 특정 연도가 아니라 '시간이 흐름'을 검증
  await expect
    .poll(async () => {
      const text = await page.getByTestId("world-clock").textContent();
      return Number(text!.match(/세계력 (\d+)년/)?.[1] ?? "1");
    })
    .toBeGreaterThan(1);
});
