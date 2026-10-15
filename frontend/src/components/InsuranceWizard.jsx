import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ImageUp, RefreshCw, ScanLine, ShieldCheck, Keyboard, Lightbulb, X } from "lucide-react";
import { INSURERS } from "@/lib/domain";

const blank = { insurer: "", policy: "", memberId: "", holderName: "", relationship: "Self", holderDob: "", secondary: "", extra: "" };

function CameraCapture({ onShot, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } }).then((s) => { stream = s; if (video.current) video.current.srcObject = s; }).catch(() => setErr("Camera unavailable or permission declined — use “Upload a photo” instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const snap = () => {
    const v = video.current; if (!v?.videoWidth) return;
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((b) => onShot(URL.createObjectURL(b)), "image/jpeg", 0.85);
  };
  return (
    <div className="space-y-3">
      <div className="relative aspect-[1.586] overflow-hidden rounded-3xl bg-nb-ink">
        {err ? <p className="p-6 text-sm text-white/80">{err}</p> : <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />}
        <div className="pointer-events-none absolute inset-[8%] rounded-2xl border-2 border-dashed border-cyan-300/90" />
        <p className="absolute inset-x-0 bottom-3 text-center text-xs text-white/85">Align your card inside the frame</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} data-testid="camera-close-btn" className="nb-btn-ghost flex-1"><X className="h-4 w-4" />Close</button>
        <button onClick={snap} disabled={!!err} data-testid="camera-shutter-btn" className="nb-btn-primary flex-1"><Camera className="h-4 w-4" />Capture</button>
      </div>
    </div>
  );
}

