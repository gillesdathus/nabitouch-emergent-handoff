import { Link, useNavigate } from "react-router-dom";
import { InsuranceWizard } from "@/components/InsuranceWizard";
import { Notice, PageHeader } from "@/components/tide";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";

export default function InsurancePage() {
  const { me, run, api, idx } = useDemo();
  const nav = useNavigate();
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><p>Please sign in or create a profile first.</p><Link to="/me" className="nb-btn-primary mt-4" data-testid="insurance-signin-link">Go to My Nabitouch</Link></div>;
  const save = async (p) => {
    await run(() => api.patch("clients", me.id, { insurance: [...me.insurance, { ...p, id: `ins-${Date.now()}` }], _audit: `Insurance details added for ${me.firstName} ${me.lastName}`, _actor: "Client" }), "Insurance saved · ready for verification");
    nav("/me");
  };
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <PageHeader eyebrow="Insurance" title="Coverage details" sub="Saving a plan does not submit a claim. Direct insurer billing is not connected." />
      <Notice className="mb-5" testid="insurance-not-connected">Insurance submission is not available. Receipts stay on your account for you to send yourself.</Notice>
      <InsuranceWizard uploadsEnabled={restrictedFlag(idx?.settings, "documentUploadsEnabled")} onSave={save} onCancel={() => nav("/me")} />
    </div>
  );
}
