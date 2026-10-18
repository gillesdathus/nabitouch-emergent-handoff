import { PageHeader } from "@/components/ds";
import { ClientDirectory } from "@/components/clients/ClientDirectory";

export default function Clients({ role = "owner" }) {
  return (
    <div className="min-w-0 space-y-5" data-testid={`${role}-clients`}>
      <PageHeader eyebrow="Client records" title="Clients" description="Search, open a record, book, or invoice. Clinical notes stay inside the protected record." />
      <ClientDirectory role={role} />
    </div>
  );
}
