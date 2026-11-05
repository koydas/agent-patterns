import { lazy, Suspense, useEffect } from 'react';
import { catalog, claudeCodeDoc as claudeCode } from './content';
import { Layout, PageHead } from './components/Layout';
import { Home } from './pages/Home';
import { href, parsePath, useLinkInterception, useLocation } from './router';

// pattern pages (simulations, playground) load on demand: the home page ships without them
const PatternPage = lazy(() => import('./pages/PatternPage').then((m) => ({ default: m.PatternPage })));

const HOME_TITLE = 'agent-patterns — interactive playground for 21 multi-agent patterns';

export function App() {
  useLinkInterception();
  const loc = useLocation();
  const [path, query = ''] = loc.split('?');
  const search = query ? `?${query}` : '';
  const route = parsePath(path);
  const known = route.name === 'pattern' && catalog.some((p) => p.slug === route.slug);

  useEffect(() => {
    if (route.name === 'home') document.title = HOME_TITLE;
    if (route.name === 'doc') document.title = `${claudeCode.title} | agent-patterns`;
    if (route.name === 'not-found' || (route.name === 'pattern' && !known)) document.title = `Not found | agent-patterns`;
  }, [route.name, known]);

  // deep links with a hash (#catalogue, #guide, a README section): scroll once the route has rendered
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView(), 60);
    return () => clearTimeout(t);
  }, [loc]);

  // canonical pattern URL keeps the Jekyll shape: /patterns/<slug>/
  useEffect(() => {
    if (route.name === 'pattern' && known && path !== href.pattern(route.slug)) window.history.replaceState(null, '', href.pattern(route.slug) + search);
  }, [route, known, path, search]);

  if (route.name === 'home') return <Layout current="home"><Home search={search} /></Layout>;
  if (route.name === 'pattern' && known) return <Layout current="pattern"><Suspense fallback={<div className="wrap"><p className="loading">Loading the playground…</p></div>}><PatternPage key={route.slug} slug={route.slug} search={search} /></Suspense></Layout>;
  if (route.name === 'doc') {
    return (
      <Layout current="doc">
        <PageHead eyebrow="Docs" title={claudeCode.title} lede="How Claude Code is set up in koydas/agent-patterns: the ai-dev-tools plugin and repository skills." />
        <div className="wrap"><article className="doc" style={{ marginTop: 32 }}>
          <div dangerouslySetInnerHTML={{ __html: claudeCode.intro }} />
          {claudeCode.sections.map((s) => <section key={s.id}><h2 id={s.id}>{s.title}</h2><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}
        </article></div>
      </Layout>
    );
  }
  return (
    <Layout current="other">
      <div className="wrap"><article className="doc" style={{ marginTop: 40 }}>
        <h1>Not found</h1>
        <p>Nothing lives at <code>{path}</code>. <a href={href.home()}>Back to the 21 patterns</a>.</p>
      </article></div>
    </Layout>
  );
}
