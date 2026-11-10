import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const EMPTY_NEW = { firstName: "", lastName: "", phone: "", email: "" };

function contactLine(row) {
  if (!row) return "";
  return [row.phone, row.email].filter(Boolean).join(" · ");
}

function displayName(row) {
  if (!row) return "Client";
  return `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.id;
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export function ClientSelector({
  value = "",
  client: clientProp = null,
  onChange,
  testidPrefix = "client-selector",
}) {
  const { api, idx, state, refresh } = useDemo();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState(EMPTY_NEW);
  const [dupes, setDupes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selected = clientProp
    || (value && idx.clients?.[value])
    || (value && (state.clients || []).find((row) => row.id === value))
    || (value && hits.find((row) => row.id === value))
    || null;

  useEffect(() => {
    if (value || creating) return undefined;
    if (query.trim().length < 2) {
      setHits([]);
      return undefined;
    }
    let live = true;
    const handle = setTimeout(() => {
      api.searchClients(query).then((body) => {
        if (live) setHits(body.clients || []);
      }).catch(() => {
        if (live) setHits([]);
      });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [api, query, value, creating]);

  const pick = (row) => {
    setErr("");
    setCreating(false);
    setDupes([]);
    setQuery("");
    setHits([]);
    setNewClient(EMPTY_NEW);
    onChange?.(row);
  };

  const clear = () => {
    setErr("");
    setCreating(false);
    setDupes([]);
    setQuery("");
    setHits([]);
    setNewClient(EMPTY_NEW);
    onChange?.(null);
  };

  const openCreate = () => {
    setErr("");
    setDupes([]);
    setCreating(true);
    setQuery("");
    setHits([]);
  };

  const cancelCreate = () => {
    setErr("");
    setDupes([]);
    setCreating(false);
    setNewClient(EMPTY_NEW);
  };

  const findDuplicates = async () => {
    const needle = [newClient.phone, newClient.email, `${newClient.firstName} ${newClient.lastName}`]
      .filter(Boolean)
      .join(" ");
    if (needle.trim().length < 2) return [];
    const body = await api.searchClients(needle);
    const matches = body.clients || [];
    const email = String(newClient.email || "").trim().toLowerCase();
    const digits = phoneDigits(newClient.phone);
    const mine = `${newClient.firstName} ${newClient.lastName}`.trim().toLowerCase();
    return matches.filter((row) => {
      const rowEmail = String(row.email || "").trim().toLowerCase();
      const rowPhone = phoneDigits(row.phone);
      const name = `${row.firstName || ""} ${row.lastName || ""}`.trim().toLowerCase();
      return (email && rowEmail && email === rowEmail)
        || (digits.length >= 10 && rowPhone === digits)
        || (name && name === mine);
    });
  };

  const saveNew = async ({ force = false } = {}) => {
    setErr("");
    if (!newClient.firstName.trim() || !newClient.lastName.trim() || !newClient.phone.trim()) {
      setErr("First name, last name, and phone are required.");
      return;
    }
    setBusy(true);
    try {
      if (!force) {
        const found = await findDuplicates();
        if (found.length) {
          setDupes(found);
          setErr(`Possible duplicate client${found.length > 1 ? "s" : ""} found. Select one, or create anyway.`);
          setBusy(false);
          return;
        }
      }
      const created = await api.createClient({
        firstName: newClient.firstName.trim(),
        lastName: newClient.lastName.trim(),
        phone: newClient.phone.trim(),
        email: newClient.email.trim(),
      });
      await refresh?.();
      pick(created);
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  // State A — selected compact card
  if (value && selected && !creating) {
    return (
      <div className="rounded-2xl bg-sky-50/80 px-3 py-2.5" data-testid={`${testidPrefix}-selected`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-nb-ink" data-testid={`${testidPrefix}-name`}>{displayName(selected)}</p>
            <p className="truncate text-xs text-nb-mute" data-testid={`${testidPrefix}-contact`}>{contactLine(selected) || "No phone or email on file"}</p>
          </div>
          <button type="button" className="nb-btn-ghost h-8 shrink-0 px-3 text-xs" onClick={clear} data-testid={`${testidPrefix}-change`}>
            Change
          </button>
        </div>
      </div>
    );
  }

  // State C — create new client
  if (creating) {
    return (
      <div className="space-y-3 rounded-2xl ring-1 ring-sky-100 p-3" data-testid={`${testidPrefix}-create`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-nb-ink">New client</p>
          <button type="button" className="nb-btn-ghost h-8 px-2 text-xs" onClick={cancelCreate} data-testid={`${testidPrefix}-create-cancel`}>
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs"><span className="mb-1 block text-nb-mute">First name</span>
            <input className="nb-input h-10" value={newClient.firstName} onChange={(e) => setNewClient((x) => ({ ...x, firstName: e.target.value }))} data-testid={`${testidPrefix}-new-first`} />
          </label>
          <label className="text-xs"><span className="mb-1 block text-nb-mute">Last name</span>
            <input className="nb-input h-10" value={newClient.lastName} onChange={(e) => setNewClient((x) => ({ ...x, lastName: e.target.value }))} data-testid={`${testidPrefix}-new-last`} />
          </label>
          <label className="text-xs"><span className="mb-1 block text-nb-mute">Phone</span>
            <input className="nb-input h-10" value={newClient.phone} onChange={(e) => setNewClient((x) => ({ ...x, phone: e.target.value }))} data-testid={`${testidPrefix}-new-phone`} />
          </label>
          <label className="text-xs"><span className="mb-1 block text-nb-mute">Email (optional)</span>
            <input className="nb-input h-10" value={newClient.email} onChange={(e) => setNewClient((x) => ({ ...x, email: e.target.value }))} data-testid={`${testidPrefix}-new-email`} />
          </label>
        </div>
        {dupes.length > 0 && (
          <ul className="max-h-36 space-y-1 overflow-y-auto" data-testid={`${testidPrefix}-dupes`}>
            {dupes.map((row) => (
              <li key={row.id}>
                <button type="button" className="nb-btn-ghost h-auto w-full justify-start px-3 py-2 text-left text-sm" data-testid={`${testidPrefix}-dupe-${row.id}`} onClick={() => pick(row)}>
                  <span className="font-semibold">{displayName(row)}</span>
                  <span className="ml-2 text-nb-mute">{contactLine(row)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {err && <p className="text-sm text-rose-700" data-testid={`${testidPrefix}-error`}>{err}</p>}
        <div className="flex gap-2">
          {dupes.length > 0 && (
            <button type="button" className="nb-btn-ghost h-10 flex-1 text-sm" disabled={busy} onClick={() => saveNew({ force: true })} data-testid={`${testidPrefix}-create-anyway`}>
              Create anyway
            </button>
          )}
          <button
            type="button"
            className="nb-btn-primary h-10 flex-1 text-sm"
            disabled={busy || !newClient.firstName.trim() || !newClient.lastName.trim() || !newClient.phone.trim()}
            onClick={() => saveNew()}
            data-testid={`${testidPrefix}-create-save`}
          >
            Save client
          </button>
        </div>
      </div>
    );
  }

  // State B — search
  return (
    <div className="space-y-2" data-testid={`${testidPrefix}-search`}>
      <label className="block text-xs">
        <span className="mb-1 block text-nb-mute">Find client</span>
        <input
          className="nb-input h-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, phone, or email"
          data-testid={`${testidPrefix}-input`}
          autoComplete="off"
        />
      </label>
      {query.trim().length >= 2 && (
        <ul className="max-h-44 space-y-1 overflow-y-auto rounded-2xl bg-sky-50/50 p-1" data-testid={`${testidPrefix}-hits`}>
          {hits.length === 0 && <li className="px-3 py-2 text-xs text-nb-mute">No matches yet.</li>}
          {hits.map((row) => (
            <li key={row.id}>
              <button type="button" className="nb-btn-ghost h-auto w-full justify-start px-3 py-2 text-left text-sm" data-testid={`${testidPrefix}-hit-${row.id}`} onClick={() => pick(row)}>
                <span className="font-semibold">{displayName(row)}</span>
                <span className="ml-2 text-nb-mute">{contactLine(row)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="nb-btn-ghost h-9 w-full justify-center gap-1.5 text-sm" onClick={openCreate} data-testid={`${testidPrefix}-new`}>
        <UserPlus className="h-4 w-4" /> New client
      </button>
      {err && <p className="text-sm text-rose-700" data-testid={`${testidPrefix}-error`}>{err}</p>}
    </div>
  );
}
