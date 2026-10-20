/** Shared dirty-form registry so PWA updates do not wipe unsaved SOAP / booking work. */
const dirty = new Set();

export function markDirty(id) {
  if (id) dirty.add(String(id));
}

export function clearDirty(id) {
  if (id) dirty.delete(String(id));
}

export function isDirty() {
  return dirty.size > 0;
}

export function dirtyIds() {
  return [...dirty];
}
