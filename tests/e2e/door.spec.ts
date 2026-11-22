import { expect, test } from "@playwright/test";

// Seed: Door-Link „tuer234567“, PIN 1234; Lea, Noah, Mia Probe bezahlt; Crew DJ Nord, Mira, Tom.
test.use({ permissions: [] });

test("Türsteher: PIN, Suche, Einchecken, Doppelt-Scan, Auschecken", async ({ page }) => {
  await page.goto("/door/tuer234567");
  await page.getByLabel("PIN").fill("0000");
  await page.getByRole("button", { name: "STARTEN" }).click();
  await expect(page.getByText("▲ PIN falsch")).toBeVisible();

  await page.getByLabel("Gerätename").fill("Scanner E2E");
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "STARTEN" }).click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByText("Scanner E2E")).toBeVisible();
  await expect(page.getByText(/\d+ im Cache/)).toBeVisible();

  // Kamera fehlt im Test → Namenssuche
  await page.getByRole("button", { name: "suche" }).click();
  await page.getByLabel("Name suchen").fill("Lea");
  await page.getByRole("button", { name: /Lea Probe/ }).click();
  const result = page.getByTestId("result");
  await expect(result).toContainText("Gültig");
  await expect(result).toContainText("AUSWEIS PRÜFEN");
  await expect(result).toContainText("via Jonas");
  const before = Number((await page.getByTestId("inside").textContent())!.split(" ")[0]);
  await page.getByRole("button", { name: "EINCHECKEN" }).click();
  await expect(result).toContainText("Eingecheckt");
  await expect(page.getByTestId("inside")).toContainText(String(before + 1));

  // Zweiter Versuch → rot mit Gerät
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "suche" }).click();
  await page.getByLabel("Name suchen").fill("Lea");
  await page.getByRole("button", { name: /Lea Probe/ }).click();
  await expect(result).toContainText("Bereits eingecheckt");
  await expect(result).toContainText("Scanner E2E");
  await page.getByRole("button", { name: "AUSCHECKEN" }).click();
  await expect(result).toContainText("Ausgecheckt");

  // Crew
  await page.getByRole("button", { name: "suche" }).click();
  await page.getByLabel("Name suchen").fill("DJ");
  await page.getByRole("button", { name: /DJ Nord/ }).click();
  await expect(result).toContainText("CREW · DJ");

  // Scan über API mit ungültigem Code
  const r = await page.request.post("/api/door/tuer234567/scan", { data: { payload: "https://x/t/kaputt.code" } });
  expect((await r.json()).reason).toBe("invalid_code");
  // Ohne Geräte-Cookie kein Zugriff
  const anon = await page.context().browser()!.newContext();
  const r2 = await anon.request.get("http://localhost:3100/api/door/tuer234567/stats");
  expect(r2.status()).toBe(401);
  await anon.close();
});

test("Offline: Nicht-Hauptgerät zeigt an, checkt aber nicht ein", async ({ page, context }) => {
  await page.goto("/door/tuer234567");
  await page.getByLabel("Gerätename").fill("Scanner 2");
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "STARTEN" }).click();
  await expect(page.getByText(/[1-9]\d* im Cache/)).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("● offline")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "suche" }).click();
  await page.getByLabel("Name suchen").fill("Mia");
  await page.getByRole("button", { name: /Mia Probe/ }).click();
  await expect(page.getByTestId("result")).toContainText("offline");
  await page.getByRole("button", { name: "EINCHECKEN" }).click();
  await expect(page.getByTestId("result")).toContainText("nur am Hauptgerät");
  await context.setOffline(false);
});
