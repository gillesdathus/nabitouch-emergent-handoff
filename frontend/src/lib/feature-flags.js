/** Restricted features render only when the server sends a boolean true. */
export function restrictedFlag(settings, key) {
  return settings?.[key] === true;
}
