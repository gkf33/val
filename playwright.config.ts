import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const env = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
  DATABASE_URL_UNPOOLED: process.env.E2E_DATABASE_URL ?? "",
  APP_URL: `http://localhost:${PORT}`,
  APP_SECRET: "e2e-secret-0123456789abcdef0123456789abcdef",
  ADMIN_EMAILS: "admin@example.com",
  MAIL_TRANSPORT: "file",
  MAIL_OUTBOX_DIR: ".mail-outbox/e2e",
  PAYPAL_ME_USER: "partykasse",
  INBOUND_WEBHOOK_SECRET: "e2e-inbound-secret-123456",
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/globalSetup.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: env.APP_URL, trace: "off" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${env.APP_URL}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
