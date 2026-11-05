import { useEffect, useMemo, useState } from 'react';
import { catalog, rootReadme as root } from '../content';
import { CATEGORY_LABEL, type Category } from '../content/types';
import { href } from '../router';
import { HeroPipeline } from '../components/HeroPipeline';
import { Featured } from '../components/Featured';
import { Icon } from '../components/Icons';
import { StatusPill } from '../components/Pills';
import { PageHead } from '../components/Layout';
import { dashboardsFor } from '../dashboards';

const REPO_INFO: Record<string, string> = {
  'autonomous-dev-loop': 'GitHub-native, headless: issue → validation → generation → PR → AI review → auto-fix → human merge.',
  'ai-dev-tools': 'Claude Code toolbox: commands, agents and scripts as interactive, human-gated pipelines.',
  'fullstack-pilot': 'Polyglot multi-service repo; stateful database upgrade CI.',
  'repo-orchestrator': 'Cross-repository coherence; its S0 spike validated the resumable approval gate.',
};
const CATS = ['flow', 'quality', 'reliability'] as const;
const catFrom = (search: string): Category | 'all' => {
  const c = new URLSearchParams(search).get('category');
  return CATS.includes(c as Category) ? (c as Category) : 'all';
};

export function Home({ search = '' }: { search?: string }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>(() => catFrom(search));
  useEffect(() => setCat(catFrom(search)), [search]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((p) => (cat === 'all' || p.category === cat) && (!needle || `${p.slug} ${p.problemText} ${p.description} ${p.runningInText}`.toLowerCase().includes(needle)));
  }, [q, cat]);
  const production = catalog.filter((p) => p.status === 'production').length;
  const offline = catalog.filter((p) => p.offline).length;
  const repos = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of catalog) for (const r of p.repos) if (r !== 'agent-patterns') m.set(r, [...(m.get(r) ?? []), p.slug]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, []);
  const notes = root.sections.find((s) => s.id === 'production-notes');

  return (
    <>
      <PageHead
        eyebrow="Multi-agent patterns"
        title={`${catalog.length} patterns for designing robust multi-agent systems`}
        lede={<>Named after real problems in the <a href="https://github.com/koydas/autonomous-dev-loop" rel="noopener">autonomous-dev-loop</a> and <a href="https://github.com/koydas/ai-dev-tools" rel="noopener">ai-dev-tools</a> pipelines: interactive simulations, trade-offs, failure modes and runnable code.</>}
      />
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <div className="hero-cta">
              <a className="btn primary lg" href="#catalogue"><Icon name="play" size={13} /> Explore the patterns <Icon name="arrow" size={16} /></a>
              <a className="btn lg" href="https://github.com/koydas/agent-patterns" rel="noopener"><Icon name="github" size={17} /> View on GitHub</a>
            </div>
          </div>
          <HeroPipeline />
        </div>
        <div className="wrap">
          <ul className="features" aria-label="What is in the collection">
            <li><Icon name="layers" size={24} /><span><b>{catalog.length} documented patterns</b><small>{production} running in public repos</small></span></li>
            <li><Icon name="bolt" size={24} /><span><b>Animated, interactive</b><small>seeded simulations, Explore + Compare</small></span></li>
            <li><Icon name="code" size={24} /><span><b>Runnable code</b><small>{offline} impls run offline, no API key</small></span></li>
            <li><Icon name="cloud" size={24} /><span><b>Static site</b><small>React + Vite on GitHub Pages</small></span></li>
          </ul>
        </div>
      </section>

      <section className="section" id="catalogue" aria-labelledby="catalogue-title">
        <div className="wrap">
          <div className="section-head">
            <div className="title-icon">
              <Icon name="grid" size={26} />
              <div>
                <h2 id="catalogue-title">The {catalog.length} patterns</h2>
                <p>Concrete patterns, named after the problem they solved, organized by category.</p>
              </div>
            </div>
            <div className="seg-filter" role="group" aria-label="Category">
              {(['all', ...CATS] as const).map((c) => (
                <button key={c} type="button" className={cat === c ? 'on' : ''} aria-pressed={cat === c} onClick={() => setCat(c)}>
                  {c === 'all' ? 'All' : CATEGORY_LABEL[c]} ({c === 'all' ? catalog.length : catalog.filter((p) => p.category === c).length})
                </button>
              ))}
            </div>
          </div>
          <label className="search">
            <span className="sr-only">Search patterns</span>
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search by problem: retry, approval, cost, labels…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <p className="sr-only" aria-live="polite">{filtered.length} patterns shown</p>
          {filtered.length === 0 ? (
            <p className="empty">No pattern matches “{q}”.</p>
          ) : (
            <ul className="grid-cards">
              {filtered.map((p) => (
                <li key={p.slug} className={`pcard card cat-${p.category}`}>
                  <a href={href.pattern(p.slug)}>
                    <div className="pcard-top">
                      <h3>{p.slug}</h3>
                      <span className={`pill cat-${p.category}`}>{CATEGORY_LABEL[p.category]}</span>
                    </div>
                    <div className="pcard-body">
                      <span className={`pcard-icon cat-${p.category}`}><Icon name={p.slug} size={30} /></span>
                      <p>{p.problemText}</p>
                    </div>
                    <div className="pcard-foot">
                      <StatusPill status={p.status} />
                      <Icon name="arrow" size={16} className="go" />
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Featured />

      <section className="section" id="guide" aria-labelledby="guide-title">
        <div className="wrap">
          <div className="section-head"><div className="title-icon"><Icon name="bolt" size={26} /><div><h2 id="guide-title">How to read a playground</h2><p>Every pattern page is a small laboratory. What the controls do — and what the numbers are.</p></div></div></div>
          <ul className="guide">
            <li><b>Watch it run.</b> Play, Pause, Step (→) and Reset (R), at 0.5×, 1× or 2×. The running node glows; tokens move along the edge being taken; the event log follows.</li>
            <li><b>Move a parameter.</b> The run restarts with the new configuration — unless its past is unchanged, then it continues. Metrics are derived from the run's event history.</li>
            <li><b>Break it.</b> Failure-mode presets reproduce each README's <em>Failure modes</em>: a reviewer that never approves, a torn checkpoint, a model approval over a red test.</li>
            <li><b>Compare.</b> Two configurations of the same pattern on one clock, with the same random draws (same seed), side by side, and a comparison table.</li>
            <li><b>Replay.</b> A seed fixes every random draw; the URL carries the configuration, so a scenario can be shared and replayed exactly.</li>
            <li><b>Simulated, not measured.</b> Latencies, tokens and probabilities are inputs of a model of the documented behavior — never measurements from the repositories.</li>
          </ul>
        </div>
      </section>

      <section className="section" id="about" aria-labelledby="prod-title">
        <div className="wrap">
          <div className="section-head"><div className="title-icon"><Icon name="github" size={26} /><div><h2 id="prod-title">Where the patterns run</h2><p>Taken from each pattern's “Running in” column. Reference-only patterns are not listed under a repository.</p></div></div></div>
          <div className="repos">
            {repos.map(([repo, slugs]) => (
              <article key={repo} className="repo card">
                <h3><a href={`https://github.com/koydas/${repo}`} rel="noopener">koydas/{repo}</a></h3>
                <p>{REPO_INFO[repo] ?? ''}</p>
                <ul>{slugs.map((s) => <li key={s}><a href={href.pattern(s)}>{s}</a></li>)}</ul>
                {dashboardsFor([repo]).map((d) => <p key={d.url} className="repo-dash"><a href={d.url}>{d.label} dashboard →</a></p>)}
              </article>
            ))}
          </div>
          {notes && (
            <div className="doc notes">
              <h3>{notes.title}</h3>
              <div dangerouslySetInnerHTML={{ __html: notes.html }} />
            </div>
          )}
        </div>
      </section>
    </>
  );
}
