import { useEffect, useSyncExternalStore } from 'react';

// History-API router under the Vite base (/agent-patterns/). Pattern URLs keep the Jekyll shape
// (/agent-patterns/patterns/<slug>/); README.md/.html variants and a missing trailing slash resolve too.

export const BASE = import.meta.env.BASE_URL; // '/agent-patterns/'

export type Route =
  | { name: 'home' }
  | { name: 'pattern'; slug: string }
  | { name: 'doc'; doc: 'claude-code' }
  | { name: 'not-found'; path: string };

export function parsePath(pathname: string): Route {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  p = p.replace(/(index|README)(\.html|\.md)?$/i, '').replace(/\/+$/, '');
  if (p === '') return { name: 'home' };
  const m = p.match(/^patterns\/([a-z0-9-]+)$/);
  if (m) return { name: 'pattern', slug: m[1] };
  if (p === 'docs/claude-code' || p === 'docs/claude-code.html') return { name: 'doc', doc: 'claude-code' };
  return { name: 'not-found', path: pathname };
}

export const href = {
  home: () => BASE,
  pattern: (slug: string, search = '') => `${BASE}patterns/${slug}/${search}`,
  doc: (doc: string) => `${BASE}docs/${doc}/`,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', emit);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => window.location.pathname + window.location.search;

export function useLocation() {
  return useSyncExternalStore(subscribe, snapshot, () => BASE);
}

export function navigate(to: string, { replace = false, scroll = true } = {}) {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  emit();
  if (scroll && !replace) {
    const hash = to.split('#')[1];
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    else window.scrollTo(0, 0);
  }
}

/** Updates the query string without a history entry or a re-render of the route. */
export function replaceSearch(search: string) {
  const url = window.location.pathname + search + window.location.hash;
  if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(null, '', url);
}

/** Intercepts same-origin clicks under the base (links inside rendered READMEs included). */
export function useLinkInterception() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || a.target || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(BASE)) return;
      if (url.pathname === window.location.pathname && url.hash) return; // in-page anchor
      e.preventDefault();
      navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
