import { expect, test } from "@playwright/test";
import { mailsTo, waitForLink } from "./outbox";

const ADMIN = "admin@example.com";

test.describe.serial("Admin", () => {
  test("Nicht-Admins bekommen keinen Link", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("E-Mail").fill("fremd@example.com");
    await page.getByRole("button", { name: "Link senden" }).click();
    await expect(page.getByText("Wenn die Adresse berechtigt ist")).toBeVisible();
    expect(mailsTo("fremd@example.com")).toHaveLength(0);
  });

  test("Admin-Bereich ist ohne Login gesperrt", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("Login, Party anlegen, öffnen und Link aufrufen", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("E-Mail").fill(ADMIN);
    await page.getByRole("button", { name: "Link senden" }).click();
    const link = await waitForLink(ADMIN);

    await page.goto(link);
    await page.getByRole("button", { name: "WEITER ▸" }).click();
    await expect(page.getByRole("heading", { name: "Partys" })).toBeVisible();
    await expect(page.getByText("Nacht 07", { exact: true })).toBeVisible();

    // Link ist danach verbraucht
    const page2 = await page.context().newPage();
    await page2.goto(link);
    await expect(page2.getByText("Link ungültig.")).toBeVisible();
    await page2.close();

    await page.goto("/admin/parties/new");
    await page.getByLabel("Name (intern)").fill("E2E Nacht");
    await page.getByLabel("Beginn").fill("2030-05-10T22:00");
    await page.getByLabel("Ende", { exact: true }).fill("2030-05-11T06:00");
    await page.getByLabel("Kapazität (inkl. Crew)").fill("120");
    await page.getByLabel("Unkostenbeitrag p. P. (€)").fill("15");
    await page.getByRole("button", { name: "Party anlegen" }).click();

    await expect(page.getByRole("heading", { name: "E2E Nacht" })).toBeVisible();
    await expect(page.getByText("Party ist im Entwurf")).toBeVisible();
    const url = (await page.locator("code").first().textContent())!;

    // Entwurf → 404
    const guest = await page.context().browser()!.newPage();
    await guest.goto(url);
    await expect(guest.getByText("404")).toBeVisible();

    await page.getByLabel("Status").selectOption("open");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Gespeichert ✓")).toBeVisible();

    await guest.goto(url);
    await expect(guest.getByRole("heading", { name: /Du wurdest/ })).toBeVisible();
    await expect(guest.getByText("SA 11.05.").or(guest.getByText("FR 10.05."))).toBeVisible();
    await expect(guest.getByText("noch 120")).toBeVisible();
    await expect(guest.getByText(/15,00/).first()).toBeVisible();

    // Link neu erzeugen → alter Link 404
    await page.getByRole("button", { name: "Neu erzeugen" }).first().click();
    await expect(page.getByText("1 deaktivierte Links")).toBeVisible();
    await guest.goto(url);
    await expect(guest.getByText("404")).toBeVisible();
    await guest.close();

    await page.goto("/admin/audit");
    await expect(page.getByText("link.deactivate")).toBeVisible();
    await expect(page.getByText("party.create")).toBeVisible();
  });
});

test("Seed-Party zeigt freie Plätze ohne Adresse", async ({ page }) => {
  await page.goto("/p/nacht-07-zugang23");
  await expect(page.getByRole("heading", { name: /Du wurdest/ })).toBeVisible();
  // 3 Crew + 3 bezahlt + 1 unbezahlt = 7 belegt
  await expect(page.getByText(/noch \d+/)).toBeVisible();
  await expect(page.getByText("Beispielstraße")).toHaveCount(0);
  await page.goto("/p/nacht-07-zzzzzzzz");
  await expect(page.getByText("404")).toBeVisible();
});
