import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { unregisterPush } from "@/lib/nativeShell";
import { clearStoredBookingDraft, readStoredBookingDraft, writeStoredBookingDraft } from '@/lib/booking-selection';
import { resolvePractitionerId } from '@/lib/practitionerIdentity';

const Ctx = createContext(null);
const TrainingBridge = createContext(null);
const LS = { client: 'nt_demo_client', pract: 'nt_demo_pract', owner: 'nt_demo_owner' };
const emptyDraft = () => ({ step: 0, bookingFlowVersion: 3, locationType: 'home', address: null, addressQuery: '', addressNotes: '', forceWhere: false, serviceId: null, serviceSlug: null, duration: 60, addons: [], date: null, time: null, practitionerId: '', goals: [], pressure: 'Medium', focus: [], notes: '', paymentMethod: 'self', selfMethod: 'card', insuranceId: null, pendingInsurance: null, checkoutSessionId: null, checkoutAmountCents: null, invoiceId: null, depositCents: null, idempotencyKey: undefined, guest: { firstName: '', lastName: '', email: '', phone: '', createProfile: false, dob: '', insuranceStatus: '', marketingConsent: false } });

export function DemoProvider({ children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(false);
  const [user, setUser] = useState(undefined);
  const [demoMode, setDemoMode] = useState(false);
  const clientId = user?.role === 'client' ? user.subject : null;
  const setClientId = () => {};
  const [practRaw, setPractRaw] = useState('');
  // Prefer the account's linked subject. Never hardcode demo seed ids (p-jordan) — they are absent in production.
  const practitionerId = resolvePractitionerId(user, practRaw);
  const [ownerMode, setOwnerModeRaw] = useState(() => localStorage.getItem(LS.owner) === '1');
  const [draft, setDraft] = useState(() => readStoredBookingDraft(emptyDraft));
  const busy = useRef(false);
  const meSeq = useRef(0);

  useEffect(() => {
    writeStoredBookingDraft(draft);
  }, [draft]);

  const refresh = useCallback(async () => {
    try { setState(await api.state()); setError(false); } catch { setError(true); }
  }, []);

  useEffect(() => {
    refresh();
    const seq = ++meSeq.current;
    api.me()
      .then((profile) => { if (seq === meSeq.current) setUser(profile); })
      .catch(() => { if (seq === meSeq.current) setUser(null); });
    api.authConfig().then((c) => setDemoMode(c.demoMode)).catch(() => {});
    const t = setInterval(() => { if (!document.hidden && !busy.current) refresh(); }, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const applySession = async (profile) => {
    meSeq.current += 1;
    setUser(profile);
    await refresh();
    return profile;
  };
  const authed = async (p) => applySession(await p);
  const auth = {
    user, demoMode,
    login: async (email, password) => {
      const signed = await api.login(email, password);
      if (signed?.mfaRequired || signed?.enrollmentRequired) return signed;
      return applySession(signed);
    },
    register: (body) => authed(api.register(body)),
    demoLogin: async (role, subject) => {
      const signed = await api.demoLogin(role, subject);
      if (signed?.mfaRequired || signed?.enrollmentRequired) return signed;
      return applySession(signed);
    },
    finish: (session) => applySession(session),
    logout: async () => {
      await unregisterPush().catch(() => {});
      await api.logout();
      meSeq.current += 1;
      setUser(null);
      setOwnerModeRaw(false);
      localStorage.removeItem(LS.owner);
      clearStoredBookingDraft();
      setDraft(emptyDraft());
      await refresh();
    },
  };

  const persist = (key, setter) => (v) => { setter(v); v ? localStorage.setItem(key, v === true ? '1' : v) : localStorage.removeItem(key); };
  const setPractitionerId = setPractRaw;
  const setOwnerMode = useCallback(persist(LS.owner, setOwnerModeRaw), []); // eslint-disable-line

  const run = useCallback(async (fn, okMsg) => {
    busy.current = true;
    try { const r = await fn(); await refresh(); if (okMsg) toast.success(okMsg); return r; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Something went wrong — please try again.'); throw e; }
    finally { busy.current = false; }
  }, [refresh]);

  const idx = useMemo(() => {
    if (!state) return null;
    const by = (k, key = 'id') => Object.fromEntries(state[k].map((x) => [x[key], x]));
    return { services: by('services', 'slug'), clients: by('clients'), practitioners: by('practitioners'), soap: by('soap', 'appointmentId'), settings: state.settings[0] };
  }, [state]);

  const patchDraft = useCallback((p) => {
    setDraft((d) => ({ ...d, ...(typeof p === "function" ? p(d) : p) }));
  }, []);
  const resetDraft = useCallback(() => {
    clearStoredBookingDraft();
    setDraft(emptyDraft());
  }, []);
  const value = {
    ...auth,
    setUser,
    perm: (k) => !!state?.settings?.[0]?.receptionPerms?.[k], // simulated client-side check; production enforces server-side
    state, idx, error, refresh, run, api,
    clientId, setClientId, practitionerId, setPractitionerId, ownerMode, setOwnerMode,
    me: idx && clientId ? idx.clients[clientId] : null,
    draft, setDraft,
    patchDraft,
    resetDraft,
    resetDemo: () => run(async () => { await api.reset(); clearStoredBookingDraft(); setDraft(emptyDraft()); }, 'Demo data reset'),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function TrainingBridgeProvider({ value, children }) {
  return <TrainingBridge.Provider value={value}>{children}</TrainingBridge.Provider>;
}
export const useDemo = () => useContext(TrainingBridge) || useContext(Ctx);
