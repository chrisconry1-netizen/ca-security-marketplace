import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", viewport: { width: 390, height: 844 } }, // mobile-first
  webServer: {
    command: "npm run start -- -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { ...process.env, MATCHING_DISABLE_GROK: "1" },
  },
});
