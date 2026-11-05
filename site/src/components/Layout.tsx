import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_LABEL, type Category } from '../content/types';
import { catalog } from '../content';
import { href } from '../router';
import { Icon } from './Icons';

export function BrandMark() {
  return <span className="brand-mark"><Icon name="layers" size={22} /></span>;
}

const CATS: Category[] = ['flow', 'quality', 'reliability'];
const catHref = (c: Category) => `${href.home()}?category=${c}#catalogue`;

function CategoriesMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary>Categories <Icon name="chevron" size={14} /></summary>
      <ul>
        {CATS.map((c) => (
          <li key={c}><a href={catHref(c)} onClick={() => { if (ref.current) ref.current.open = false; }}>
            <span className={`dot cat-${c}`} />{CATEGORY_LABEL[c]}<small>{catalog.filter((p) => p.category === c).length}</small>
          </a></li>
        ))}
      </ul>
    </details>
  );
}

export function Layout({ children, current }: { children: ReactNode; current: 'home' | 'pattern' | 'doc' | 'other' }) {
  const [open, setOpen] = useState(false);
  const links = (
    <>
      <a href={href.home()} aria-current={current === 'home' ? 'page' : undefined}>Home</a>
      <a href={`${href.home()}#catalogue`} aria-current={current === 'pattern' ? 'page' : undefined}>Patterns ({catalog.length})</a>
    </>
  );
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={href.home()} aria-label="agent-patterns home">
            <BrandMark />
            <span>agent-patterns</span>
          </a>
          <nav className="nav" aria-label="Primary">
            {links}
            <CategoriesMenu />
            <a href={`${href.home()}#guide`}>Guide</a>
            <a href={`${href.home()}#about`}>About</a>
          </nav>
          <div className="header-actions">
            <a className="btn small ghost" href="https://github.com/koydas/agent-patterns" rel="noopener"><Icon name="github" size={16} /> GitHub</a>
            <a className="badge-pages" href="https://github.com/koydas/agent-patterns/actions/workflows/pages.yml" rel="noopener" title="Static site built by GitHub Actions">GitHub Pages <Icon name="external" size={13} /></a>
          </div>
          <button type="button" className="hamburger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>
        </div>
        {open && (
          <nav id="mobile-menu" className="mobile-menu" aria-label="Mobile" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
            {links}
            {CATS.map((c) => <a key={c} href={catHref(c)} className="sub"><span className={`dot cat-${c}`} />{CATEGORY_LABEL[c]}</a>)}
            <a href={`${href.home()}#guide`}>Guide</a>
            <a href={`${href.home()}#about`}>About</a>
            <a href="https://github.com/koydas/agent-patterns" rel="noopener"><Icon name="github" size={16} /> GitHub</a>
          </nav>
        )}
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
