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

test("타임라인 사건을 선택하면 위치·영향·확률 근거가 표시된다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-events");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();
  for (let year = 0; year < 3; year++) {
    await page.getByRole("button", { name: "1년", exact: true }).click();
  }
  await expect(page.getByTestId("event-log")).toBeVisible();

  // 최신 항목(목록 첫 줄) 선택 — 사건 상세 패널 열림
  await page.getByTestId("event-log").locator("li").first().locator("button").click();
  const detail = page.getByTestId("event-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("발생 위치");
  // 확률 근거 또는 통지형 안내 — 어느 쪽이든 근거 영역이 렌더된다
  const rationale = detail.getByTestId("probability-rationale");
  const rationaleCount = await rationale.count();
  if (rationaleCount > 0) {
    await expect(rationale).toContainText("최종");
  } else {
    await expect(detail).toContainText("통지형 사건");
  }
});

test("중요도 필터로 대형 사건만 볼 수 있다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-events");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();
  for (let year = 0; year < 3; year++) {
    await page.getByRole("button", { name: "1년", exact: true }).click();
  }
  const log = page.getByTestId("event-log");
  await expect(log).toBeVisible();
  const all = await log.locator("li").count();

  await page.getByRole("button", { name: "대형+" }).click();
  const filtered = await log.locator("li").count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(all);
  // 대형 필터의 남은 항목은 모두 중요도 80 이상이다
  const badges = await log.locator("li").allInnerTexts();
  for (const text of badges) {
    const importance = Number(text.match(/중요도 (\d+)/)?.[1] ?? "0");
    expect(importance).toBeGreaterThanOrEqual(80);
  }
});

test("관찰 모드는 중요 사건에서 자동 정지하고 상세를 연다 (Watch Mode §25)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("세계 시드").fill("e2e-events");
  await page.getByRole("button", { name: "세계 생성" }).click();
  await expect(page.getByTestId("settlement-count")).toBeVisible();

  await page.getByTestId("watch-mode-toggle").click();
  // 100x 탐색 → 가뭄(중요도 80) 발생 시 Worker가 자동 정지한다
  await expect(page.getByTestId("major-event-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("pause-reason-badge")).toContainText("사건 정지");

  // 관찰 모드 — 사건 상세와 대상 도시 상세가 자동으로 열린다 (카메라 이동 상당)
  await expect(page.getByTestId("event-detail")).toBeVisible();
  await expect(page.getByTestId("city-detail")).toBeVisible();
  // 원인 분해(§2.1)가 도시 상세에 표시된다
  await expect(page.getByTestId("cause-breakdown").locator("li").first()).toBeVisible();
});
