// site-kit (ADR-0001, koydas/koydas): this repo vendors the shared shell. The copy declares a version and a hash; these
// tests fail when the files drift from them or when the React wrapper stops rendering the shared partials.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog } from '../content';
import { dashboardsFor } from '../dashboards';
import { Layout } from '../components/Layout';
import { PageHead, SiteFooter, SiteHeader } from '../site-kit/react/SiteShell';

const COPY = resolve(__dirname, '../site-kit');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Manifest = { version: string; profile: string; hash: string; files: Record<string, string> };
const manifest = JSON.parse(readFileSync(join(COPY, 'KIT.json'), 'utf8')) as Manifest;
const nav = JSON.parse(readFileSync(join(COPY, 'nav.json'), 'utf8')) as { sites: { id: string }[] };
const ids = nav.sites.map((s) => s.id);
const norm = (html: string) => html.replace(/<path ([^>]*?)\/>/g, '<path $1></path>').replace(/>\s+</g, '><').trim();

const HEAD = { eyebrow: 'A & B', title: '<b>"x"</b>', lede: "it's" };
// render.mjs runs in plain Node, as in the static-site builds (not through the test bundler).
function renderWithNode() {
  const script = `import(${JSON.stringify(pathToFileURL(join(COPY, 'render.mjs')).href)}).then((k) => {
    const ids = ${JSON.stringify(ids)};
    console.log(JSON.stringify({ header: Object.fromEntries(ids.map((i) => [i, k.renderHeader(i)])), footer: Object.fromEntries(ids.map((i) => [i, k.renderFooter(i)])), pagehead: k.renderPageHead(${JSON.stringify(HEAD)}) }));
  });`;
  return JSON.parse(execFileSync('node', ['-e', script], { encoding: 'utf8' })) as { header: Record<string, string>; footer: Record<string, string>; pagehead: string };
}

describe('site-kit copy', () => {
  it('matches the version and hash it declares', () => {
    const actual = Object.fromEntries(Object.keys(manifest.files).sort().map((f) => [f, sha(readFileSync(join(COPY, f)))]));
    expect(actual).toEqual(manifest.files);
    expect(sha(Buffer.from(Object.keys(actual).sort().map((f) => `${f} ${actual[f]}\n`).join('')))).toBe(manifest.hash);
    expect(manifest.profile).toBe('react');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('renders the same markup from React as from the shared partials', () => {
    const k = renderWithNode();
    for (const id of ids) {
      expect(norm(renderToStaticMarkup(<SiteHeader current={id} />))).toBe(norm(k.header[id]));
      expect(norm(renderToStaticMarkup(<SiteFooter current={id} />))).toBe(norm(k.footer[id]));
    }
    expect(norm(renderToStaticMarkup(<PageHead {...HEAD} />))).toBe(norm(k.pagehead));
  });
});

describe('shell on this site', () => {
  it('marks agent-patterns as the current site, in the bar and in the footer, and lists all five', () => {
    const { container } = render(<Layout current="home"><p>x</p></Layout>);
    for (const root of ['.sk-bar', '.sk-footer']) {
      const current = container.querySelectorAll(`${root} [aria-current="true"]`);
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAttribute('href', 'https://koydas.github.io/agent-patterns/');
      expect(container.querySelectorAll(`${root} a[href^="https://koydas.github.io/"]`).length).toBeGreaterThanOrEqual(5);
    }
    expect(screen.getByRole('link', { name: /^GitHub$/ })).toHaveAttribute('href', 'https://github.com/koydas/agent-patterns');
    expect(container.querySelector('script')).toBeNull();
  });

  it('opens the site switcher without script: a <details>, no hamburger button', () => {
    const { container } = render(<Layout current="home"><p>x</p></Layout>);
    expect(container.querySelector('details.sk-menu')).not.toBeNull();
    expect(container.querySelector('button.hamburger')).toBeNull();
  });
});

describe('cross-links to the dashboards', () => {
  it('only links a repo the pattern names in "Running in", for patterns that run in it', () => {
    const production = catalog.filter((p) => p.status === 'production');
    expect(production.length).toBeGreaterThan(0);
    for (const p of production) {
      for (const d of dashboardsFor(p.repos)) {
        expect(p.runningIn, `${p.slug} → ${d.repo}`).toContain(`github.com/koydas/${d.repo}`);
        expect(d.url).toBe(`https://koydas.github.io/${d.repo}/`);
      }
    }
  });

  it('never links this site, the portfolio or an unknown repo', () => {
    expect(dashboardsFor(['agent-patterns', 'koydas', 'fullstack-pilot', 'ollama-chat'])).toEqual([]);
    expect(dashboardsFor(['autonomous-dev-loop', 'ai-dev-tools']).map((d) => d.repo)).toEqual(['autonomous-dev-loop', 'ai-dev-tools']);
  });
});

describe('failure paths', () => {
  it('rejects an unknown site id in the header and the footer, in the React wrapper and in render.mjs', () => {
    expect(() => renderToStaticMarkup(<SiteHeader current="nope" />)).toThrow('site-kit: unknown site "nope"');
    expect(() => renderToStaticMarkup(<SiteFooter current="nope" />)).toThrow('site-kit: unknown site "nope"');
    const script = `import(${JSON.stringify(pathToFileURL(join(COPY, 'render.mjs')).href)}).then((k) => {
      const out = [];
      for (const f of [k.renderHeader, k.renderFooter]) { try { f('nope'); out.push('no error'); } catch (e) { out.push(e.message); } }
      console.log(JSON.stringify(out));
    });`;
    expect(JSON.parse(execFileSync('node', ['-e', script], { encoding: 'utf8' }))).toEqual(['site-kit: unknown site "nope"', 'site-kit: unknown site "nope"']);
  });
});
