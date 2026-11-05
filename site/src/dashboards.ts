import nav from './site-kit/nav.json';

export interface Dashboard {
  repo: string;
  label: string;
  url: string;
}

/** The live dashboard of each repo that has one (the shared site list), keyed by repo name. */
const BY_REPO = new Map(nav.sites.map((s) => [s.repo.split('/')[1], { repo: s.repo.split('/')[1], label: s.label, url: s.url }]));

/** Dashboards of the repos a pattern names in "Running in" (other sites of the shared nav; never this one). */
export function dashboardsFor(repos: string[]): Dashboard[] {
  return repos.filter((r) => r !== 'agent-patterns' && r !== 'koydas').flatMap((r) => BY_REPO.get(r) ?? []);
}
