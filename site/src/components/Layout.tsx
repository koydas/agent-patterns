import { useEffect, useRef, type ReactNode } from 'react';
import { CATEGORY_LABEL, type Category } from '../content/types';
import { catalog } from '../content';
import { href } from '../router';
import { PageHead, SiteFooter, SiteHeader } from '../site-kit/react/SiteShell';
import { Icon } from './Icons';

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

export { PageHead };

/**
 * The shared top bar and footer come from site-kit (brand, site switcher, GitHub, back to the portfolio). The row
 * below is this site's own navigation: no script, it scrolls sideways on a phone.
 */
export function Layout({ children, current }: { children: ReactNode; current: 'home' | 'pattern' | 'doc' | 'other' }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader current="agent-patterns" />
      <header className="local-bar">
        <div className="wrap">
          <nav className="local-nav" aria-label="Primary">
            <a href={href.home()} aria-current={current === 'home' ? 'page' : undefined}>Home</a>
            <a href={`${href.home()}#catalogue`} aria-current={current === 'pattern' ? 'page' : undefined}>Patterns ({catalog.length})</a>
            <CategoriesMenu />
            <a href={`${href.home()}#guide`}>Guide</a>
            <a href={`${href.home()}#about`}>About</a>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <SiteFooter current="agent-patterns" />
        <div className="wrap sim-note">Every number in a playground is simulated in your browser — no API key, no model call.</div>
      </footer>
    </>
  );
}
