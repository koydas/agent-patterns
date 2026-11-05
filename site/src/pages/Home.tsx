import { useEffect, useMemo, useState } from 'react';
import type { PatternSim } from '../engine/types';
import { catalog } from '../content';
import { rootReadme as root } from '../content';
import { CATEGORY_LABEL, type Category } from '../content/types';
import { href } from '../router';
import { HeroPipeline } from '../components/HeroPipeline';
import { MiniDiagram } from '../components/MiniDiagram';
import { StatusPill } from '../components/Pills';

const REPO_INFO: Record<string, string> = {
  'autonomous-dev-loop': 'GitHub-native, headless: issue → validation → generation → PR → AI review → auto-fix → human merge.',
  'ai-dev-tools': 'Claude Code toolbox: commands, agents and scripts as interactive, human-gated pipelines.',
  'fullstack-pilot': 'Polyglot multi-service repo; stateful database upgrade CI.',
  'repo-orchestrator': 'Cross-repository coherence; its S0 spike validated the resumable approval gate.',
};

export function Home() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  // card thumbnails come from the simulations, loaded after first paint
  const [sims, setSims] = useState<Record<string, PatternSim> | null>(null);
  useEffect(() => {
    let live = true;
    import('../patterns').then((m) => live && setSims(m.SIMS));
    return () => { live = false; };
  }, []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((p) => (cat === 'all' || p.category === cat) && (!needle || `${p.slug} ${p.problemText} ${p.description} ${p.runningInText}`.toLowerCase().includes(needle)));
  }, [q, cat]);
  const production = catalog.filter((p) => p.status === 'production').length;
  const withTests = catalog.filter((p) => p.hasTest).length;
  const offline = catalog.filter((p) => p.offline).length;
  const repos = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of catalog) for (const r of p.repos) if (r !== 'agent-patterns') m.set(r, [...(m.get(r) ?? []), p.slug]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, []);
  const notes = root.sections.find((s) => s.id === 'production-notes');

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Interactive engineering lab</span>
            <h1>21 multi-agent patterns. <em>Run them</em>, break them, compare them.</h1>
            <p className="lede">
              Each pattern was named after the problem it solved in a pipeline that runs. Watch one execute, move its
              parameters, break it on purpose, and compare two configurations side by side. Every simulation is
              deterministic, seeded and runs in your browser.
            </p>
            <div className="hero-cta">
              <a className="btn primary" href="#catalogue">Browse the patterns</a>
              <a className="btn" href={href.pattern('loop-with-guard')}>Start with loop-with-guard</a>
            </div>
            <div className="stats" aria-label="Collection facts">
              <div><b>{catalog.length}</b><span>patterns</span></div>
              <div><b>{production}</b><span>running in public repos</span></div>
              <div><b>{offline}</b><span>impls run offline</span></div>
              <div><b>{withTests}</b><span>ship with tests</span></div>
            </div>
          </div>
          <HeroPipeline />
        </div>
      </section>

      <section className="section" id="catalogue" aria-labelledby="catalogue-title">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">Catalogue</span>
              <h2 id="catalogue-title">Find a pattern by the problem you have</h2>
            </div>
          </div>
          <div className="filters">
            <label className="search">
              <span className="sr-only">Search patterns</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" placeholder="Search: retry, approval, cost, labels…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="filter-chips" role="group" aria-label="Category">
              {(['all', 'flow', 'quality', 'reliability'] as const).map((c) => (
                <button key={c} type="button" className={`chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
                  {c === 'all' ? `All ${catalog.length}` : `${CATEGORY_LABEL[c]} ${catalog.filter((p) => p.category === c).length}`}
                </button>
              ))}
            </div>
          </div>
          <p className="sr-only" aria-live="polite">{filtered.length} patterns shown</p>
          {filtered.length === 0 ? (
            <p className="empty">No pattern matches “{q}”.</p>
          ) : (
            <ul className="grid-cards" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {filtered.map((p) => (
                <li key={p.slug} className="pcard card">
                  <a className="cover" href={href.pattern(p.slug)}>
                    <div className="pcard-art">{sims?.[p.slug] && <MiniDiagram sim={sims[p.slug]} />}</div>
                    <div className="pcard-body">
                      <h3>{p.slug}</h3>
                      <p>{p.problemText}</p>
                      <div className="pcard-meta">
                        <span className={`pill cat-${p.category}`}>{CATEGORY_LABEL[p.category]}</span>
                        <StatusPill status={p.status} />
                        {p.offline && <span className="pill">offline impl</span>}
                        {p.hasTest && <span className="pill">tests</span>}
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section" id="in-production" aria-labelledby="prod-title">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="eyebrow">Grounded in real systems</span>
              <h2 id="prod-title">Where the patterns run</h2>
              <p>Taken from each pattern's “Running in” column. “Reference only” patterns are not listed under a repository.</p>
            </div>
          </div>
          <div className="repos">
            {repos.map(([repo, slugs]) => (
              <article key={repo} className="repo card">
                <h3><a href={`https://github.com/koydas/${repo}`} rel="noopener">koydas/{repo}</a></h3>
                <p>{REPO_INFO[repo] ?? ''}</p>
                <ul>{slugs.map((s) => <li key={s}><a href={href.pattern(s)}>{s}</a></li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {notes && (
        <section className="section" aria-labelledby="notes-title">
          <div className="wrap doc">
            <span className="eyebrow">From the README</span>
            <h2 id="notes-title">{notes.title}</h2>
            <div dangerouslySetInnerHTML={{ __html: notes.html }} />
          </div>
        </section>
      )}
    </>
  );
}