export function InsuranceWizard({ initial, onSave, onCancel, saving, uploadsEnabled = false }) {
  const [stage, setStage] = useState(!uploadsEnabled || initial ? "review" : "capture");
  const [img, setImg] = useState(null);
  const [camera, setCamera] = useState(false);
  const [form, setForm] = useState({ ...blank, ...(initial || {}) });
  const file = useRef(null);
  useEffect(() => () => img && URL.revokeObjectURL(img), [img]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onFile = (e) => { const f = e.target.files?.[0]; if (f) { setImg(URL.createObjectURL(f)); setCamera(false); } e.target.value = ""; };
  const scan = () => setStage("review");
  const valid = form.insurer && form.policy && form.memberId && form.holderName;

  return (
    <div className="space-y-5" data-testid="insurance-wizard">
      <div className="flex items-center justify-between"><p className="nb-eyebrow">Insurance profile</p></div>
      <AnimatePresence mode="wait">
        {stage === "capture" && (
          <motion.div key="cap" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <h3 className="text-xl font-semibold text-nb-ink">Snap your insurance card</h3>
            {camera ? <CameraCapture onShot={(u) => { setImg(u); setCamera(false); }} onClose={() => setCamera(false)} /> : img ? (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-3xl border border-sky-100"><img src={img} alt="Insurance card preview" className="aspect-[1.586] w-full object-cover" data-testid="insurance-card-preview" /></div>
                <div className="flex gap-2">
                  <button onClick={() => { setImg(null); }} data-testid="insurance-retake-btn" className="nb-btn-ghost flex-1"><RefreshCw className="h-4 w-4" />Retake / replace</button>
                  <button onClick={scan} data-testid="insurance-scan-btn" className="nb-btn-primary flex-1"><ScanLine className="h-4 w-4" />Enter the details</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <button onClick={() => setCamera(true)} data-testid="insurance-take-photo-btn" className="nb-card flex flex-col items-start gap-3 p-5 text-left hover:border-nb-sky"><Camera className="h-6 w-6 text-nb-blue" /><span className="font-semibold text-sm">Take a photo</span><span className="text-xs text-nb-mute">Use your camera</span></button>
                <button onClick={() => file.current?.click()} data-testid="insurance-upload-btn" className="nb-card flex flex-col items-start gap-3 p-5 text-left hover:border-nb-sky"><ImageUp className="h-6 w-6 text-nb-teal" /><span className="font-semibold text-sm">Upload a photo</span><span className="text-xs text-nb-mute">From your gallery</span></button>
                <button onClick={() => setStage("review")} data-testid="insurance-manual-btn" className="nb-card flex flex-col items-start gap-3 p-5 text-left hover:border-nb-sky"><Keyboard className="h-6 w-6 text-nb-navy" /><span className="font-semibold text-sm">Enter manually</span><span className="text-xs text-nb-mute">Type the details</span></button>
                <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="insurance-file-input" />
              </div>
            )}
            <div className="flex gap-3 rounded-2xl bg-sky-50 p-4 text-xs text-nb-navy"><Lightbulb className="h-4 w-4 shrink-0" /><p>For a clear photo: lay the card flat, use good light, avoid glare, and keep all four corners visible. You’ll type the plan details yourself — Nabitouch does not read the card.</p></div>
            {onCancel && <button onClick={onCancel} data-testid="insurance-cancel-btn" className="text-sm text-nb-mute">Cancel</button>}
          </motion.div>
        )}
        {stage === "review" && (
          <motion.div key="rev" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <h3 className="text-xl font-semibold text-nb-ink">Review your plan details</h3>
            <p className="text-sm text-nb-mute">Enter the details printed on the card. A photo, if you added one, stays with this profile and is not sent to an insurer from here.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label><span className="nb-label">Insurance company</span>
                <select className="nb-input" value={form.insurer} onChange={set("insurer")} data-testid="ins-insurer-select"><option value="">Select…</option>{INSURERS.concat(form.insurer && !INSURERS.includes(form.insurer) ? [form.insurer] : []).map((i) => <option key={i}>{i}</option>)}</select></label>
              <label><span className="nb-label">Policy / contract number</span><input className="nb-input" value={form.policy} onChange={set("policy")} data-testid="ins-policy-input" /></label>
              <label><span className="nb-label">Member / certificate ID</span><input className="nb-input" value={form.memberId} onChange={set("memberId")} data-testid="ins-member-input" /></label>
              <label><span className="nb-label">Plan holder name</span><input className="nb-input" value={form.holderName} onChange={set("holderName")} data-testid="ins-holder-input" /></label>
              <label><span className="nb-label">Your relationship to plan holder</span>
                <select className="nb-input" value={form.relationship} onChange={set("relationship")} data-testid="ins-relationship-select">{["Self", "Spouse / partner", "Dependent child", "Other dependent"].map((r) => <option key={r}>{r}</option>)}</select></label>
              {form.relationship !== "Self" && <label><span className="nb-label">Plan holder date of birth</span><input type="date" className="nb-input" value={form.holderDob} onChange={set("holderDob")} data-testid="ins-holder-dob-input" /></label>}
              <label className="sm:col-span-2"><span className="nb-label">Secondary insurance / coordination of benefits <span className="text-nb-mute font-normal">(optional)</span></span><input className="nb-input" value={form.secondary} onChange={set("secondary")} placeholder="e.g. spouse’s plan" data-testid="ins-secondary-input" /></label>
              <label className="sm:col-span-2"><span className="nb-label">Other insurer-specific details <span className="text-nb-mute font-normal">(optional)</span></span><input className="nb-input" value={form.extra} onChange={set("extra")} placeholder="Group / division number" data-testid="ins-extra-input" /></label>
            </div>
            <div className="flex gap-3 rounded-2xl bg-teal-50 p-4 text-xs text-teal-900"><ShieldCheck className="h-4 w-4 shrink-0" /><p>Direct billing depends on your insurer, plan terms and practitioner eligibility. We’ll verify before your visit — if it isn’t available you can pay yourself and submit the receipt.</p></div>
            <div className="flex gap-2">
              {!initial && <button onClick={() => setStage("capture")} data-testid="insurance-back-btn" className="nb-btn-ghost">Back</button>}
              <button disabled={!valid || saving} onClick={() => onSave({ ...form, hasCardImage: !!img, status: "ready_for_verification" })} data-testid="insurance-save-btn" className="nb-btn-primary flex-1">Confirm & save insurance</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
