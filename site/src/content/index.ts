import rawCatalog from 'virtual:catalog';
import rawLoaders from 'virtual:readmes';
import rawRoot from 'virtual:doc/root';
import rawClaudeCode from 'virtual:doc/claude-code';
import type { CatalogEntry, Readme } from './types';

export const catalog = rawCatalog as CatalogEntry[];
export const readmeLoaders = rawLoaders as Record<string, () => Promise<{ default: Readme }>>;
export const rootReadme = rawRoot as Readme;
export const claudeCodeDoc = rawClaudeCode as Readme;
