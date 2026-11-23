import { expect, test } from "@playwright/test";
import { loginAdmin, mailsTo, waitForLink } from "./outbox";

// Seed: lea@example.com hat 3 bezahlte Plätze (Lea, Noah, Mia Probe) für „Nacht 07“.
test("Gast storniert Begleitung, beantragt Namensänderung; Admin gibt frei", async ({ browser }) => {
  const g = await (await browser.newContext()).newPage();
  const before = mailsTo("lea@example.com").length;
  await g.goto("/login");
  await g.getByLabel("E-Mail").fill("lea@example.com");
  await g.getByRole("button", { name: /LINK SENDEN/ }).click();
  await g.goto(await waitForLink("lea@example.com", before + 1));
  await g.getByRole("button", { name: "WEITER ▸" }).click();
  await expect(g).toHaveURL(/\/me$/);

  await g.getByText("Stornieren", { exact: true }).click();
  await g.getByRole("checkbox", { name: "Noah Probe" }).check();
  await g.getByRole("button", { name: "Auswahl stornieren" }).click();
  await expect(g.getByText("✓ 1 storniert")).toBeVisible();
  await expect(g.getByText("storniert", { exact: true })).toBeVisible();

  await g.getByText("Name ändern (Ersatzperson)").click();
  const form = g.locator("form", { hasText: "Statt Mia Probe:" });
  await form.getByLabel("Name — wie im Ausweis").fill("Nina Neu");
  await form.getByLabel("Geschlecht").selectOption("w");
  await form.getByLabel("18+ bestätigt").check();
  await form.getByRole("button", { name: "Änderung beantragen" }).click();
  await expect(g.getByText("✓ Namensänderung beantragt")).toBeVisible();

  const a = await (await browser.newContext()).newPage();
  await loginAdmin(a);
  await a.goto("/admin/queue?tab=names");
  await expect(a.getByText("Nina Neu")).toBeVisible();
  await a.getByRole("button", { name: "Freigeben" }).click();
  await expect(a.getByText("✓ Freigegeben, neuer QR-Code verschickt")).toBeVisible();

  await g.reload();
  await expect(g.getByRole("link", { name: "Nina Neu ▸" })).toBeVisible();
  await expect(g.getByText("ersetzt")).toBeVisible();

  await a.goto("/admin/payments?tab=refunds");
  await expect(a.getByText("Storno").first()).toBeVisible();
});

test("Admin: Sperrliste, Gäste, Statistik, Kosten + Transparenz", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await loginAdmin(a);

  await a.goto("/admin/blocklist");
  await a.getByPlaceholder("Name").fill("Peter Problem");
  await a.getByPlaceholder("Grund (intern)").fill("Test");
  await a.getByRole("button", { name: "+ Sperren" }).click();
  await expect(a.getByText("Peter Problem")).toBeVisible();

  await a.goto("/admin/guests");
  const row = a.locator("li", { hasText: "kim@example.com" });
  await row.getByRole("button", { name: "Vertraut" }).click();
  await expect(a.locator("li", { hasText: "kim@example.com" }).getByText("vertraut", { exact: true })).toBeVisible();

  await a.goto("/admin/stats");
  await expect(a.getByRole("heading", { name: "Einlader-Netzwerk" })).toBeVisible();
  await expect(a.getByRole("cell", { name: "Jonas" })).toBeVisible();

  await a.goto("/admin");
  await a.getByText("Nacht 07", { exact: true }).click();
  await a.getByPlaceholder("z. B. Getränke").fill("Getränke");
  await a.getByPlaceholder("€").fill("150");
  await a.getByRole("button", { name: "+ Kosten" }).click();
  await expect(a.locator("#kosten").getByText("150,00 €").first()).toBeVisible();
  await a.getByLabel("Transparenzseite für Gäste sichtbar").check();
  await a.getByRole("button", { name: "Speichern" }).click();
  await expect(a.getByText("Gespeichert ✓")).toBeVisible();

  const pub = await (await browser.newContext()).newPage();
  await pub.goto("/p/nacht-07-zugang23/transparenz");
  await expect(pub.getByRole("heading", { name: "Kein Gewinn." })).toBeVisible();
  await expect(pub.getByText("Getränke")).toBeVisible();
});
