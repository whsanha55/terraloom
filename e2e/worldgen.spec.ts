import { expect, test } from "@playwright/test";

test("시드를 입력하면 고도 지도가 Canvas에 표시된다 (첫 세션 목표)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-terraloom");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("land-ratio")).toContainText("%");
  await expect(page.locator("canvas")).toBeVisible();
});

test("새로고침 후 같은 시드는 동일한 지도를 만든다 (결정론)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-terraloom");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("land-ratio")).toContainText("%");
  const first = await page.evaluate(() =>
    (document.querySelector("canvas") as HTMLCanvasElement).toDataURL(),
  );

  await page.reload();
  await page.getByLabel("세계 시드").fill("e2e-terraloom");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("land-ratio")).toContainText("%");
  const second = await page.evaluate(() =>
    (document.querySelector("canvas") as HTMLCanvasElement).toDataURL(),
  );
  expect(first).toBe(second);
});

test("해수면을 올리면 육지 비율이 줄어든다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-terraloom");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("land-ratio")).toContainText("%");
  const before = await page.getByTestId("land-ratio").textContent();
  await page.getByLabel("해수면").fill("0.9");
  await expect
    .poll(async () => {
      const text = await page.getByTestId("land-ratio").textContent();
      return Number(text!.replace("%", ""));
    })
    .toBeLessThan(Number(before!.replace("%", "")));
});
