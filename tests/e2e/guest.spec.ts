import { expect, test } from "@playwright/test";
import { loginAdmin, waitForLink } from "./outbox";

const GUEST = `e2e-gast-${Date.now()}@example.com`;

test("Gast fragt an, bestätigt, Admin gibt frei, Gast sieht Zahlung", async ({ browser }) => {
  const guestCtx = await browser.newContext();
  const g = await guestCtx.newPage();

  await g.goto("/p/nacht-07-zugang23");
  await g.getByLabel("Name — wie im Ausweis").fill("Robin E2E");
  await g.getByLabel("E-Mail", { exact: true }).fill(GUEST);
  await g.getByLabel("Ich bin 18 oder älter.").check();

  // Fehler: Begleitung ohne 18+
  await g.getByRole("button", { name: /person hinzufügen/ }).click();
  await g.locator("#c0-name").fill("Sam Begleitung");
  await g.getByText(/Verstanden\./).click();
  await g.getByRole("button", { name: "ANFRAGE SENDEN ▸" }).click();
  await expect(g.getByText("▲ Nur ab 18")).toBeVisible();

  await g.getByLabel("18+ bestätigt").check();
  await g.getByRole("button", { name: "ANFRAGE SENDEN ▸" }).click();
  await expect(g.getByText("Check deine Mails.")).toBeVisible();

  const confirm = await waitForLink(GUEST);
  await g.goto(confirm);
  await g.getByRole("button", { name: "BESTÄTIGEN ▸" }).click();
  await expect(g).toHaveURL(/\/me$/);
  await expect(g.getByText("Robin E2E")).toBeVisible();
  await expect(g.getByText("angefragt").first()).toBeVisible();

  // Admin
  const adminCtx = await browser.newContext();
  const a = await adminCtx.newPage();
  await loginAdmin(a);

  await a.goto("/admin/queue");
  const card = a.locator("li", { hasText: GUEST });
  await expect(card).toBeVisible();
  await expect(card.getByText("via Party-Link")).toBeVisible();
  await card.getByRole("button", { name: "Freigeben" }).click();
  await expect(a.getByText("✓ 2 freigegeben")).toBeVisible();

  // Gast sieht Zahlung
  await g.reload();
  await expect(g.getByText("// zahlung")).toBeVisible();
  await expect(g.getByText("40,00 €")).toBeVisible();
  const pay = g.getByRole("link", { name: "MIT PAYPAL ZAHLEN ▸" });
  await expect(pay).toHaveAttribute("href", "https://paypal.me/partykasse/40EUR");
  const ref = await g.locator("code").first().textContent();
  expect(ref).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);

  await guestCtx.close();
  await adminCtx.close();
});

test("Queue zeigt Sperrlisten-Warnung", async ({ browser }) => {
  const g = await browser.newPage();
  const email = `e2e-block-${Date.now()}@example.com`;
  await g.goto("/p/nacht-07-zugang23");
  await g.getByLabel("Name — wie im Ausweis").fill("Max Ärger");
  await g.getByLabel("E-Mail", { exact: true }).fill(email);
  await g.getByLabel("Ich bin 18 oder älter.").check();
  await g.getByText(/Verstanden\./).click();
  await g.getByRole("button", { name: "ANFRAGE SENDEN ▸" }).click();
  await g.goto(await waitForLink(email));
  await g.getByRole("button", { name: "BESTÄTIGEN ▸" }).click();
  await expect(g).toHaveURL(/\/me$/);

  const a = await browser.newPage();
  await loginAdmin(a);
  await a.goto("/admin/queue");
  const card = a.locator("li", { hasText: email });
  await expect(card.getByText(/Sperrliste \(Name\)/)).toBeVisible();
  // Gast mit Warnung ist nicht vorausgewählt
  await expect(card.getByRole("checkbox")).not.toBeChecked();
});
