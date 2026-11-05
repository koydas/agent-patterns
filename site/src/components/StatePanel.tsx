import { memo } from 'react';
import type { PatternSim, VarValue } from '../engine/types';

function Value({ v, empty }: { v: VarValue | undefined; empty?: string }) {
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">{empty ?? 'none'}</span>;
    return (
      <ul className="chips">
        {v.map((x, i) => {
          const [text, tone] = x.split('|');
          return <li key={`${x}-${i}`} className={`chip static ${tone ? `tone-${tone}` : ''}`}>{text}</li>;
        })}
      </ul>
    );
  }
  if (v === undefined || v === '') return <span className="muted">{empty ?? '—'}</span>;
  if (typeof v === 'boolean') return <span>{v ? 'yes' : 'no'}</span>;
  const [text, tone] = String(v).split('|');
  return <span className={tone ? `tone-${tone}` : ''}>{text}</span>;
}

function StatePanelImpl({ sim, vars }: { sim: PatternSim; vars: Record<string, VarValue> }) {
  if (!sim.state?.length) return null;
  return (
    <section className="panel state" aria-label="Run state">
      <h3 className="panel-title">State</h3>
      <dl>
        {sim.state.map((s) => (
          <div key={s.key}>
            <dt>{s.label}</dt>
            <dd><Value v={vars[s.key]} empty={s.empty} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
export const StatePanel = memo(StatePanelImpl);
