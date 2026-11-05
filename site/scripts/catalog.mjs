// Build-time content: the repository is the source of truth. Reads the root README tables (category, problem,
// "Running in"), _data/patterns.yml (title, description), each pattern's README.md (rendered to HTML sections)
// and the presence of impl.test.mjs / an SDK import. Used by the Vite plugin and by the prerender step.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO = 'koydas/agent-patterns';
export const BLOB = `https://github.com/${REPO}/blob/main`;
export const BASE = '/agent-patterns/';
export const SITE = 'https://koydas.github.io';

const CATEGORY = { 'Flow control': 'flow', 'Quality gates': 'quality', 'Reliability and cost': 'reliability' };
export const CATEGORY_LABEL = { flow: 'Flow Control', quality: 'Quality Gates', reliability: 'Reliability & Cost' };

/** Minimal parser for _data/patterns.yml: `slug:` then indented `title:` / `description:` scalars. */
export function parsePatternsYml(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^#/.test(line) || !line.trim()) continue;
    const top = line.match(/^([a-z0-9-]+):\s*$/);
    if (top) { cur = out[top[1]] = {}; continue; }
    const kv = line.match(/^\s+(title|description):\s*(.*)$/);
    if (kv && cur) cur[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const slugOfHref = (href) => href.match(/patterns\/([a-z0-9-]+)\/?/)?.[1] ?? null;

/** Rewrites repository-relative links: a pattern README → its page, any other file → GitHub. */
export function rewriteHref(href, fromDir) {
  if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
  const abs = join(fromDir, href).replace(/\\/g, '/');
  const pattern = abs.match(/^patterns\/([a-z0-9-]+)\/?(README\.md)?$/);
  if (pattern) return `${BASE}patterns/${pattern[1]}/`;
  if (abs === '' || abs === 'README.md') return BASE;
  if (abs === 'docs/claude-code.md') return `${BASE}docs/claude-code/`;
  return `${BLOB}/${abs}`;
}

function markedFor(fromDir) {
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = text.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href: raw, title, tokens }) {
        const href = rewriteHref(raw, fromDir);
        const text = this.parser.parseInline(tokens);
        const ext = /^https?:/.test(href) ? ' rel="noopener"' : '';
        return `<a href="${href}"${title ? ` title="${title}"` : ''}${ext}>${text}</a>`;
      },
      table(token) {
        // Trade-off tables have an empty header row: drop it.
        const empty = token.header.every((c) => !c.text.trim());
        const head = empty ? '' : `<thead><tr>${token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('')}</tr></thead>`;
        const body = token.rows.map((row) => `<tr>${row.map((c) => {
          const html = this.parser.parseInline(c.tokens);
          const cls = /^<strong>Pro<\/strong>$/.test(html) ? ' class="pro"' : /^<strong>Con<\/strong>$/.test(html) ? ' class="con"' : '';
          return `<td${cls}>${html}</td>`;
        }).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table class="${empty ? 'kv' : ''}">${head}<tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  return m;
}

/** README → { title, mermaid, intro, sections: [{ id, title, html }] }. */
export function renderReadme(markdown, fromDir) {
  const m = markedFor(fromDir);
  const tokens = m.lexer(markdown);
  let title = '';
  let mermaid = '';
  const intro = [];
  const sections = [];
  let current = null;
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth === 1) { title = t.text; continue; }
    if (t.type === 'code' && t.lang === 'mermaid' && !mermaid) { mermaid = t.text; continue; }
    if (t.type === 'heading' && t.depth === 2) {
      current = { title: t.text, tokens: [] };
      sections.push(current);
      continue;
    }
    (current ? current.tokens : intro).push(t);
  }
  const html = (list) => {
    const arr = Object.assign([...list], { links: tokens.links });
    return m.parser(arr);
  };
  return {
    title,
    mermaid,
    intro: html(intro),
    sections: sections.map((s) => ({ id: s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: s.title, html: html(s.tokens) })),
  };
}

function inlineHtml(md, fromDir) {
  return markedFor(fromDir).parseInline(md);
}

function readRootTables() {
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const rows = [];
  let category = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^### (.+)$/);
    if (h) { category = CATEGORY[h[1].trim()] ?? null; continue; }
    if (!category || !line.startsWith('|') || /^\|\s*-/.test(line) || /^\| Your problem/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3) continue;
    const slug = slugOfHref(cells[1]);
    if (slug) rows.push({ slug, category, problem: cells[0], runningIn: cells[2] });
  }
  return rows;
}

function statusOf(runningIn) {
  if (/^Reference only/i.test(runningIn)) return /spike|prototype/i.test(runningIn) ? 'prototype' : 'reference';
  return 'production';
}

export function loadCatalog() {
  const yml = parsePatternsYml(readFileSync(join(ROOT, '_data/patterns.yml'), 'utf8'));
  const dirs = readdirSync(join(ROOT, 'patterns'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const rows = readRootTables();
  return rows.map((row, order) => {
    const dir = join(ROOT, 'patterns', row.slug);
    const impl = readFileSync(join(dir, 'impl.mjs'), 'utf8');
    const meta = yml[row.slug] ?? {};
    return {
      slug: row.slug,
      order,
      category: row.category,
      title: meta.title ?? row.slug,
      description: meta.description ?? '',
      problem: inlineHtml(row.problem, ''),
      problemText: row.problem.replace(/[`*_]/g, ''),
      runningIn: inlineHtml(row.runningIn, ''),
      runningInText: row.runningIn.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_]/g, ''),
      status: statusOf(row.runningIn),
      repos: [...new Set([...row.runningIn.matchAll(/github\.com\/koydas\/([a-z0-9-]+)/g)].map((m) => m[1]))],
      hasTest: existsSync(join(dir, 'impl.test.mjs')),
      offline: !impl.includes('@anthropic-ai/sdk'),
      implLines: impl.split('\n').length,
    };
  }).filter((p) => dirs.includes(p.slug));
}

export function patternDirs() {
  return readdirSync(join(ROOT, 'patterns'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export function loadReadme(slug) {
  return renderReadme(readFileSync(join(ROOT, 'patterns', slug, 'README.md'), 'utf8'), `patterns/${slug}`);
}

export function loadRootReadme() {
  return renderReadme(readFileSync(join(ROOT, 'README.md'), 'utf8'), '');
}

export function loadDoc(path) {
  return renderReadme(readFileSync(join(ROOT, path), 'utf8'), dirname(path));
}
