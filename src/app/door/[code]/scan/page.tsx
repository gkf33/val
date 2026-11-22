import { redirect } from "next/navigation";
import { getDevice } from "@/server/door";
import { Scanner } from "@/components/door/Scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const device = await getDevice(code);
  if (!device) redirect(`/door/${code}`);
  return <Scanner code={code} deviceName={device.name} capacity={device.party.capacity} offlinePrimary={device.offlinePrimary} />;
}
