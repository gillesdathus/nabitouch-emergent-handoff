import { CLIENT_ENV_KEYS, clientEnvDefines } from "./client-env";

test("the browser build receives only the classified public variables", () => {
  const defined = clientEnvDefines({
    REACT_APP_BACKEND_URL: "https://booking.example.test",
    REACT_APP_MAPBOX_PUBLIC_TOKEN: "pk.public",
    REACT_APP_TRACKING_MODE: "simulated",
    MAPBOX_TOKEN: "sk.server-only",
    JWT_SECRET: "not-for-the-browser",
    OWNER_PASSWORD: "not-for-the-browser",
  });
  expect(Object.keys(defined)).toEqual(CLIENT_ENV_KEYS.map((key) => `process.env.${key}`));
  expect(defined["process.env.REACT_APP_BACKEND_URL"]).toBe(JSON.stringify("https://booking.example.test"));
  expect(defined["process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN"]).toBe(JSON.stringify("pk.public"));
  const serialized = JSON.stringify(defined);
  expect(serialized).not.toContain("sk.server-only");
  expect(serialized).not.toContain("not-for-the-browser");
});

test("a secret Mapbox token is refused before it can be bundled", () => {
  expect(() => clientEnvDefines({ REACT_APP_MAPBOX_PUBLIC_TOKEN: "sk.secret" })).toThrow(/public pk/);
});

test("missing public variables stay unset instead of becoming another host", () => {
  const defined = clientEnvDefines({});
  expect(defined["process.env.REACT_APP_BACKEND_URL"]).toBe("undefined");
  expect(defined["process.env.REACT_APP_TRACKING_MODE"]).toBe("undefined");
});

test("a production build accepts the documented https origin and a public map token", () => {
  const defined = clientEnvDefines({
    REACT_APP_BACKEND_URL: "https://nabitouch.com",
    REACT_APP_MAPBOX_PUBLIC_TOKEN: "pk.public-build-check",
    REACT_APP_TRACKING_MODE: "simulated",
    MAPBOX_TOKEN: "sk.server-only",
    JWT_SECRET: "server-secret",
  }, { mode: "production" });
  expect(defined["process.env.REACT_APP_BACKEND_URL"]).toBe(JSON.stringify("https://nabitouch.com"));
  expect(defined["process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN"]).toBe(JSON.stringify("pk.public-build-check"));
  expect(JSON.stringify(defined)).not.toContain("sk.server-only");
  expect(JSON.stringify(defined)).not.toContain("server-secret");
});

test.each([
  ["", /required/],
  ["undefined", /required/],
  ["nabitouch.com", /absolute https/],
  ["http://nabitouch.com", /https/],
  ["http://localhost:3025", /https/],
  ["https://localhost:3025", /local or private/],
  ["https://127.0.0.1:18014", /local or private/],
  ["https://10.0.0.8", /local or private/],
  ["https://192.168.1.20", /local or private/],
  ["https://user:secret@nabitouch.com", /credentials/],
  ["https://nabitouch.com/api", /appends \/api/],
])("a production build rejects %j", (origin, pattern) => {
  expect(() => clientEnvDefines({
    REACT_APP_BACKEND_URL: origin,
    REACT_APP_MAPBOX_PUBLIC_TOKEN: "pk.public",
  }, { mode: "production" })).toThrow(pattern);
});

test("a malformed public map token is refused", () => {
  expect(() => clientEnvDefines({ REACT_APP_MAPBOX_PUBLIC_TOKEN: "not-a-token" })).toThrow(/public pk/);
});

test("a private payment or database credential cannot ride along in a public variable", () => {
  expect(() => clientEnvDefines({
    REACT_APP_BACKEND_URL: "https://nabitouch.com",
    REACT_APP_MAPBOX_PUBLIC_TOKEN: "pk.sk_live_hidden",
  }, { mode: "production" })).toThrow(/private credential/);
  expect(() => clientEnvDefines({
    REACT_APP_BACKEND_URL: "mongodb://user:secret@db.example/nabitouch",
  }, { mode: "production" })).toThrow(/private credential/);
});
