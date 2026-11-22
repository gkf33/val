import { Field, Input, PrimaryButton, Prompt } from "@/components/ui";
import { guestLoginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; limited?: string }> }) {
  const { sent, limited } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5">
      <Prompt>login</Prompt>
      <h1 className="text-2xl font-bold">Zurück.</h1>
      {sent ? (
        <p className="text-sm text-fg-2">Wenn wir dich kennen, ist ein Link unterwegs.</p>
      ) : (
        <form action={guestLoginAction} className="flex flex-col gap-4">
          <Field id="email" label="E-Mail" error={limited ? "Zu viele Versuche. Kurz warten." : undefined}>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <PrimaryButton type="submit">LINK SENDEN ▸</PrimaryButton>
        </form>
      )}
    </main>
  );
}
