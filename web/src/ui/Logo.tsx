/** The dumbbell mark: tilted, with motion arcs trailing it and sparks at the lifted end. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo-mark" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="var(--logo-motion)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M5 30a14 14 0 0 0 6 10" opacity="0.55" />
        <path d="M8 38a12 12 0 0 0 9 4" opacity="0.8" />
      </g>
      <g stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round">
        <path d="M37 5l-1.5 4" />
        <path d="M42 7.5l-3.5 3" />
        <path d="M44.5 13l-4.5 1" />
      </g>
      <g transform="rotate(-35 24 26)">
        <rect x="12" y="24.5" width="24" height="3" rx="1.5" fill="var(--text)" />
        <rect x="9" y="17" width="5" height="18" rx="2" fill="var(--accent)" />
        <rect x="4.5" y="20" width="4" height="12" rx="1.5" fill="var(--accent)" />
        <rect x="34" y="17" width="5" height="18" rx="2" fill="var(--accent)" />
        <rect x="39.5" y="20" width="4" height="12" rx="1.5" fill="var(--accent)" />
      </g>
    </svg>
  );
}

/** Mark and wordmark, linking home. */
export function Logo() {
  return (
    <a className="logo" href="#/" aria-label="cleanReps home">
      <LogoMark />
      <span className="logo-word" aria-hidden="true">CLEAN<b>REPS</b></span>
    </a>
  );
}
