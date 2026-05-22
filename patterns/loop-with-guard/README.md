# loop-with-guard

An agent iterates in a loop — coder → reviewer → coder — with an explicit exit condition and a round cap to prevent infinite loops.

## How it works

1. The **coder** agent produces or improves a solution.
2. The **reviewer** agent evaluates it and responds with `APPROVED` or `CHANGES_REQUESTED`.
3. If approved, the loop exits cleanly.
4. If the round cap is reached without approval, the task escalates to a human gate.

## When to use

- Code generation or refinement tasks where quality can be evaluated programmatically.
- Any iterative improvement loop where convergence is not guaranteed.

## When not to use

- Tasks where the reviewer's criteria are vague — you'll hit the cap every time.
- Tasks where each iteration is expensive (API calls, compute) and a tight round cap is not acceptable.

## Trade-offs

| | |
|---|---|
| **Pro** | Prevents infinite loops with a hard cap |
| **Pro** | Escalates gracefully rather than silently failing |
| **Con** | Round cap is a blunt instrument — too low and valid tasks escalate; too high and costs grow |
| **Con** | Reviewer and coder must share enough context for the loop to converge |

## Failure modes

- **Never-converging loop** — reviewer criteria conflict with coder capabilities; always hits the cap.
- **False approval** — reviewer approves suboptimal output to exit the loop (prompt leakage of the exit condition).
