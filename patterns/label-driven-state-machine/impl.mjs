/**
 * label-driven-state-machine — minimal simulation
 *
 * Simulates a 3-stage pipeline where labels are the state tokens.
 * Each "workflow" is a function triggered by a label event.
 * Re-pulse: applying an existing label fires another event (retry mechanism).
 */

const MAX_FIX_ATTEMPTS = 3;

// Simulated GitHub PR state
const pr = {
  number: 42,
  labels: new Set(),
  comments: [],
  attempt: 0,
};

function applyLabel(label) {
  const alreadyPresent = pr.labels.has(label);
  pr.labels.add(label);
  // GitHub emits a labeled event even when re-applying — simulate that
  console.log(`[github] labeled: ${label}${alreadyPresent ? " (re-pulse)" : ""}`);
  return { label, repulse: alreadyPresent };
}

function removeLabel(label) {
  pr.labels.delete(label);
}

// Stage 1: Validator
async function onValidatorRun() {
  console.log("[validator] Validating issue...");
  const valid = true; // simulate pass
  if (valid) {
    applyLabel("ready-for-dev");
  } else {
    applyLabel("needs-refinement");
  }
}

// Stage 2: Code generator — triggered by ready-for-dev
async function onReadyForDev() {
  console.log("[generator] Generating code for PR #" + pr.number + "...");
  // ... code generation ...
  applyLabel("needs-review");
}

// Stage 3: Reviewer — triggered by needs-review
async function onNeedsReview() {
  console.log("[reviewer] Reviewing PR #" + pr.number + "...");
  pr.attempt += 1;
  const approved = pr.attempt >= 2; // simulate: passes on 2nd review

  if (approved) {
    removeLabel("changes-requested");
    applyLabel("review-approved");
  } else {
    // Encode attempt in label name; re-apply changes-requested as re-pulse
    applyLabel(`auto-fix-attempt-${pr.attempt}`);
    removeLabel("changes-requested");
    applyLabel("changes-requested"); // re-pulse triggers auto-fix again
  }
}

// Stage 4: Auto-fixer — triggered by changes-requested
async function onChangesRequested() {
  const attemptLabels = [...pr.labels].filter((l) => l.startsWith("auto-fix-attempt-"));
  const currentAttempt = attemptLabels.length;

  if (currentAttempt > MAX_FIX_ATTEMPTS) {
    pr.comments.push("Auto-fix exhausted after 3 attempts. Escalating to human.");
    console.log("[auto-fix] Escalating — attempt limit reached");
    return;
  }

  console.log(`[auto-fix] Fixing PR #${pr.number}, attempt ${currentAttempt}...`);
  // ... apply fix, push commit ...
  // Trigger re-review by applying needs-review
  removeLabel("changes-requested");
  applyLabel("needs-review");
}

// Event dispatcher — simulates GitHub Actions labeled event routing
async function dispatch(label) {
  if (label === "ready-for-dev") await onReadyForDev();
  else if (label === "needs-review") await onNeedsReview();
  else if (label === "changes-requested") await onChangesRequested();
}

// Run the pipeline
await onValidatorRun();

// Process label events as they fire (in real GHA these are async webhook triggers)
const eventQueue = ["ready-for-dev", "needs-review", "changes-requested", "needs-review"];
for (const label of eventQueue) {
  console.log();
  await dispatch(label);
}

console.log("\nFinal labels:", [...pr.labels].sort().join(", "));
console.log("Comments:", pr.comments);
