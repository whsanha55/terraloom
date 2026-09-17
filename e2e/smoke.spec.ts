import { expect, test } from "@playwright/test";

test("앱이 로드되고 제목이 보인다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "World Observatory" })).toBeVisible();
});
