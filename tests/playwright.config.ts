// Runs browser regressions against the development-only notebook fixtures.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  use: { baseURL: "http://127.0.0.1:3000", browserName: "chromium", launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : undefined },
  webServer: {
    command: "corepack pnpm dev",
    url: "http://127.0.0.1:3000/preview",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
