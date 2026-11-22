import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return {
    title: "Door",
    manifest: `/door/${code}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Door", statusBarStyle: "black" },
    robots: { index: false, follow: false },
  };
}

export default function DoorLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-black text-[#f2f2f2]">{children}</div>;
}
