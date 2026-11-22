import { PartyForm } from "@/components/admin/PartyForm";
import { createPartyAction } from "@/app/admin/actions";

export default function NewPartyPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Neue Party</h1>
      <PartyForm
        action={createPartyAction}
        submitLabel="Party anlegen"
        initial={{
          name: "",
          status: "draft",
          startsAt: "",
          endsAt: "",
          registrationClosesAt: "",
          paymentsAcceptedUntil: "",
          paymentDeadlineMinutes: Number(process.env.PAYMENT_DEADLINE_MINUTES ?? 60),
          capacity: 250,
          fee: "",
          maxGroupSize: Number(process.env.MAX_GROUP_SIZE ?? 5),
          city: "",
          address: "",
          directions: "",
          info: "",
          transparencyPublic: false,
        }}
      />
    </div>
  );
}
