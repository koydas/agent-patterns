/** Closed-vocabulary feedback selection: no model text or file writes. */
export const LESSONS = Object.freeze({
  module_system: "Use ESM imports; do not introduce require() in .mjs files.",
  test_count_drop: "Preserve existing tests and do not replace suites with stubs.",
  unresolved_import: "Verify every imported module resolves before proposing a patch.",
});
export function selectLessons(signals, { now = Date.now(), window = 30, maxAgeDays = 30, minOccurrences = 2, maxLessons = 3, maxChars = 700, catalog = LESSONS } = {}) {
  const cutoff = now - maxAgeDays * 86400000;
  const recent = window <= 0 || maxLessons <= 0 ? [] : signals.filter(s => s && Number.isFinite(s.ts) && s.ts >= cutoff && s.ts <= now && Object.hasOwn(catalog, s.id)).slice(-window);
  const counts = new Map();
  for (const { id } of recent) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = [...counts].filter(([, n]) => n >= minOccurrences).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const selected = [];
  let used = 0;
  for (const [id, count] of ranked) {
    const text = catalog[id];
    if (typeof text !== "string" || !text || used + text.length > maxChars) continue;
    selected.push({ id, count, text });
    used += text.length;
    if (selected.length === maxLessons) break;
  }
  return selected;
}
