import { test as base } from "@playwright/test";
import { installFakeBackend, type Scenario } from "./fake-backend";

export const test = base.extend<{ scenario: Scenario; app: void }>({
  scenario: [{ locked: "unlocked" }, { option: true }],
  app: [
    async ({ page, scenario }, use) => {
      await page.addInitScript(installFakeBackend, scenario);
      await page.goto("/");
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
