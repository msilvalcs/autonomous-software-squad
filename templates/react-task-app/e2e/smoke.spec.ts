import { expect, test } from "@playwright/test";

test("renderiza sem erro ou rolagem horizontal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );

  expect(hasHorizontalOverflow).toBe(false);
  expect(errors).toEqual([]);
});
