/** Browser-visible build variables. Everything else stays on the server. */
export const CLIENT_ENV_KEYS = [
  "REACT_APP_BACKEND_URL",
  "REACT_APP_MAPBOX_PUBLIC_TOKEN",
  "REACT_APP_TRACKING_MODE",
];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function definedValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function privateHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "undefined" || LOOPBACK.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".invalid")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** Empty string means the origin is acceptable for a production bundle. */
export function productionApiOriginError(value) {
  const raw = definedValue(value);
  if (!raw || raw === "undefined") {
    return "REACT_APP_BACKEND_URL is required for a production build. An empty value would call undefined/api.";
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "REACT_APP_BACKEND_URL must be an absolute https origin.";
  }
  if (url.protocol !== "https:") {
    return "REACT_APP_BACKEND_URL must use https for a production build.";
  }
  if (url.username || url.password) {
    return "REACT_APP_BACKEND_URL must not include credentials.";
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return "REACT_APP_BACKEND_URL must be an origin. The client appends /api itself.";
  }
  if (privateHost(url.hostname)) {
    return "REACT_APP_BACKEND_URL must not point at a local or private host in a production build.";
  }
  return "";
}

/** Empty string means the token may be omitted. A present token must be a public pk. token. */
export function mapboxTokenError(token) {
  const value = definedValue(token);
  if (!value) return "";
  if (/\s/.test(String(token))) return "REACT_APP_MAPBOX_PUBLIC_TOKEN must be a single public pk. token.";
  if (value.startsWith("sk.")) {
    return "REACT_APP_MAPBOX_PUBLIC_TOKEN must be a public pk. token, not a secret sk. token.";
  }
  if (!value.startsWith("pk.")) return "REACT_APP_MAPBOX_PUBLIC_TOKEN must be a public pk. token.";
  return "";
}

export function trackingModeError(mode) {
  const value = definedValue(mode);
  if (!value) return "";
  if (value !== "simulated" && value !== "live") return "REACT_APP_TRACKING_MODE must be simulated or live.";
  return "";
}

function privateCredential(value) {
  return /sk_live|sk_test_|mongodb(\+srv)?:\/\//i.test(String(value || ""));
}

export function clientEnvDefines(env = {}, options = {}) {
  const source = env || {};
  const release = options.mode === "production";
  for (const key of CLIENT_ENV_KEYS) {
    if (privateCredential(source[key])) {
      throw new Error(`${key} contains a private credential and cannot be bundled.`);
    }
  }
  const tokenError = mapboxTokenError(source.REACT_APP_MAPBOX_PUBLIC_TOKEN);
  if (tokenError) throw new Error(tokenError);
  const trackError = trackingModeError(source.REACT_APP_TRACKING_MODE);
  if (trackError) throw new Error(trackError);
  if (release) {
    const originError = productionApiOriginError(source.REACT_APP_BACKEND_URL);
    if (originError) throw new Error(originError);
  }
  return Object.fromEntries(
    CLIENT_ENV_KEYS.map((key) => [
      `process.env.${key}`,
      source[key] === undefined || source[key] === "" ? "undefined" : JSON.stringify(String(source[key])),
    ]),
  );
}
