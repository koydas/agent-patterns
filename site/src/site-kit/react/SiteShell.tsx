// site-kit React wrapper for the two Vite sites. Renders exactly the markup of header.html / footer.html /
// pagehead.html (the kit tests compare the two, normalised), so the shell is the same on all five sites.
import type { ReactNode } from 'react';
import nav from '../nav.json';
import kit from '../KIT.json';

type SiteEntry = (typeof nav.sites)[number];

function currentSite(id: string): SiteEntry {
  const site = nav.sites.find((s) => s.id === id);
  if (!site) throw new Error(`site-kit: unknown site "${id}"`);
  return site;
}

const portfolioUrl = nav.sites[0].url;
const svgProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** The shared top bar: brand, site switcher (a <details>, no script), repo link, link back to the portfolio. */
export function SiteHeader({ current }: { current: string }) {
  const site = currentSite(current);
  const repoUrl = `https://github.com/${site.repo}`;
  return (
    <div className="sk-bar" data-site-kit={kit.version} data-sk-current={site.id}>
      <div className="sk-bar-in">
        <a className="sk-brand" href={site.url}>
          <span className="sk-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" {...svgProps}>
              <path d="m12 3 9 5-9 5-9-5z" />
              <path d="m3 13 9 5 9-5" />
            </svg>
          </span>
          <span className="sk-brand-name">{site.name}</span>
        </a>
        <nav className="sk-nav" aria-label="Sites">
          <details className="sk-menu">
            <summary>
              <span className="sk-sum-sites">Sites</span>
              <span className="sk-sum-menu">Menu</span>
              <svg className="sk-chevron" width="14" height="14" viewBox="0 0 24 24" {...svgProps} aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="sk-panel">
              <ul className="sk-sites">
                {nav.sites.map((s) => (
                  <li key={s.id}>
                    <a href={s.url} aria-current={s.id === site.id ? 'true' : undefined}>
                      <span className="sk-site-name">{s.label}</span>
                      <span className="sk-site-blurb">{s.blurb}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="sk-panel-extra">
                <a href={repoUrl}>GitHub · {site.repo}</a>
                <a className="sk-to-portfolio" href={portfolioUrl}>
                  ← Back to the portfolio
                </a>
              </div>
            </div>
          </details>
          <div className="sk-actions">
            <a className="sk-link sk-to-portfolio" href={portfolioUrl}>
              ← Portfolio
            </a>
            <a className="sk-link" href={repoUrl}>
              GitHub
            </a>
          </div>
        </nav>
      </div>
    </div>
  );
}

/** The shared footer: the five sites, the identity line and the repo link. */
export function SiteFooter({ current }: { current: string }) {
  const site = currentSite(current);
  return (
    <div className="sk-footer" data-site-kit={kit.version} data-sk-current={site.id}>
      <div className="sk-footer-in">
        <nav aria-label="All sites">
          <ul>
            {nav.sites.map((s) => (
              <li key={s.id}>
                <a href={s.url} aria-current={s.id === site.id ? 'true' : undefined}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p>{nav.identity}</p>
        <p>
          <a href={`https://github.com/${site.repo}`}>{site.repo}</a> on GitHub
        </p>
      </div>
    </div>
  );
}

/** The first-screen block of every site: eyebrow, title, one-line description. */
export function PageHead({ eyebrow, title, lede, titleId }: { eyebrow: string; title: ReactNode; lede: ReactNode; titleId?: string }) {
  return (
    <div className="sk-pagehead">
      <div className="sk-pagehead-in">
        <p className="sk-eyebrow">{eyebrow}</p>
        <h1 className="sk-title" id={titleId}>
          {title}
        </h1>
        <p className="sk-lede">{lede}</p>
      </div>
    </div>
  );
}
