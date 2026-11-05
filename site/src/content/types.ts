export type Category = 'flow' | 'quality' | 'reliability';
export type Status = 'production' | 'reference' | 'prototype';

export interface CatalogEntry {
  slug: string;
  order: number;
  category: Category;
  title: string;
  description: string;
  /** HTML, from the root README table. */
  problem: string;
  problemText: string;
  /** HTML, the "Running in" cell of the root README table. */
  runningIn: string;
  runningInText: string;
  status: Status;
  repos: string[];
  hasTest: boolean;
  offline: boolean;
  implLines: number;
}

export interface Readme {
  title: string;
  mermaid: string;
  intro: string;
  sections: { id: string; title: string; html: string }[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  flow: 'Flow Control',
  quality: 'Quality Gates',
  reliability: 'Reliability & Cost',
};

export const STATUS_LABEL: Record<Status, string> = {
  production: 'Running in a repo',
  reference: 'Reference only',
  prototype: 'Reference · validated by a prototype',
};

export const REPO = 'koydas/agent-patterns';
export const BLOB = `https://github.com/${REPO}/blob/main`;
export const TREE = `https://github.com/${REPO}/tree/main`;
