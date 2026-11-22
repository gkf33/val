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
