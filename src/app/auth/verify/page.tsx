import { peekMagicToken } from "@/server/auth/magicLink";
import { PrimaryButton, Prompt } from "@/components/ui";
import { verifyAction } from "../actions";

export const dynamic = "force-dynamic";

// GET verbraucht den Token nicht: Mail-Scanner, die Links vorab öffnen,
// sollen ihn nicht entwerten. Erst der Klick (POST) meldet an.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; invalid?: string }> }) {
  const { token } = await searchParams;
  const row = token ? await peekMagicToken(token) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5">
      <Prompt>auth --verify</Prompt>
      {row ? (
        <form action={verifyAction} className="flex flex-col gap-6">
          <input type="hidden" name="token" value={token} />
          <h1 className="text-2xl font-bold">Zugang bestätigen.</h1>
          <PrimaryButton type="submit">WEITER ▸</PrimaryButton>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">Link ungültig.</h1>
          <p className="text-sm text-muted">Abgelaufen oder schon benutzt. Fordere einen neuen an.</p>
        </div>
      )}
    </main>
  );
}
