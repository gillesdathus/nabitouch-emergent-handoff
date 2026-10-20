import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";

const PRESETS = [["24h", "24 hours"], ["3d", "3 days"], ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"]];
const ROLES = [["practitioner", "Practitioner"], ["client", "Client"], ["desk", "Receptionist"], ["owner", "Manager"]];

function remaining(seconds) {
  const value = Number(seconds || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

export default function TrainingCenter() {
  const { api } = useDemo();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [preset, setPreset] = useState("7d");
  const [secrets, setSecrets] = useState(null);
  const load = () => api.trainingScenarios().then((body) => setRows(body.scenarios || [])).catch((error) => toast.error(error?.response?.data?.detail || "Training scenarios could not be loaded"));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const create = async () => {
    try {
      const body = await api.createTrainingScenario({ preset });
      setSecrets(body.temporaryPasswords || []);
      toast.success("Training scenario created.");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The training scenario was not created");
    }
  };
  const act = async (fn, message) => {
    try { await fn(); toast.success(message); await load(); }
    catch (error) { toast.error(error?.response?.data?.detail || "The training scenario was not changed"); }
  };
  const preview = async (id, role) => {
    try {
      await api.previewTrainingRole(id, role);
      navigate("/train");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The training role did not open");
    }
  };
  return (
    <div className="space-y-5" data-testid="training-center">
      <PageHeader
        eyebrow="Manage"
        title="Training Center"
        sub="Training uses a separate database, separate sign-in, and fictional records. It does not change live bookings, payments, or availability."
        right={(
          <div className="flex gap-2">
            <select className="nb-input h-11 w-auto" aria-label="Training duration" value={preset} onChange={(event) => setPreset(event.target.value)} data-testid="training-preset">{PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <button type="button" className="nb-btn-primary h-11 px-4" onClick={create} data-testid="training-create">Create training scenario</button>
          </div>
        )}
      />
      {secrets && (
        <section className="rounded-3xl bg-amber-50 p-4 text-sm ring-1 ring-amber-200" data-testid="training-passwords">
          <p className="font-semibold">Training sign-in details, shown once</p>
          <p className="text-xs text-amber-900">These identities exist only in the training database. They are not operational staff accounts.</p>
          <ul className="mt-2 space-y-1">{secrets.map((row) => <li key={row.email}>{row.name} · {row.role} · {row.email} · {row.password}</li>)}</ul>
        </section>
      )}
      {!rows.length && (
        <div className="nb-card">
          <EmptyState
            icon={GraduationCap}
            title="No training scenario is open"
            body="Create one when you want an isolated practice workspace. It does not touch live clients."
            action={<button type="button" className="nb-btn-primary h-11 px-5" onClick={create} data-testid="training-empty-create">Create training scenario</button>}
            testid="training-empty"
          />
        </div>
      )}
      <div className="grid gap-3">
        {rows.map((row) => (
          <article key={row.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-sky-100" data-testid={`training-scenario-${row.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{row.title}</p>
                <p className="text-sm capitalize text-nb-mute">{row.status} · created {row.createdAt?.slice(0, 10)} · expires {row.expiresAt?.slice(0, 16).replace("T", " ")}</p>
                <p className="text-sm text-nb-mute">Remaining {remaining(row.remainingSeconds)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => act(() => api.resetTrainingScenario(row.id), "Training scenario reset")}>Reset</button>
                <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => act(() => api.extendTrainingScenario(row.id, 7), "Expiration extended")}>Extend 7 days</button>
                <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => act(() => api.endTrainingScenario(row.id), "Training session ended")}>End</button>
                <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => act(() => api.deleteTrainingScenario(row.id), "Training data deleted")}>Delete</button>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-sm">{(row.participants || []).map((person) => <li key={person.userId}>{person.name} · {person.role} · {person.email}</li>)}</ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.map(([id, label]) => <button key={id} type="button" className="nb-chip-off" onClick={() => preview(row.id, id)} data-testid={`training-preview-${id}`}>Open {label}</button>)}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
