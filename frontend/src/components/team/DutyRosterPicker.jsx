import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

/**
 * Multi-select duty roster by staff name. Persists user ids only.
 * Directory omits the caller — includeSelf adds the signed-in staff account.
 */
export function DutyRosterPicker({
  label,
  selectedIds = [],
  onChange,
  testid,
  excludeIds = [],
  includeSelf = true,
}) {
  const { user } = useDemo();
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const selected = useMemo(() => new Set(selectedIds || []), [selectedIds]);
  const excluded = useMemo(() => new Set(excludeIds || []), [excludeIds]);

  useEffect(() => {
    let live = true;
    if (typeof api.teamDirectory !== "function") {
      setPeople([]);
      setError("Directory unavailable");
      return () => { live = false; };
    }
    api.teamDirectory()
      .then((body) => {
        if (!live) return;
        const rows = [...(body?.people || [])];
        if (includeSelf && user?.id && !rows.some((row) => row.id === user.id)) {
          rows.unshift({ id: user.id, name: user.name || "You", role: user.role, roles: user.roles });
        }
        rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setPeople(rows);
      })
      .catch(() => { if (live) { setPeople([]); setError("Directory unavailable"); } });
    return () => { live = false; };
  }, [includeSelf, user?.id, user?.name, user?.role, user?.roles]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const visible = people.filter((person) => !excluded.has(person.id) || selected.has(person.id));

  return (
    <div data-testid={testid}>
      <p className="nb-label">{label}</p>
      <p className="mb-2 text-xs text-nb-mute">Select staff by name. Saved as user ids for on-duty routing.</p>
      {error && <p className="mb-2 text-xs text-amber-800">{error}</p>}
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-sky-100 bg-white p-2">
        {visible.map((person) => (
          <li key={person.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-sky-50">
              <input
                type="checkbox"
                checked={selected.has(person.id)}
                onChange={() => toggle(person.id)}
                data-testid={`${testid}-user-${person.id}`}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{person.name || person.email || person.id}</span>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-nb-mute">{person.role || (person.roles || [])[0] || "staff"}</span>
            </label>
          </li>
        ))}
        {visible.length === 0 && !error && <li className="px-2 py-3 text-xs text-nb-mute">No other staff accounts found.</li>}
      </ul>
      {selected.size > 0 && (
        <p className="mt-1 text-[11px] text-nb-mute" data-testid={`${testid}-count`}>{selected.size} selected</p>
      )}
    </div>
  );
}
