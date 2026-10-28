/** A small, pure reference gate; production also pins workflow invocations. */
export function checkRatchet(floor, proposed) {
  if (!floor || !proposed || !Array.isArray(floor.metrics) || !Array.isArray(floor.cases) ||
      !Array.isArray(proposed.metrics) || !Array.isArray(proposed.cases)) {
    return { ok: false, failures: ["invalid_configuration"] };
  }
  const failures = [];
  const metrics = new Map(proposed.metrics.map(m => [m.id, m]));
  for (const base of floor.metrics) {
    const current = metrics.get(base.id);
    if (!current) { failures.push(`metric_removed:${base.id}`); continue; }
    if (base.optional === false && current.optional !== false) failures.push(`metric_optional:${base.id}`);
    if (base.min !== undefined && (!Number.isFinite(current.min) || current.min < base.min))
      failures.push(`min_weakened:${base.id}`);
    if (base.max !== undefined && (!Number.isFinite(current.max) || current.max > base.max))
      failures.push(`max_weakened:${base.id}`);
  }
  const cases = new Map(proposed.cases.map(c => [c.id, c]));
  for (const base of floor.cases) {
    const current = cases.get(base.id);
    if (!current) { failures.push(`case_removed:${base.id}`); continue; }
    if (current.label !== base.label || current.inputHash !== base.inputHash || current.knownGap === true)
      failures.push(`case_changed:${base.id}`);
  }
  if (proposed.filtered === true) failures.push("filtered_evaluation");
  return { ok: failures.length === 0, failures };
}
