/**
 * escalation-ladder — minimal reference implementation (no API key, no network, no writes)
 *
 * A three-way merge of text hunks. The pattern is the order and the boundary of the rungs:
 *   1. deterministic rungs first (identical sides, one side unchanged) — free, exact, never wrong;
 *   2. a model rung for what is left, over the smallest unit (one hunk, never the file) and post-checked in code;
 *   3. a human for everything else, with the reason as a closed code (no model text).
 * One refused hunk refuses the whole file: a half-merged file is never returned.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const MARKER = /^(<{7}|>{7})/m;
// A bare separator (`=======`) or diff3 base marker (`|||||||`) is a marker only when no side contains it: a Markdown
// setext heading is made of `=======`, but a model cannot add one that none of the sides had.
const SEPARATOR = /^(={7}|\|{7})(?: .*)?$/;
const lines = (t) => String(t).split("\n").map((l) => l.trim()).filter(Boolean);

/** Rung 1: no model. `null` when the hunk is a real conflict. */
export function deterministic({ ours, base, theirs }) {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;
  return null;
}

/** Post-check of a model answer, in code. Lines of none of the three sides are "invented" (a few are legitimate in code). */
export function checkModelAnswer(hunk, answer, { maxInvented = 1 } = {}) {
  if (typeof answer !== "string") return "malformed";
  if (MARKER.test(answer)) return "marker_left";
  const sides = new Set([hunk.ours, hunk.base, hunk.theirs].flatMap((t) => String(t).split("\n")));
  if (answer.split("\n").some((l) => SEPARATOR.test(l) && !sides.has(l))) return "marker_left";
  const known = new Set([...lines(hunk.ours), ...lines(hunk.base), ...lines(hunk.theirs)]);
  return lines(answer).filter((l) => !known.has(l)).length > maxInvented ? "invented_content" : null;
}

/** Same conflict again = same signature: the files and the incoming side, not the base's unrelated movement. */
export const signature = (hunks) => createHash("sha256").update(JSON.stringify(hunks.map((h) => h.theirs))).digest("hex").slice(0, 10);

/**
 * @param {{ ours: string, base: string, theirs: string }[]} hunks
 * @param {{ callModel?: (hunk) => Promise<string>, previous?: { sig: string, escalated: boolean } | null, manual?: boolean }} options
 * @returns {Promise<{ outcome: "resolved", rungs: string[], resolutions: string[] } | { outcome: "escalated", reason: string, hunk: number | null }>}
 */
export async function climb(hunks, { callModel = null, previous = null, manual = false } = {}) {
  // Breaker: the same conflict that already escalated is not tried again by a loop, only by a person.
  if (!manual && previous?.escalated && previous.sig === signature(hunks)) return { outcome: "escalated", reason: "circuit_open", hunk: null };
  const resolutions = [];
  const rungs = [];
  for (const [i, hunk] of hunks.entries()) {
    const free = deterministic(hunk);
    if (free !== null) { resolutions.push(free); rungs.push("deterministic"); continue; }
    if (!callModel) return { outcome: "escalated", reason: "no_model", hunk: i };
    const answer = await callModel(hunk);
    const refused = checkModelAnswer(hunk, answer);
    if (refused) return { outcome: "escalated", reason: refused, hunk: i };
    resolutions.push(answer);
    rungs.push("model");
  }
  return { outcome: "resolved", rungs, resolutions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hunks = [
    { ours: "a\n", base: "a\n", theirs: "a2\n" }, // one side unchanged: free
    { ours: "- ours\n", base: "", theirs: "- theirs\n" }, // both added: needs the model
  ];
  const fakeModel = async (h) => `${h.theirs}${h.ours}`; // stands in for the LLM: union, base side first
  console.log(JSON.stringify(await climb(hunks, { callModel: fakeModel }), null, 2));
  console.log(JSON.stringify(await climb(hunks, { callModel: async () => "- made up\n- also made up\n" }), null, 2));
  console.log("\nNothing was written: the outcome is the only effect.");
}
