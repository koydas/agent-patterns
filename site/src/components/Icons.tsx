// Stroke icons (24×24, currentColor). Pattern icons are schematic glyphs of each pattern's shape.

const P: Record<string, string> = {
  // ui
  github: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
  play: 'M7 4.5v15l12-7.5z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  cloud: 'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M6 9l6 6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  loop: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  check: 'M5 12l4.5 4.5L19 7',
  // patterns
  'sequential-pipeline': 'M2 9h5v6H2zM9.5 9h5v6h-5zM17 9h5v6h-5zM7 12h2.5M14.5 12H17',
  router: 'M5 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM19 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7.6 10.5l9-4.2M7.6 13.5l9 4.2',
  'label-driven-state-machine': 'M5 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 8.5 6.5 14.5M14 8.5l3.5 6M8 17h8',
  'escalation-ladder': 'M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10',
  'fan-out': 'M2 10h5v4H2zM16 3h6v4h-6zM16 10h6v4h-6zM16 17h6v4h-6zM7 12h4M11 5v14M11 5h5M11 12h5M11 19h5',
  'speculative-race': 'M3 6h12M3 12h16M3 18h9M15 4l3 2-3 2M19 10l3 2-3 2M12 16l3 2-3 2',
  'validator-first': 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  'loop-with-guard': 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  'eval-gate-ratchet': 'M5 20v-4M10 20v-8M15 20v-11M20 20V4',
  'tool-grounded-review': 'M14.7 6.3a4 4 0 0 0-5.4 5l-6 6 2.4 2.4 6-6a4 4 0 0 0 5-5.4l-2.5 2.5-2-.5-.5-2z',
  'critic-pair': 'M8 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM16 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2.5 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6M10.5 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6',
  'ac-traceability': 'M9 6h11M9 12h11M9 18h11M3.5 6l1.5 1.5L7 5M3.5 12l1.5 1.5L7 11M4 17.5h2',
  'typed-evidence-chain': 'M9 15l-2 2a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M15 9l2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M9 15l6-6',
  'human-gate': 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  'resumable-approval-gate': 'M6 4h4v16H6zM14 4h4v16h-4z',
  'bounded-feedback-injection': 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  'stateful-upgrade-verification': 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  'checkpoint-resume': 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  'staged-prompt-separation': 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  'reflexive-loop': 'M12 4a8 8 0 1 0 8 8M20 4v5h-5M12 8v4l3 2',
  'read-only-meta-loop': 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2',
};

export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  const filled = name === 'github' || name === 'play';
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] ?? P.file} />
    </svg>
  );
}

/** Raw path, for icons drawn inside an SVG diagram. */
export const iconPath = (name: string) => P[name] ?? P.file;
