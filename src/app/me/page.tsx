import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { GhostButton, Prompt } from "@/components/ui";
import { logoutAction } from "../auth/actions";

export const dynamic = "force-dynamic";

// Platzhalter: Die Status-Seite mit Buchungen und QR-Codes kommt in Phase 2/4.
export default async function MePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5">
      <Prompt>whoami</Prompt>
      <p className="text-lg">{session.account.email}</p>
      <p className="text-sm text-muted">Deine Anfragen erscheinen hier.</p>
      <form action={logoutAction}>
        <GhostButton type="submit">abmelden</GhostButton>
      </form>
    </main>
  );
}
