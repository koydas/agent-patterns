// Build-time content modules (scripts/content-plugin.mjs); typed in src/content/index.ts.
declare module 'virtual:catalog' {
  const catalog: unknown;
  export default catalog;
}
declare module 'virtual:readmes' {
  const loaders: Record<string, () => Promise<{ default: unknown }>>;
  export default loaders;
}
declare module 'virtual:doc/*' {
  const doc: unknown;
  export default doc;
}
declare module '*/content-plugin.mjs' {
  import type { Plugin } from 'vite';
  export default function contentPlugin(): Plugin;
}
declare module '*/bounded-feedback-injection/impl.mjs' {
  export const LESSONS: Readonly<Record<string, string>>;
  export function selectLessons(
    signals: { id: string; ts: number }[],
    opts?: { now?: number; window?: number; maxAgeDays?: number; minOccurrences?: number; maxLessons?: number; maxChars?: number; catalog?: Record<string, string> },
  ): { id: string; count: number; text: string }[];
}
declare module '*/eval-gate-ratchet/impl.mjs' {
  export function checkRatchet(floor: unknown, proposed: unknown): { ok: boolean; failures: string[] };
}
declare module '*/tool-grounded-review/impl.mjs' {
  export function checkStatus(s: string[]): string;
  export function verdict(x: { evidence: { name: string; status: string }[]; review: string }, declared?: string[]): unknown;
}
declare module '*/escalation-ladder/impl.mjs' {
  export function deterministic(h: { ours: string; base: string; theirs: string }): string | null;
  export function checkModelAnswer(h: { ours: string; base: string; theirs: string }, a: unknown): string | null;
}
declare module '*/stateful-upgrade-verification/impl.mjs' {
  export function verifyUpgrade(x: unknown): { ok: boolean; reason: string };
}
declare module '*/read-only-meta-loop/impl.mjs' {
  export const LEVERS: unknown;
  export const NO_LEVER: Record<string, string>;
  export function suggest(doc: unknown): unknown;
  export function validateTable(levers?: unknown, noLever?: unknown): void;
}
