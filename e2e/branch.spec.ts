import { expect, test } from "@playwright/test";

test("저장 → 분기 생성 → 두 역사 비교 (Step 13)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-branch3");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  const panel = page.getByTestId("snapshot-panel");
  await expect(panel).toBeVisible();

  // 1년 진행 → 연도별 자동 스냅숏, 수동 저장
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 2년 1월");
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("last-saved")).toContainText("마지막 저장", { timeout: 10_000 });
  await page.getByRole("button", { name: "목록 갱신" }).click();
  const list = page.getByTestId("snapshot-list").locator("li");
  await expect(list.first()).toBeVisible({ timeout: 10_000 });
  const before = await list.count();
  expect(before).toBeGreaterThan(0);

  // 과거 시점에서 분기 생성 (LLM 결과 재사용)
  const firstSnapshot = list.last(); // 가장 과거
  await firstSnapshot.getByRole("button", { name: /에서 분기/ }).click();
  await expect(page.getByTestId("snapshot-list")).toBeVisible();
  // 분기 후 시간 진행 — 대체 역사가 흐른다
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력");

  // 두 역사 비교 — 수치 표가 나타난다
  await page.getByRole("button", { name: "목록 갱신" }).click();
  await page.getByTestId("compare-button").click();
  const table = page.getByTestId("branch-comparison");
  await expect(table).toBeVisible({ timeout: 10_000 });
  await expect(table).toContainText("총인구");
  await expect(table).toContainText("사망");
});

test("복원은 같은 상태로 되돌린다 — 원본 역사와 동일 진행", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-branch3");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  await page.getByRole("button", { name: "1년", exact: true }).click();
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 3년 1월");

  // 1년 시점 스냅숏으로 복원 (분기 아님 — 같은 main)
  await page.getByRole("button", { name: "목록 갱신" }).click();
  const rows = page.getByTestId("snapshot-list").locator("li");
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  await rows.last().getByRole("button", { name: /복원/ }).click();
  // 복원 직후 일시정지 — 1년 시점으로 되돌아갔다
  await expect(page.getByTestId("world-clock")).toContainText("세계력 1년", { timeout: 10_000 });
  // 다시 2년 진행하면 원본과 같은 시점 도달 (결정론)
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await expect(page.getByTestId("world-clock")).toContainText("세계력 3년 1월");
});
