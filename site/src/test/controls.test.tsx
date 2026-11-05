import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Playground } from '../components/Playground';
import { Compare } from '../components/Compare';
import { normalize } from '../engine/trace';
import { SIMS } from '../patterns';

const sim = SIMS['loop-with-guard'];
const timeline = () => within(screen.getAllByRole('region', { name: 'Execution timeline' })[0]);
const current = () => timeline().getByText((_, el) => el?.tagName === 'LI' && el.getAttribute('data-current') === 'true');

describe('Playground controls', () => {
  beforeEach(() => {
    render(<Playground sim={sim} title="loop-with-guard" initialConfig={normalize(sim, {})} initialSeed={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  });

  it('Step advances one event at a time and Reset goes back to the start', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const first = current().textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));
    expect(current().textContent).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(current().textContent).toBe(first);
  });

  it('Play toggles to Pause and back', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('speed is a radio group with 0.5×, 1× and 2×', () => {
    const group = screen.getByRole('radiogroup', { name: 'Playback speed' });
    fireEvent.click(within(group).getByRole('radio', { name: '2×' }));
    expect(within(group).getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a failure scenario changes the simulated outcome', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer never approves' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const scrub = screen.getByLabelText('Simulated time') as HTMLInputElement;
    act(() => { fireEvent.change(scrub, { target: { value: scrub.max } }); });
    expect(screen.getAllByText('ESCALATED — round cap reached').length).toBeGreaterThan(0);
  });

  it('a parameter change restarts the run with the new configuration', () => {
    const scrub = screen.getByLabelText('Simulated time') as HTMLInputElement;
    act(() => { fireEvent.change(scrub, { target: { value: scrub.max } }); });
    fireEvent.change(screen.getByLabelText('Max rounds (cap)'), { target: { value: '2' } });
    expect(Number((screen.getByLabelText('Simulated time') as HTMLInputElement).value)).toBe(0);
  });

  it('keyboard: → steps, R resets', () => {
    const stage = screen.getByLabelText(/loop-with-guard simulation/);
    const first = current().textContent;
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(current().textContent).not.toBe(first);
    fireEvent.keyDown(stage, { key: 'r' });
    expect(current().textContent).toBe(first);
  });
});

describe('Compare', () => {
  it('runs both scenarios on one clock and fills the comparison from their histories', () => {
    render(<Compare sim={SIMS['fan-out']} title="fan-out" initial={{ a: normalize(SIMS['fan-out'], {}), b: normalize(SIMS['fan-out'], {}), seedA: 7, seedB: 7 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sequential vs parallel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const scrub = screen.getByLabelText('Simulated time') as HTMLInputElement;
    act(() => { fireEvent.change(scrub, { target: { value: scrub.max } }); });
    const table = within(screen.getByRole('region', { name: 'Comparative metrics' }));
    const row = table.getByText('Worker span').closest('tr')!;
    expect(row.textContent).toContain('8.00 s');
    expect(row.textContent).toContain('2.00 s');
    expect(screen.getByRole('region', { name: 'Observed trade-off' }).textContent).toMatch(/more simultaneous resource use/);
  });

  it('Copy A → B makes both scenarios identical', () => {
    render(<Compare sim={sim} title="lwg" initial={{ a: normalize(sim, { maxRounds: 2 }), b: normalize(sim, { maxRounds: 5 }), seedA: 1, seedB: 1 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy A → B' }));
    const panels = screen.getAllByLabelText('Max rounds (cap)') as HTMLInputElement[];
    expect(panels.map((p) => p.value)).toEqual(['2', '2']);
  });
});

describe('Featured walkthrough', () => {
  it('steps through the phases of the real loop-with-guard run', async () => {
    const { Featured } = await import('../components/Featured');
    render(<Featured />);
    const stepper = screen.getAllByRole('list', { name: 'Phases' })[0];
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    expect(within(stepper).getByText('Generation').closest('li')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /Next step/ }));
    expect(within(stepper).getByText('Review').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(stepper).getByText('Generation').closest('li')).toHaveClass('past');
  });
});
