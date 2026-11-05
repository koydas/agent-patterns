// Vite plugin: exposes the repository content as virtual modules, rendered at build time (no Markdown parser
// in the client bundle). READMEs are code-split: a pattern page loads only its own README.
import { join } from 'node:path';
import { loadCatalog, loadDoc, loadReadme, loadRootReadme, ROOT } from './catalog.mjs';

const CATALOG = 'virtual:catalog';
const READMES = 'virtual:readmes';
const README = 'virtual:readme/';
const DOC = 'virtual:doc/';
const r = (id) => `\0${id}`;

export default function contentPlugin() {
  return {
    name: 'agent-patterns-content',
    resolveId(id) {
      if (id === CATALOG || id === READMES || id.startsWith(README) || id.startsWith(DOC)) return r(id);
      return null;
    },
    load(id) {
      if (!id.startsWith('\0virtual:')) return null;
      const v = id.slice(1);
      if (v === CATALOG) {
        this.addWatchFile(join(ROOT, 'README.md'));
        this.addWatchFile(join(ROOT, '_data/patterns.yml'));
        return `export default ${JSON.stringify(loadCatalog())};`;
      }
      if (v === READMES) {
        const slugs = loadCatalog().map((p) => p.slug);
        return `export default {${slugs.map((s) => `${JSON.stringify(s)}: () => import(${JSON.stringify(README + s)})`).join(',')}};`;
      }
      if (v.startsWith(README)) {
        const slug = v.slice(README.length);
        this.addWatchFile(join(ROOT, 'patterns', slug, 'README.md'));
        return `export default ${JSON.stringify(loadReadme(slug))};`;
      }
      if (v === `${DOC}root`) return `export default ${JSON.stringify(loadRootReadme())};`;
      if (v === `${DOC}claude-code`) return `export default ${JSON.stringify(loadDoc('docs/claude-code.md'))};`;
      return null;
    },
  };
}
