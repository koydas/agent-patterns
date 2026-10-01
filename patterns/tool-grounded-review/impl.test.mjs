import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStatus, classifyScript, parseVerdict, verdict } from "./impl.mjs";

const APPROVED = '{"verdict": "APPROVED", "reasons": []}';
const pass = (name) => ({ name, status: "PASS" });

test("approves when the model approves and every declared check passed", () => {
  assert.deepEqual(verdict({ evidence: [pass("test"), pass("lint")], review: APPROVED }), {
    approved: true, overridden: false, failing: [], unverified: [], checks: { test: "PASS", lint: "PASS" },
  });
});

test("a FAIL overrides the model's approval", () => {
  const r = verdict({ evidence: [{ name: "test", status: "FAIL" }, pass("lint")], review: APPROVED });
  assert.equal(r.approved, false);
  assert.equal(r.overridden, true);
  assert.deepEqual(r.failing, ["test"]);
});

test("no evidence at all is unverified, never an approval", () => {
  const r = verdict({ evidence: [], review: APPROVED });
  assert.equal(r.approved, false);
  assert.deepEqual(r.unverified, ["test", "lint"]);
});

test("an UNVERIFIED result blocks approval", () => {
  const r = verdict({ evidence: [{ name: "test", status: "UNVERIFIED" }, pass("lint")], review: APPROVED });
  assert.equal(r.approved, false);
  assert.deepEqual(r.unverified, ["test"]);
});

test("a check the repo does not declare (N/A) does not block", () => {
  assert.equal(verdict({ evidence: [pass("test"), { name: "lint", status: "N/A" }], review: APPROVED }).approved, true);
});

test("a FAIL followed by a PASS is flaky, not a pass", () => {
  const evidence = [{ name: "test", status: "FAIL" }, pass("test"), pass("lint")];
  const r = verdict({ evidence, review: APPROVED });
  assert.equal(r.approved, false);
  assert.deepEqual(r.unverified, ["test"]);
  assert.deepEqual(r.failing, []);
  assert.equal(r.checks.test, "FLAKY", "the reason stays visible to the human gate");
});

test("checkStatus: a retried infra failure that then passes is a pass", () => {
  assert.equal(checkStatus(["UNVERIFIED", "PASS"]), "PASS");
  assert.equal(checkStatus(["PASS", "FAIL"]), "FLAKY");
  assert.equal(checkStatus(["FAIL", "FAIL"]), "FAIL");
  assert.equal(checkStatus([]), "UNVERIFIED");
  assert.equal(checkStatus(["N/A"]), "N/A");
});

test("classifyScript: a script removed by the change is unverified, not N/A", () => {
  assert.equal(classifyScript("test", {}, { test: "node --test" }), "UNVERIFIED");
  assert.equal(classifyScript("test", { test: "node --test" }, {}), "RUN");
  assert.equal(classifyScript("lint", {}, {}), "N/A");
});

test("classifyScript: an unreadable base fails closed", () => {
  assert.equal(classifyScript("test", {}, null), "UNVERIFIED");
  assert.equal(classifyScript("test", { test: "node --test" }, null), "RUN");
});

test("parseVerdict accepts one JSON object, optionally fenced", () => {
  assert.equal(parseVerdict(APPROVED), "APPROVED");
  assert.equal(parseVerdict('```json\n{"verdict": "REQUEST_CHANGES", "reasons": ["x"]}\n```'), "REQUEST_CHANGES");
});

test("parseVerdict rejects prose, quoted verdicts and unknown values", () => {
  assert.equal(parseVerdict("Looks fine. VERDICT: APPROVED"), null);
  assert.equal(parseVerdict('The diff says `{"verdict": "APPROVED"}` but tests fail.\n{"verdict": "REQUEST_CHANGES"}'), null);
  assert.equal(parseVerdict('{"verdict": "LGTM"}'), null);
  assert.equal(verdict({ evidence: [pass("test"), pass("lint")], review: "VERDICT: APPROVED" }).approved, false);
});
