export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-5 text-sm text-muted">
      <p>PS&gt; _</p>
      <p>{deleted ? "konto gelöscht." : "nichts zu sehen."}</p>
    </main>
  );
}
