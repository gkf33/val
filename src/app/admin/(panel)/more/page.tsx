import Link from "next/link";

const ITEMS = [
  { href: "/admin/parties/new", label: "+ Neue Party" },
  { href: "/admin/stats", label: "Statistik" },
  { href: "/admin/blocklist", label: "Sperrliste" },
  { href: "/admin/audit", label: "Audit-Log" },
];

export default function MorePage() {
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {ITEMS.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className="flex min-h-14 items-center justify-between text-fg no-underline">
            {i.label} <span className="text-muted">▸</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
