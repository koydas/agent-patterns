import { useCallback, useEffect, useMemo, useState } from 'react';
import { catalog, readmeLoaders as loaders } from '../content';
import { BLOB, CATEGORY_LABEL, TREE, type Readme } from '../content/types';
import { readUrl, type Mode } from '../engine/url';
import { SIMS } from '../patterns';
import { href, navigate, replaceSearch } from '../router';
import { Playground } from '../components/Playground';
import { Compare } from '../components/Compare';
import { StatusPill } from '../components/Pills';

const SECTION_ORDER = ['how-it-works', 'when-to-use', 'when-not-to-use', 'trade-offs', 'trade-offs-and-failure-modes', 'failure-modes'];

function useReadme(slug: string): Readme | null {
  const [doc, setDoc] = useState<{ slug: string; readme: Readme } | null>(null);
  useEffect(() => {
    let live = true;
    loaders[slug]?.().then((m) => live && setDoc({ slug, readme: m.default }));
    return () => { live = false; };
  }, [slug]);
  return doc?.slug === slug ? doc.readme : null;
}

export function PatternPage({ slug, search }: { slug: string; search: string }) {
  const entry = catalog.find((p) => p.slug === slug)!;
  const sim = SIMS[slug];
  const readme = useReadme(slug);
  // URL state is read once per pattern and mode; later changes only replace the query string
  const url = useMemo(() => readUrl(sim, search), [sim, search]);
  const [mode, setMode] = useState<Mode>(url.mode);
  useEffect(() => setMode(url.mode), [url.mode]);
  const onUrl = useCallback((s: string) => replaceSearch(s), []);
  const idx = catalog.findIndex((p) => p.slug === slug);
  const prev = catalog[idx - 1];
  const next = catalog[idx + 1];

  useEffect(() => {
    document.title = `${entry.title} | agent-patterns`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', entry.description);
  }, [entry]);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    navigate(href.pattern(slug, m === 'compare' ? '?mode=compare' : ''), { scroll: false });
  };

  const ordered = readme ? [
    ...SECTION_ORDER.map((id) => readme.sections.find((s) => s.id === id)).filter(Boolean),
    ...readme.sections.filter((s) => !SECTION_ORDER.includes(s.id)),
  ] as Readme['sections'] : [];

  return (
    <div className="wrap wide">
      <nav className="crumbs" aria-label="Breadcrumb"><a href={href.home()}>Patterns</a> / <span>{CATEGORY_LABEL[entry.category]}</span></nav>
      <header className="p-head">
        <div>
          <h1>{slug}</h1>
          <p className="problem"><strong>The problem: </strong><span dangerouslySetInnerHTML={{ __html: entry.problem }} /></p>
          <div className="p-meta">
            <span className={`pill cat-${entry.category}`}>{CATEGORY_LABEL[entry.category]}</span>
            <StatusPill status={entry.status} />
            {entry.offline && <span className="pill">impl runs offline</span>}
            {entry.hasTest && <span className="pill">impl.test.mjs</span>}
          </div>
        </div>
        <div className="modes" role="tablist" aria-label="Playground mode">
          <button type="button" role="tab" aria-selected={mode === 'explore'} aria-controls="playground" onClick={() => switchMode('explore')}>Explore</button>
          <button type="button" role="tab" aria-selected={mode === 'compare'} aria-controls="playground" onClick={() => switchMode('compare')}>Compare</button>
        </div>
      </header>

      <div id="playground" role="tabpanel" aria-label={mode === 'compare' ? 'Compare scenarios' : 'Explore'}>
        {mode === 'compare'
          ? <Compare key={`${slug}-c`} sim={sim} title={slug} initial={{ a: url.a, b: url.b, seedA: url.seedA, seedB: url.seedB }} initialPreset={url.saved ? undefined : sim.comparePresets[0]} onUrl={onUrl} />
          : <Playground key={`${slug}-e`} sim={sim} title={slug} initialConfig={url.config} initialSeed={url.seed} onUrl={onUrl} />}
      </div>

      <div className="doc-layout">
        <aside className="toc" aria-label="On this page">
          <span className="eyebrow">On this page</span>
          <ol>
            {ordered.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
            <li><a href="#implementation">Implementation</a></li>
          </ol>
        </aside>
        <article className="doc">
          {!readme && <p className="loading">Loading the README…</p>}
          {readme && <div className="intro" dangerouslySetInnerHTML={{ __html: readme.intro }} />}
          {ordered.map((s) => (
            <section key={s.id} aria-labelledby={s.id}>
              <h2 id={s.id}>{s.title}</h2>
              <div dangerouslySetInnerHTML={{ __html: s.html }} />
            </section>
          ))}
          <section className="impl-card card" aria-labelledby="implementation">
            <h2 id="implementation">Implementation</h2>
            <div className={`status-note ${entry.status}`}>
              <strong>{entry.status === 'production' ? 'Running in: ' : entry.status === 'prototype' ? 'Reference implementation, validated by a prototype: ' : 'Reference implementation: '}</strong>
              <span dangerouslySetInnerHTML={{ __html: entry.runningIn }} />
            </div>
            <div className="impl-grid">
              <a className="impl-link" href={`${BLOB}/patterns/${slug}/README.md`} rel="noopener"><b>README.md</b><span>source of this page</span></a>
              <a className="impl-link" href={`${BLOB}/patterns/${slug}/impl.mjs`} rel="noopener"><b>impl.mjs</b><span>{entry.implLines} lines · {entry.offline ? 'runs offline' : 'calls the Claude API'}</span></a>
              {entry.hasTest && <a className="impl-link" href={`${BLOB}/patterns/${slug}/impl.test.mjs`} rel="noopener"><b>impl.test.mjs</b><span>node --test, no API key</span></a>}
              <a className="impl-link" href={`${TREE}/site/src/patterns/${slug}.ts`} rel="noopener"><b>simulation</b><span>the model behind this playground</span></a>
            </div>
            <pre><code>{entry.hasTest
              ? `node --test patterns/${slug}/impl.test.mjs`
              : entry.offline ? `node patterns/${slug}/impl.mjs` : `npm install @anthropic-ai/sdk\nexport ANTHROPIC_API_KEY=...\nnode patterns/${slug}/impl.mjs`}</code></pre>
            <p className="muted small">The playground is a deterministic model of the documented behavior: latencies, token counts and probabilities are simulated inputs, not measurements from the repositories above.</p>
          </section>
          <nav className="pager" aria-label="More patterns">
            {prev ? <a href={href.pattern(prev.slug)}><small>← Previous</small>{prev.slug}</a> : <span />}
            {next && <a className="next" href={href.pattern(next.slug)}><small>Next →</small>{next.slug}</a>}
          </nav>
        </article>
      </div>
    </div>
  );
}
