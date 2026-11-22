import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { logoutAction } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/queue", label: "Freigabe" },
  { href: "/admin/payments", label: "Zahlungen" },
  { href: "/admin/parties/new", label: "+ Party" },
  { href: "/admin/audit", label: "Log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh font-sans tabular-nums">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/admin" className="text-sm font-semibold text-fg no-underline">
            <span className="text-accent">›_</span> Admin
          </Link>
          <nav className="hidden gap-5 text-sm md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-fg-2 no-underline hover:text-fg">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{admin.email}</span>
            <button type="submit" className="min-h-11 text-xs text-muted hover:text-fg">
              Abmelden
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 pt-5 pb-28 md:pb-10">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] text-xs md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="flex min-h-14 items-center justify-center text-fg-2 no-underline">
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
