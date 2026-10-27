/** Pure model of an upgrade gate; actual databases require engine-specific checks. */
export function verifyUpgrade({ oldVersion, newVersion, oldState, migration, canReadInPlace = false }) {
  if (!oldVersion || !newVersion || !oldState || typeof oldState !== "object") return { ok: false, reason: "invalid_setup" };
  const original = structuredClone(oldState);
  let next;
  try {
    if (oldVersion === newVersion || canReadInPlace) next = structuredClone(oldState);
    else if (typeof migration === "function") next = migration(structuredClone(oldState));
    else return { ok: false, reason: "migration_required" };
    if (!next || typeof next !== "object") return { ok: false, reason: "invalid_migration" };
    for (const [key, value] of Object.entries(original)) {
      if (!Object.hasOwn(next, key) || JSON.stringify(next[key]) !== JSON.stringify(value)) return { ok: false, reason: "data_mismatch" };
    }
    return { ok: true, reason: "verified" };
  } catch {
    return { ok: false, reason: "migration_failed" };
  }
}
