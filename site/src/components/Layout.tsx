import type { ReactNode } from 'react';
import { href } from '../router';

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0a1020" stroke="#1b2640" />
      <path d="M11 16 21 10M11 16l10 6" stroke="#6d8dff" strokeWidth="1.6" fill="none" />
      <circle cx="10" cy="16" r="3.6" fill="#2f63f0" />
      <circle cx="22" cy="9.5" r="3.2" fill="#6d8dff" />
      <circle cx="22" cy="22.5" r="3.2" fill="#34d399" />
    </svg>
  );
}

export function Layout({ children, current }: { children: ReactNode; current: 'home' | 'pattern' | 'doc' | 'other' }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={href.home()} aria-label="agent-patterns home">
            <BrandMark />
            <span>agent-patterns</span>
            <small>playground</small>
          </a>
          <nav className="nav" aria-label="Primary">
            <a href={`${href.home()}#catalogue`} aria-current={current === 'home' ? 'page' : undefined}>Patterns</a>
            <a className="hide-sm" href={`${href.home()}#in-production`}>In production</a>
            <a href="https://github.com/koydas/agent-patterns" rel="noopener">GitHub</a>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <span>
            <a href="https://github.com/koydas/agent-patterns" rel="noopener">koydas/agent-patterns</a> · MIT · patterns from{' '}
            <a href="https://github.com/koydas/autonomous-dev-loop" rel="noopener">autonomous-dev-loop</a> and{' '}
            <a href="https://github.com/koydas/ai-dev-tools" rel="noopener">ai-dev-tools</a>
          </span>
          <span>Every number in a playground is simulated in your browser — no API key, no model call.</span>
        </div>
      </footer>
    </>
  );
}
