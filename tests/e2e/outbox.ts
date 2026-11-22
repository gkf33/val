import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = ".mail-outbox/e2e";

export function mailsTo(email: string) {
  let files: string[] = [];
  try {
    files = readdirSync(DIR).sort();
  } catch {
    return [];
  }
  return files
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as { to: string; subject: string; text: string })
    .filter((m) => m.to === email);
}

export async function waitForLink(email: string, count = 1): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const mails = mailsTo(email);
    if (mails.length >= count) return mails[count - 1].text.match(/https?:\/\/\S+/)![0];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Keine Mail an ${email}`);
}

/** Meldet einen Admin per Magic-Link an. */
export async function loginAdmin(page: import("@playwright/test").Page, email = "admin@example.com") {
  const before = mailsTo(email).length;
  await page.goto("/admin/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Link senden" }).click();
  await page.getByText("Wenn die Adresse berechtigt ist").waitFor();
  await page.goto(await waitForLink(email, before + 1));
  await page.getByRole("button", { name: "WEITER ▸" }).click();
  await page.getByRole("heading", { name: "Partys" }).waitFor();
}
