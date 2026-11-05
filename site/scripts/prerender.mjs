// Post-build: one static HTML file per route, so the Jekyll URLs keep working on a static host
// (/agent-patterns/patterns/<slug>/), each with its own title, description, canonical URL and the
// README text in the markup (search engines and no-JS readers). React replaces it on mount.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFooter, renderHeader } from '../src/site-kit/render.mjs';
import { BASE, CATEGORY_LABEL, loadCatalog, loadDoc, loadReadme, loadRootReadme, ROOT, SITE } from './catalog.mjs';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist');
const template = readFileSync(join(DIST, 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The shared top bar and footer are in the static HTML too (no-JS readers, search engines); React replaces them on mount.
const shell = (main) => `${renderHeader('agent-patterns')}${main}<footer class="site-footer">${renderFooter('agent-patterns')}</footer>`;

function page({ path, title, description, body, type = 'article' }) {
  const url = `${SITE}${BASE}${path}`;
  const meta = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="agent-patterns" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');
  const html = template
    .replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, meta)
    .replace('<!--prerender-->', `${shell(`<main class="wrap doc prerender">${body}</main>`)}`);
  const file = join(DIST, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  return url;
}

const sections = (r) => r.sections.map((s) => `<section><h2 id="${s.id}">${esc(s.title)}</h2>${s.html}</section>`).join('\n');
const catalog = loadCatalog();
const urls = [];

// home
const root = loadRootReadme();
urls.push(page({
  path: '',
  type: 'website',
  title: 'agent-patterns — interactive playground for 21 multi-agent patterns',
  description: `${catalog.length} multi-agent LLM patterns indexed by the problem they solve — interactive simulations, trade-offs, failure modes and runnable code. ${catalog.filter((p) => p.status === 'production').length} run in public repositories.`,
  body: `<h1>agent-patterns</h1>${root.intro}<h2>Find a pattern by the problem you have</h2>${['flow', 'quality', 'reliability'].map((cat) =>
    `<h3>${CATEGORY_LABEL[cat]}</h3><ul>${catalog.filter((p) => p.category === cat).map((p) => `<li><a href="${BASE}patterns/${p.slug}/">${p.slug}</a> — ${p.problem}</li>`).join('')}</ul>`).join('')}`,
}));

// patterns
for (const p of catalog) {
  const r = loadReadme(p.slug);
  urls.push(page({
    path: `patterns/${p.slug}/`,
    title: `${p.title} | agent-patterns`,
    description: p.description,
    body: `<p><a href="${BASE}">agent-patterns</a> / ${CATEGORY_LABEL[p.category]}</p><h1>${p.slug}</h1><p><strong>The problem:</strong> ${p.problem}</p><p><strong>Running in:</strong> ${p.runningIn}</p>${r.intro}${sections(r)}`,
  }));
  // keep the raw files the Jekyll site used to serve next to each page
  for (const f of ['README.md', 'impl.mjs']) {
    const src = join(ROOT, 'patterns', p.slug, f);
    if (existsSync(src)) copyFileSync(src, join(DIST, 'patterns', p.slug, f));
  }
}

// docs/claude-code.md
const cc = loadDoc('docs/claude-code.md');
urls.push(page({ path: 'docs/claude-code/', title: `${cc.title} | agent-patterns`, description: 'How Claude Code is set up in koydas/agent-patterns: the ai-dev-tools plugin and repository skills.', body: `<h1>${esc(cc.title)}</h1>${cc.intro}${sections(cc)}` }));

// 404: the app renders a not-found page (and resolves README.html-style variants of known routes)
writeFileSync(join(DIST, '404.html'), template.replace('<!--prerender-->', ''));
writeFileSync(join(DIST, '.nojekyll'), '');
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`prerendered ${urls.length} routes`);
