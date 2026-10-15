// Mirrors frontend/src/lib/api.js call sites. In this design preview every call resolves locally with mock data.
// Cursor: replace `wait` + store mutations with the real `/api` client (cookies + X-CSRF-Token).
export const wait = (ms = 420) => new Promise((r) => setTimeout(r, ms));

export const HEALTH = { cardCheckout: false, documentUploads: false, mapbox: false, promotionalSending: false };
