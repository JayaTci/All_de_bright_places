// Checks public and editor interactions in a browser without using private account data.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("preview tolerates extension attributes added before hydration", async ({ context, page }) => {
  await context.addInitScript(() => {
    const inject = () => {
      if (!document.documentElement) return;
      document.documentElement.setAttribute("data-scribe-recorder-ready", "true");
      observer.disconnect();
    };
    const observer = new MutationObserver(inject);
    observer.observe(document, { childList: true });
    inject();
  });
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("hydrated")) hydrationErrors.push(message.text());
  });
  await page.goto("/preview");
  await expect(page.getByRole("heading", { name: /A little list/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scribe-recorder-ready", "true");
  expect(hydrationErrors).toEqual([]);
});

test("public pages show the complete quote and fit a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/preview");
  await expect(page.locator("blockquote")).toHaveText("“We do not remember the days, we remember moments.”");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Our memories" }).click();
  await expect(page.getByRole("heading", { name: /Our little collection/ })).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("goal actions close on outside click and Escape, while failed saves stay open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/preview?editor=1");
  await expect(page.getByText("just us")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Actions for Watch the sunrise somewhere new" });
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  const menuAccessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(menuAccessibility.violations).toEqual([]);
  await page.mouse.click(4, 4);
  await expect(page.getByRole("menu")).toBeHidden();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.route("**/api/goals/preview-0", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "conflict" }) }));
  await trigger.click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  const dialog = page.getByRole("dialog", { name: "Tuck this dream away?" });
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("changed while you were editing");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("recovery can retry enrollment after a redeemed link", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/auth/recovery", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/auth/session", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { username: "ruby", aal2: false, enrolled: false } }) }));
  await page.route("**/api/auth/mfa/enroll", route => {
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: "Authenticator setup is unavailable." }) } : { status: 200, contentType: "application/json", body: JSON.stringify({ factorId: "11111111-1111-4111-8111-111111111111", qrCode: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9dQdIAAAAASUVORK5CYII=", secret: "TESTKEY" }) });
  });
  await page.goto("/auth/recovery?token_hash=abcdefghijklmnop&type=recovery");
  await page.getByRole("button", { name: "Verify recovery link" }).click();
  await expect(page.getByRole("button", { name: "Set up an authenticator" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/recovery$/);
  await page.getByRole("button", { name: "Set up an authenticator" }).click();
  await expect(page.getByRole("textbox", { name: "Authenticator code" })).toBeVisible();
  expect(attempts).toBe(2);
});
