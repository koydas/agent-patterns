import { memo } from 'react';

/** Numbered phases of the flow (mockup: 1 Generation · 2 Review · 3 Verdict · 4 Result). */
function StepperImpl({ phases, current }: { phases: { label: string }[]; current: number }) {
  if (!phases.length) return null;
  return (
    <ol className="stepper" aria-label="Phases">
      {phases.map((p, i) => (
        <li key={p.label} className={i === current ? 'on' : i < current ? 'past' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="num">{i + 1}</span>
          <span className="lbl">{p.label}</span>
        </li>
      ))}
    </ol>
  );
}
export const Stepper = memo(StepperImpl);
