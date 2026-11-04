import { useState } from "react";
import { Panel } from "@/components/ds";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

function asDateInput(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export default function ProfessionalExperience({ person, onSaved }) {
  const { api, run } = useDemo();
  const [form, setForm] = useState({
    historicalCompletedTreatments: person.historicalCompletedTreatments ?? person.historicalTreatmentCount ?? "",
    historicalCountAsOf: asDateInput(person.historicalCountAsOf),
    historicalCountSource: person.historicalCountSource || "",
    yearsOfExperience: person.yearsOfExperience ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const audit = [...(person.historicalCountAudit || [])].reverse();

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async () => {
    setError("");
    const countRaw = String(form.historicalCompletedTreatments).trim();
    const yearsRaw = String(form.yearsOfExperience).trim();
    if (countRaw === "" || !/^\d+$/.test(countRaw)) {
      setError("Enter a whole-number historical treatment count.");
      return;
    }
    const body = {
      historicalCompletedTreatments: Number(countRaw),
      historicalCountAsOf: form.historicalCountAsOf || null,
      historicalCountSource: form.historicalCountSource,
    };
    if (yearsRaw === "") body.yearsOfExperience = null;
    else if (/^\d+$/.test(yearsRaw)) body.yearsOfExperience = Number(yearsRaw);
    else {
      setError("Years of experience must be a whole number, or blank.");
      return;
    }
    setBusy(true);
    try {
      await run(() => api.savePractitionerProfile(person.id, body), "Professional experience saved");
      onSaved?.();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Professional Experience" testid={`pr-experience-${person.id}`}>
      <p className="mb-4 text-sm text-nb-mute">
        Historical completed treatments are work outside Nabitouch (including contractor sessions). Career total = historical count + completed Nabitouch appointments after the baseline date.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs sm:col-span-1">
          <span className="mb-1 block text-nb-mute">Historical completed treatments</span>
          <input
            type="number"
            min="0"
            className="nb-input h-10"
            value={form.historicalCompletedTreatments}
            onChange={set("historicalCompletedTreatments")}
            data-testid={`pr-hist-count-${person.id}`}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-nb-mute">Count applies through</span>
          <input
            type="date"
            className="nb-input h-10"
            value={form.historicalCountAsOf}
            onChange={set("historicalCountAsOf")}
            data-testid={`pr-hist-asof-${person.id}`}
          />
        </label>
        <label className="block text-xs sm:col-span-2">
          <span className="mb-1 block text-nb-mute">Source / explanation</span>
          <textarea
            rows={3}
            className="nb-input h-auto py-3"
            value={form.historicalCountSource}
            onChange={set("historicalCountSource")}
            data-testid={`pr-hist-source-${person.id}`}
            placeholder="e.g. Owner-confirmed contractor + mobile history; +64 treatments since 2026-10-31 baseline"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-nb-mute">Years of experience (optional, verified only)</span>
          <input
            type="number"
            min="0"
            max="80"
            className="nb-input h-10"
            value={form.yearsOfExperience}
            onChange={set("yearsOfExperience")}
            data-testid={`pr-years-${person.id}`}
          />
        </label>
        <div className="rounded-2xl bg-sky-50 px-3 py-2 text-xs text-nb-navy">
          <p><span className="text-nb-mute">Career total now:</span> <b data-testid={`pr-career-preview-${person.id}`}>{person.careerCompletedTreatments ?? "—"}</b></p>
          <p className="mt-1 text-nb-mute">Treatments offered: {person.treatmentsOffered ?? (person.specialties || []).length}</p>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-700" data-testid={`pr-experience-error-${person.id}`}>{error}</p>}
      <button type="button" className="nb-btn-primary mt-4 h-10 px-4 text-sm" disabled={busy} onClick={save} data-testid={`pr-experience-save-${person.id}`}>
        Save experience
      </button>

      <div className="mt-6" data-testid={`pr-experience-audit-${person.id}`}>
        <h3 className="text-sm font-semibold text-nb-ink">Correction history</h3>
        {!audit.length && <p className="mt-2 text-xs text-nb-mute">No corrections recorded yet.</p>}
        <ul className="mt-2 space-y-2">
          {audit.slice(0, 12).map((entry) => (
            <li key={entry.id} className="rounded-2xl bg-sky-50/70 px-3 py-2 text-xs text-nb-mute">
              <p className="font-medium text-nb-ink">{entry.at?.slice(0, 19)?.replace("T", " ")} · {entry.actor || "Owner"}</p>
              <p>
                {entry.before?.historicalCompletedTreatments ?? "—"} → {entry.after?.historicalCompletedTreatments ?? "—"}
                {entry.after?.historicalCountAsOf ? ` · through ${entry.after.historicalCountAsOf}` : ""}
              </p>
              {entry.after?.historicalCountSource && <p className="mt-1">{entry.after.historicalCountSource}</p>}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
