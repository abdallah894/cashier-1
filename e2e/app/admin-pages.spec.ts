import { expect, test } from "@playwright/test";
import { ADMIN, messages, signIn } from "./helpers";

const m = messages.en;

test("the reports page opens with today at a glance, each number linking to its page", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/en/reports");
  await expect(page.getByRole("heading", { name: m.reports.today.title })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(m.reports.today.openShifts) }).click();
  await expect(page).toHaveURL(/\/en\/shifts$/);
});

test("the audit log reads in plain words and filters by action", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/en/audit");
  await expect(page.getByRole("heading", { name: m.audit.title, level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: m.audit.filter }).click();
  await page.getByRole("option", { name: m.audit.actions.stock_correction }).click();
  await expect(page).toHaveURL(/action=stock_correction/);
  await expect(page.getByRole("table")).toBeVisible();
});
