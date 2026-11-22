import { redirect } from "next/navigation";
import { Field, Input, PrimaryButton } from "@/components/ui";
import { getAdmin } from "@/server/auth/session";
import { adminLoginAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; limited?: string }> }) {
  if (await getAdmin()) redirect("/admin");
  const { sent, limited } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 font-sans">
      <p className="text-xs text-muted">Admin</p>
      <h1 className="text-2xl font-semibold">Anmelden</h1>
      {sent ? (
        <p className="text-sm text-fg-2">Wenn die Adresse berechtigt ist, ist ein Link unterwegs. Er gilt 15 Minuten.</p>
      ) : (
        <form action={adminLoginAction} className="flex flex-col gap-4">
          <Field id="email" label="E-Mail" error={limited ? "Zu viele Versuche. Bitte kurz warten." : undefined}>
            <Input id="email" name="email" type="email" required autoComplete="email" className="font-sans" />
          </Field>
          <PrimaryButton type="submit" className="font-sans">Link senden</PrimaryButton>
        </form>
      )}
    </main>
  );
}
