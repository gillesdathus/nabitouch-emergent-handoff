import { useEffect, useMemo, useState } from "react";
import { Confirm } from "@/components/ui-kit";
import { api, apiError } from "@/lib/api";
import { OPEN } from "@/lib/domain";

function labelFor(row) {
  const communities = (row.communities || []).filter(Boolean);
  if (communities.length) return `${row.name} (incl. ${communities.join(", ")})`;
  return row.name;
}

function liveVisitsFor(appointments, municipalityId) {
  return (appointments || []).filter(
    (a) => OPEN.includes(a.status) && String(a.address?.zoneId || a.zoneId || "") === `muni-${municipalityId}`,
  );
}

export function MunicipalityCoverage({
  coverage,
  appointments = [],
  onSave,
  disabled = false,
}) {
  const [catalog, setCatalog] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(coverage.municipalityIds || []));
  const [custom, setCustom] = useState(() => coverage.customMunicipalities || []);
  const [extraQ, setExtraQ] = useState("");
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraMsg, setExtraMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let alive = true;
    api.geoMunicipalities()
      .then((body) => {
        if (!alive) return;
        setCatalog(body.municipalities || []);
        setLoadError("");
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(apiError(err));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setSelected(new Set(coverage.municipalityIds || []));
    setCustom(coverage.customMunicipalities || []);
    setDirty(false);
  }, [coverage.municipalityIds, coverage.customMunicipalities]);

  const byId = useMemo(() => Object.fromEntries(catalog.map((row) => [row.id, row])), [catalog]);

  const filtered = useMemo(() => {
    const key = query.trim().toLowerCase();
    if (!key) return catalog;
    return catalog.filter((row) => {
      const hay = [row.name, row.type, ...(row.aliases || []), ...(row.communities || [])].join(" ").toLowerCase();
      return hay.includes(key);
    });
  }, [catalog, query]);

  const summary = useMemo(() => {
    const names = [...selected].map((id) => byId[id]?.name || id).filter(Boolean);
    const customNames = custom.map((c) => c.name).filter(Boolean);
    return [...names, ...customNames];
  }, [selected, custom, byId]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  };

  const selectAll = () => {
    setSelected(new Set(catalog.map((row) => row.id)));
    setDirty(true);
  };

  const clearAll = () => {
    const live = (appointments || []).filter(
      (a) => OPEN.includes(a.status) && String(a.address?.zoneId || "").startsWith("muni-"),
    );
    if (live.length) {
      setConfirm({
        kind: "clear",
        title: "Clear all coverage locations?",
        body: `${live.length} upcoming visit(s) are in locations you are removing. Existing bookings stay active; only future booking eligibility changes.`,
        apply: () => { setSelected(new Set()); setDirty(true); },
      });
      return;
    }
    setSelected(new Set());
    setDirty(true);
  };

  const removeOne = (id) => {
    const live = liveVisitsFor(appointments, id);
    if (live.length) {
      setConfirm({
        kind: "remove",
        title: `Remove ${byId[id]?.name || id}?`,
        body: `${live.length} upcoming visit(s) are associated with this location. Existing bookings will not be cancelled; new bookings at this location will be blocked after save.`,
        apply: () => toggle(id),
      });
      return;
    }
    toggle(id);
  };

  const addOutside = async () => {
    const q = extraQ.trim();
    if (q.length < 2) return;
    setExtraBusy(true);
    setExtraMsg("");
    try {
      const body = await api.geoMunicipalitySearch(q);
      if (body.match === "catalogue" && body.municipality?.id) {
        setSelected((prev) => new Set(prev).add(body.municipality.id));
        setDirty(true);
        setExtraMsg(`Added catalogue municipality: ${body.municipality.name}.`);
        setExtraQ("");
        return;
      }
      const suggestion = body.suggestion;
      if (!suggestion?.id) {
        setExtraMsg("No verified place found.");
        return;
      }
      if (custom.some((c) => c.id === suggestion.id || (suggestion.mapboxId && c.mapboxId === suggestion.mapboxId))) {
        setExtraMsg("That location is already in your custom list.");
        return;
      }
      setCustom((prev) => [...prev, suggestion]);
      setDirty(true);
      setExtraMsg(`Added verified place: ${suggestion.name}.`);
      setExtraQ("");
    } catch (err) {
      setExtraMsg(apiError(err));
    } finally {
      setExtraBusy(false);
    }
  };

  const persist = () => {
    const payload = {
      mode: "zones",
      municipalityIds: [...selected],
      customMunicipalities: custom,
      travelFeesEnabled: !!coverage.travelFeesEnabled,
      radiusKm: coverage.radiusKm ?? 25,
    };
    const wasOpen = (coverage.mode || "open") !== "zones";
    const newlyRestricted = wasOpen || (!(coverage.municipalityIds || []).length && !(coverage.customMunicipalities || []).length);
    if (newlyRestricted && (selected.size || custom.length)) {
      setConfirm({
        kind: "activate",
        title: "Activate restricted municipality coverage?",
        body: "New bookings will only be allowed in the selected municipalities. Open coverage will turn off. Existing appointments are not cancelled.",
        apply: () => { onSave(payload); setDirty(false); },
      });
      return;
    }
    onSave(payload);
    setDirty(false);
  };

  return (
    <div className="space-y-3" data-testid="settings-coverage-locations">
      <div>
        <p className="font-semibold">Locations</p>
        <p className="text-xs text-nb-mute">
          Select municipalities from the Edmonton Metropolitan Region catalogue (Statistics Canada CSD identifiers).
          Sherwood Park is covered when Strathcona County is selected. Nothing is selected by default.
        </p>
      </div>
      {loadError && <p className="text-xs text-rose-700" data-testid="settings-coverage-locations-error">{loadError}</p>}
      <label>
        <span className="nb-label">Search municipalities</span>
        <input
          className="nb-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Edmonton, Spruce Grove, Sherwood Park…"
          data-testid="settings-coverage-muni-search"
          disabled={disabled}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-coverage-select-all" onClick={selectAll} disabled={disabled || !catalog.length}>Select all</button>
        <button type="button" className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-coverage-clear-all" onClick={clearAll} disabled={disabled || !selected.size}>Clear all</button>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-sky-100 p-2" data-testid="settings-coverage-muni-list">
        {filtered.map((row) => {
          const on = selected.has(row.id);
          return (
            <label key={row.id} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 text-sm ${on ? "bg-sky-50" : "hover:bg-slate-50"}`} data-testid={`settings-coverage-muni-${row.id}`}>
              <input
                type="checkbox"
                className="mt-1"
                checked={on}
                disabled={disabled}
                onChange={() => (on ? removeOne(row.id) : toggle(row.id))}
                data-testid={`settings-coverage-muni-check-${row.id}`}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{labelFor(row)}</span>
                <span className="block text-[11px] text-nb-mute">{row.type} · CSD {row.csdUid || row.id}</span>
                {row.note ? <span className="block text-[11px] text-nb-mute">{row.note}</span> : null}
              </span>
            </label>
          );
        })}
        {!filtered.length && <p className="px-2 py-3 text-xs text-nb-mute">No municipalities match that search.</p>}
      </div>
      <div className="rounded-2xl bg-slate-50 p-3 text-sm" data-testid="settings-coverage-selected-summary">
        <b>{summary.length ? `${summary.length} selected` : "No locations selected"}</b>
        <p className="mt-1 text-xs text-nb-mute">{summary.length ? summary.join(", ") : "Restricted zones mode will not accept mobile addresses until you select municipalities or add a verified place."}</p>
      </div>
      {!!custom.length && (
        <div className="space-y-2" data-testid="settings-coverage-custom-list">
          <p className="text-xs font-semibold">Added places</p>
          {custom.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm">
              <span>{c.name}<span className="block text-[11px] text-nb-mute">Verified place · {c.radiusKm || 12} km radius</span></span>
              <button
                type="button"
                className="nb-btn-ghost h-8 px-3 text-xs"
                data-testid={`settings-coverage-custom-remove-${c.id}`}
                onClick={() => { setCustom((prev) => prev.filter((row) => row.id !== c.id)); setDirty(true); }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 border-t border-sky-100 pt-3">
        <p className="text-xs font-semibold">Add a location outside this list</p>
        <p className="text-[11px] text-nb-mute">Uses verified place data. Catalogue matches (for example Sherwood Park → Strathcona County) are preferred over free-text names.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="nb-input flex-1"
            value={extraQ}
            onChange={(e) => setExtraQ(e.target.value)}
            placeholder="Municipality or community in Alberta"
            data-testid="settings-coverage-extra-search"
            disabled={disabled || extraBusy}
          />
          <button type="button" className="nb-btn-ghost h-11 px-4 text-xs" data-testid="settings-coverage-extra-add" onClick={addOutside} disabled={disabled || extraBusy || extraQ.trim().length < 2}>
            {extraBusy ? "Searching…" : "Add verified place"}
          </button>
        </div>
        {extraMsg ? <p className="text-xs text-nb-mute" data-testid="settings-coverage-extra-msg">{extraMsg}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="nb-btn-primary h-11 px-5 text-sm"
          data-testid="settings-coverage-locations-save"
          disabled={disabled || !dirty}
          onClick={persist}
        >
          Save and activate coverage
        </button>
      </div>
      <Confirm
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.title || ""}
        body={confirm?.body || ""}
        confirmLabel="Continue"
        testid="settings-coverage-confirm"
        onConfirm={() => {
          const apply = confirm?.apply;
          setConfirm(null);
          if (apply) apply();
        }}
      />
    </div>
  );
}
