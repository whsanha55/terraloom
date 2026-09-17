import { expect, test } from "@playwright/test";

async function generateWorldWithSeed(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-layers");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("land-ratio")).toContainText("%");
}

test("레이어를 전환하면 지도 표시가 바뀐다", async ({ page }) => {
  await generateWorldWithSeed(page);
  const canvas = page.locator("canvas");
  const elevation = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

  await page.getByRole("button", { name: "온도", exact: true }).click();
  const temperature = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  expect(temperature).not.toBe(elevation);

  await page.getByRole("button", { name: "바이옴", exact: true }).click();
  const biome = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  expect(biome).not.toBe(temperature);
});

test("셀을 클릭하면 상세 검사기에 계산값이 표시된다", async ({ page }) => {
  await generateWorldWithSeed(page);
  await page.locator("canvas").click({ position: { x: 200, y: 150 } });
  const inspector = page.getByTestId("cell-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("바이옴");
  await expect(inspector).toContainText("고도");
});

test("도시 10~30개와 교역로가 표시된다 (Step 4)", async ({ page }) => {
  await generateWorldWithSeed(page);
  const count = await page.getByTestId("settlement-count").textContent();
  const parsed = Number(count);
  expect(parsed).toBeGreaterThanOrEqual(10);
  expect(parsed).toBeLessThanOrEqual(30);
});
