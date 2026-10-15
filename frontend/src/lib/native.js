// Native (Capacitor) session mode: Bearer access token plus a rotating refresh token kept in the device's secure store.
const HEADER = { 'X-Nabitouch-Client': 'native' };
let memory = {};
let store = {
  get: async (key) => memory[key] || null,
  set: async (key, value) => { memory[key] = value; },
  remove: async (key) => { delete memory[key]; },
};

export const isNative = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// The native shell passes a Keychain / Keystore adapter here at startup. The default is memory only.
export const setTokenStore = (adapter) => { store = adapter; };
let storeReady = Promise.resolve();
export const deferStore = (pending) => { storeReady = pending.catch(() => {}); };

const save = async (pair) => {
  if (pair?.accessToken) await store.set('nb.access', pair.accessToken);
  if (pair?.refreshToken) await store.set('nb.refresh', pair.refreshToken);
};
export const clearTokens = async () => { await store.remove('nb.access'); await store.remove('nb.refresh'); };

export function attachNative(http) {
  http.interceptors.request.use(async (cfg) => {
    if (!isNative()) return cfg;
    await storeReady;
    Object.assign(cfg.headers, HEADER);
    const access = await store.get('nb.access');
    if (access && !cfg.headers.Authorization) cfg.headers.Authorization = `Bearer ${access}`;
    return cfg;
  });
}

export const nativeAuth = (http) => {
  const post = (url, body, extra = {}) => http.post(url, body, { headers: { ...HEADER, ...extra } }).then((r) => r.data);
  const finish = async (res) => { if (res.mfaRequired) return res; await save(res); return res.user; };
  let refreshing = null;
  return {
    login: (email, password, device) => post('/auth/native/login', { email, password, device }).then(finish),
    mfaVerify: (challenge, code, device) => post('/auth/native/mfa/verify', { challenge, code, device }).then(finish),
    refresh: () => {
      refreshing = refreshing || (async () => {
        const refreshToken = await store.get('nb.refresh');
        if (!refreshToken) throw new Error('No native session');
        try { await save(await post('/auth/native/refresh', { refreshToken })); }
        catch (e) { await clearTokens(); throw e; }
      })().finally(() => { refreshing = null; });
      return refreshing;
    },
    logout: async () => {
      const refreshToken = await store.get('nb.refresh');
      await clearTokens();
      return post('/auth/native/logout', { refreshToken }).catch(() => ({ ok: true }));
    },
  };
};
